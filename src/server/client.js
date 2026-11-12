const { getMachineId } = require('../analytics');

const SERVER_BASE_URL = 'https://xiaoxiaoshuo.top';
const REQUEST_TIMEOUT_MS = 45000;
const REQUEST_TIMEOUT_MESSAGE = '请求超时，请稍后重试。';

function createServerApi(context) {
  const extensionVersion = String(context?.extension?.packageJSON?.version || '');
  let token = '';
  let tokenPromise;

  async function requestToken(force = false) {
    if (!force && token) {
      return token;
    }
    if (!force && tokenPromise) {
      return tokenPromise;
    }

    token = '';
    tokenPromise = (async () => {
      const machineId = await getMachineId(context);
      const response = await fetchWithTimeout(`${SERVER_BASE_URL}/api/extension/session`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Platform': 'extension',
          'X-Extension-Version': extensionVersion
        },
        body: JSON.stringify({ machineId })
      });
      const body = await parseResponse(response);
      if (!body.token) {
        throw new Error('服务器登录失败，请稍后重试。');
      }
      token = body.token;
      return token;
    })();

    try {
      return await tokenPromise;
    } finally {
      tokenPromise = undefined;
    }
  }

  async function request(path, query = {}, options = {}, retried = false, parse = parseResponse) {
    const url = new URL(path, SERVER_BASE_URL);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const authToken = await requestToken(retried);
    const response = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Platform': 'extension',
        'X-Extension-Version': extensionVersion,
        ...(options.headers || {})
      },
      signal: options.signal
    });

    if (response.status === 401 && !retried) {
      return request(path, query, options, true, parse);
    }

    return parse(response);
  }

  async function search(query, options = {}) {
    return request(
      '/api/search',
      {
        q: query,
        page: options.page || 1,
        pageSize: options.pageSize || 50
      },
      {
        ...options,
        headers: {
          accept: 'application/x-ndjson'
        }
      },
      false,
      (response) => parseSearchResponse(response, options)
    );
  }

  async function resolvePage(url, options = {}) {
    options.onProgress?.({ fraction: 0.1, label: '正在连接服务器' });
    const page = await request('/api/resolve', { url }, options);
    options.onProgress?.({ fraction: 0.85, label: '正在解析页面' });
    return mapResolvedPage(page, url);
  }

  return {
    request,
    resolvePage,
    search
  };
}

function mapResolvedPage(page, fallbackUrl) {
  if (page.kind === 'catalog') {
    return {
      kind: 'list',
      source: page.book?.source || 'server',
      url: page.book?.catalogUrl || fallbackUrl,
      title: page.book?.title || '未命名作品',
      bookTitle: page.book?.title || '',
      author: page.book?.author || '',
      coverUrl: page.book?.coverUrl || '',
      items: Array.isArray(page.chapters)
        ? page.chapters.map((chapter) => ({
            text: chapter.title,
            url: chapter.url
          }))
        : []
    };
  }

  return {
    kind: 'chapter',
    source: page.source || 'server',
    url: page.chapterUrl || fallbackUrl,
    title: page.title || '未命名章节',
    content: page.content || '',
    contentUnavailable: Boolean(page.contentUnavailable),
    contentUnavailableReason: page.contentUnavailableReason || '',
    prevUrl: page.prevUrl || '',
    nextUrl: page.nextUrl || '',
    catalogUrl: page.catalogUrl || ''
  };
}

async function parseSearchResponse(response, options) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/x-ndjson')) {
    return parseSearchStream(response, options);
  }
  return parseResponse(response);
}

async function parseSearchStream(response, options) {
  if (!response.ok) {
    return parseResponse(response);
  }
  if (!response.body) {
    throw new Error('搜索连接已断开，请稍后重试。');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result;

  const handleLine = (line) => {
    if (!line) {
      return;
    }

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error('搜索数据格式错误，请稍后重试。');
    }

    if (event.type === 'group') {
      options.onGroup?.(event);
      return;
    }
    if (event.type === 'done') {
      result = event.data;
      return;
    }
    if (event.type === 'error') {
      throw new Error(event.message || '搜索失败，请稍后重试。');
    }
  };

  const consumeLines = (flush = false) => {
    let lineEnd = buffer.indexOf('\n');
    while (lineEnd >= 0) {
      handleLine(buffer.slice(0, lineEnd).trim());
      buffer = buffer.slice(lineEnd + 1);
      lineEnd = buffer.indexOf('\n');
    }
    if (flush && buffer.trim()) {
      handleLine(buffer.trim());
      buffer = '';
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      consumeLines();
    }
    buffer += decoder.decode();
    consumeLines(true);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error && typeof error === 'object' && error.name === 'TimeoutError') {
      throw new Error(REQUEST_TIMEOUT_MESSAGE, { cause: error });
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  if (!result) {
    throw new Error('搜索连接提前结束，请稍后重试。');
  }
  return result;
}

async function parseResponse(response) {
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`服务器返回了无法解析的数据（HTTP ${response.status}）。`);
  }

  if (!response.ok) {
    throw new Error(body.msg || body.error || `服务器请求失败（HTTP ${response.status}）。`);
  }
  if (body && typeof body === 'object' && 'code' in body && 'data' in body) {
    if (body.code !== 0) {
      throw new Error(body.msg || `服务器请求失败（${body.code}）。`);
    }
    return body.data;
  }
  return body;
}

function combineSignals(externalSignal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!externalSignal) {
    return timeoutSignal;
  }
  return typeof AbortSignal.any === 'function'
    ? AbortSignal.any([externalSignal, timeoutSignal])
    : externalSignal;
}

async function fetchWithTimeout(input, options = {}) {
  try {
    return await fetch(input, {
      ...options,
      signal: combineSignals(options.signal, REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    if (error && typeof error === 'object' && error.name === 'TimeoutError') {
      throw new Error(REQUEST_TIMEOUT_MESSAGE, { cause: error });
    }
    throw error;
  }
}

module.exports = {
  createServerApi,
  mapResolvedPage,
  SERVER_BASE_URL
};
