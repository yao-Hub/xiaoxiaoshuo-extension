const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const { promisify } = require('node:util');
const vscode = require('vscode');

const execFileAsync = promisify(execFile);
const MACHINE_ID_STATE_KEY = 'xiaoxiaoshuo.pluginMachineId';
const INVALID_SERIALS = new Set([
  'DEFAULT STRING',
  'NONE',
  'NOT APPLICABLE',
  'SYSTEM SERIAL NUMBER',
  'TO BE FILLED BY O.E.M.',
  'UNKNOWN'
]);

function normalizeMachineId(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
    .slice(0, 128);
  return INVALID_SERIALS.has(normalized) || /^0+$/.test(normalized) ? '' : normalized;
}

async function readCommand(command, args) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: 5000,
      windowsHide: true
    });
    return stdout;
  } catch {
    return '';
  }
}

async function readMotherboardId() {
  if (process.platform === 'win32') {
    return readCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '(Get-CimInstance -ClassName Win32_BaseBoard).SerialNumber'
    ]);
  }
  if (process.platform === 'linux') {
    try {
      return await fs.readFile('/sys/devices/virtual/dmi/id/board_serial', 'utf8');
    } catch {
      return '';
    }
  }
  if (process.platform === 'darwin') {
    return readCommand('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
  }
  return '';
}

async function getMachineId(context) {
  const cached = normalizeMachineId(context.globalState.get(MACHINE_ID_STATE_KEY));
  if (cached) {
    return cached;
  }
  const raw = await readMotherboardId();
  const serial =
    process.platform === 'darwin'
      ? normalizeMachineId(String(raw).match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1])
      : normalizeMachineId(raw);
  if (serial) {
    await context.globalState.update(MACHINE_ID_STATE_KEY, serial);
  }
  return serial;
}

async function startExtensionAnalytics(context) {
  const machineId = await getMachineId(context);
  if (!machineId) {
    return;
  }
  const configuredBase = String(
    vscode.workspace.getConfiguration('xiaoxiaoshuo').get('apiBaseUrl') || ''
  ).trim();
  const apiBase = (configuredBase || 'https://xiaoxiaoshuo.top').replace(/\/+$/, '');

  try {
    await fetch(`${apiBase}/api/extension/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Platform': 'extension'
      },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        machineId,
        eventType: 'app_session',
        sessionId: randomUUID(),
        page: 'plugin',
        metadata: {
          extensionVersion: context.extension.packageJSON.version
        }
      })
    });
  } catch {
    // 插件启动不能被打点网络异常阻断。
  }
}

module.exports = {
  startExtensionAnalytics
};
