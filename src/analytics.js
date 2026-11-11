const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const ANALYTICS_URL = 'https://xiaoxiaoshuo.top/api/extension/events';
const MACHINE_ID_STATE_KEY = 'xiaoxiaoshuo.pluginMachineId';
const ANALYTICS_DELAY_MS = 3000;
const analyticsSessionId = randomUUID();
let analyticsMachineId = '';
const INVALID_SERIALS = new Set([
  '00000000-0000-0000-0000-000000000000',
  'DEFAULT STRING',
  'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF',
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

async function readFileIfPresent(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function readStableMachineId() {
  if (process.platform === 'win32') {
    const commands = [
      '(Get-CimInstance -ClassName Win32_BaseBoard).SerialNumber',
      '(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID',
      "(Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid).MachineGuid"
    ];
    for (const command of commands) {
      const machineId = normalizeMachineId(
        await readCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command])
      );
      if (machineId) {
        return machineId;
      }
    }
    return '';
  }
  if (process.platform === 'linux') {
    const files = ['/sys/devices/virtual/dmi/id/board_serial', '/sys/class/dmi/id/product_uuid'];
    for (const filePath of files) {
      const machineId = normalizeMachineId(await readFileIfPresent(filePath));
      if (machineId) {
        return machineId;
      }
    }
    return '';
  }
  if (process.platform === 'darwin') {
    const value = await readCommand('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
    return normalizeMachineId(String(value).match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1]);
  }
  return '';
}

async function getMachineId(context) {
  if (analyticsMachineId) {
    return analyticsMachineId;
  }
  const cached = normalizeMachineId(context.globalState.get(MACHINE_ID_STATE_KEY));
  if (cached) {
    analyticsMachineId = cached;
    return cached;
  }
  const machineId =
    (await readStableMachineId()) || randomUUID().replace(/-/g, '').slice(0, 24).toUpperCase();
  await context.globalState.update(MACHINE_ID_STATE_KEY, machineId);
  analyticsMachineId = machineId;
  return machineId;
}

async function sendAnalyticsEvent(context, event) {
  try {
    const machineId = await getMachineId(context);
    if (!machineId) {
      return;
    }
    await fetch(ANALYTICS_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Platform': 'extension'
      },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        machineId,
        sessionId: analyticsSessionId,
        ...event
      })
    });
  } catch {
    // 打点必须完全无感，任何异常都不能影响插件功能。
  }
}

function buildSearchMetadata(page) {
  const items = Array.isArray(page?.items) ? page.items : [];
  const groups = Array.isArray(page?.groups) ? page.groups : [];
  const modeCounts = items.reduce(
    (counts, item) => {
      if (item.mode === 'app') counts.app += 1;
      if (item.mode === 'web') counts.web += 1;
      return counts;
    },
    { app: 0, web: 0 }
  );
  const searchMode = modeCounts.app >= modeCounts.web ? 'app' : 'web';

  return {
    query: String(page?.query || '')
      .trim()
      .slice(0, 100),
    resultCount: items.length,
    freeResultCount: items.length,
    hasFreeFullBook: items.length > 0,
    searchMode,
    searchModes: modeCounts,
    failedSourceCount: groups.filter((group) => group.error).length,
    sourceResults: groups.map((group) => ({
      source: group.source,
      label: group.label,
      freeResultCount: Array.isArray(group.items) ? group.items.length : 0,
      filteredResultCount: 0,
      error: group.error || ''
    }))
  };
}

function getReaderBookTitle(page) {
  const explicit = String(page?.bookTitle || '').trim();
  if (explicit) {
    return explicit;
  }
  const title = String(page?.title || '').trim();
  const quoted = title.match(/《([^》]+)》/);
  if (quoted) {
    return quoted[1].trim();
  }
  const separated = title.split(/\s+\|\s+/);
  return (separated.length > 1 ? separated.at(-1) : title).trim();
}

function trackSearch(context, page, error) {
  const metadata = buildSearchMetadata(page);
  if (error) {
    metadata.error = String(error instanceof Error ? error.message : error).slice(0, 200);
  }
  void sendAnalyticsEvent(context, {
    eventType: 'search',
    page: 'search',
    metadata
  });
}

function trackReaderOpen(context, page, eventType = 'reader_open') {
  void sendAnalyticsEvent(context, {
    eventType,
    page: 'reader',
    bookTitle: getReaderBookTitle(page),
    chapterUrl: String(page?.url || ''),
    metadata: {
      source: page?.source || '',
      chapterTitle: String(page?.title || '')
    }
  });
}

function trackReaderSession(context, page, durationMs) {
  if (durationMs < 1000) {
    return;
  }
  void sendAnalyticsEvent(context, {
    eventType: 'reader_session',
    page: 'reader',
    bookTitle: getReaderBookTitle(page),
    chapterUrl: String(page?.url || ''),
    durationMs: Math.max(0, Math.round(durationMs)),
    metadata: {
      source: page?.source || '',
      chapterTitle: String(page?.title || '')
    }
  });
}

async function startExtensionAnalytics(context) {
  await sendAnalyticsEvent(context, {
    eventType: 'app_session',
    page: 'plugin',
    metadata: {
      extensionVersion: context.extension.packageJSON.version
    }
  });
}

function scheduleExtensionAnalytics(context) {
  const timer = setTimeout(() => {
    void startExtensionAnalytics(context);
  }, ANALYTICS_DELAY_MS);
  timer.unref?.();
}

module.exports = {
  buildSearchMetadata,
  getReaderBookTitle,
  scheduleExtensionAnalytics,
  trackReaderOpen,
  trackReaderSession,
  trackSearch
};
