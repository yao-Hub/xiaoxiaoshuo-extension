const { getMachineId } = require('../analytics');

const SERVER_BASE_URL = 'https://xiaoxiaoshuo.top';
const REQUEST_TIMEOUT_MS = 30000;

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
      const response = await fetch(`${SERVER_BASE_URL}/api/extension/session`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Platform': 'extension',
          'X-Extension-Version': extensionVersion
        },
        body: JSON.stringify({ machineId }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
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

  async function request(path, query = {}, options = {}, retried = false) {
    const url = new URL(path, SERVER_BASE_URL);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const authToken = await requestToken(retried);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'X-Platform': 'extension',
        'X-Extension-Version': extensionVersion
      },
      signal: combineSignals(options.signal, REQUEST_TIMEOUT_MS)
    });

    if (response.status === 401 && !retried) {
      return request(path, query, options, true);
    }

    return parseResponse(response);
  }

  async function search(query, options = {}) {
    return request(
      '/api/search',
      {
        q: query,
        page: options.page || 1,
        pageSize: options.pageSize || 50
      },
      options
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

module.exports = {
  createServerApi,
  mapResolvedPage,
  SERVER_BASE_URL
};
