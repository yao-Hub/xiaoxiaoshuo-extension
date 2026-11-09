const crypto = require('crypto');
const JSZip = require('jszip');
const {
  createBrowserHeaders,
  createJsonHeaders,
  fetchBinary,
  fetchHtml,
  fetchJson
} = require('../../core/http');
const {
  extractAnchors,
  cleanNovelText,
  extractTitle,
  htmlToText,
  normalizeText,
  stripNoisyBlocks
} = require('../../core/html');
const { requestHeaders, sign } = require('../../search/app/qimao-sign');

const BOOK_PATTERN = /^\/shuku\/(\d+)\/?$/i;
const CHAPTER_PATTERN = /^\/shuku\/(\d+)-(\d+)\/?$/i;
const APP_READER_PATTERN = /^\/app\/book\/(\d+)\/read\/(\d+)\/?$/i;
const APP_BOOK_CACHE_LIMIT = 2;
const APP_BOOK_CACHE_TTL = 10 * 60 * 1000;
const APP_CONTENT_KEY = Buffer.from('32343263636238323330643730396531', 'hex');
const appBookCache = new Map();

function match(url) {
  try {
    const parsed = new URL(url);
    return (
      /(^|\.)qimao\.com$/i.test(parsed.hostname) &&
      (BOOK_PATTERN.test(parsed.pathname) ||
        CHAPTER_PATTERN.test(parsed.pathname) ||
        APP_READER_PATTERN.test(parsed.pathname))
    );
  } catch {
    return false;
  }
}

function getBookTitle(html, fallbackUrl) {
  const keyword = String(html).match(
    /<meta\b[^>]*name=["']keywords["'][^>]*content=["'][^"']*《([^》]+)》/i
  );
  if (keyword) {
    return normalizeText(keyword[1]);
  }

  const title = extractTitle(html, fallbackUrl);
  return title.split(/(?:免费阅读|最新章节|全文免费阅读)/i)[0].trim() || title;
}

function getChapterTitle(html, fallbackUrl) {
  const match = String(html).match(
    /<h2\b[^>]*class=["'][^"']*\bchapter-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i
  );
  return match ? normalizeText(htmlToText(match[1])) : extractTitle(html, fallbackUrl);
}

function extractQimaoChapterContent(html) {
  const candidates = [];
  const articlePatterns = [
    /<div\b[^>]*class=["'][^"']*\bchapter-detail-article\b[^"']*["'][^>]*>[\s\S]*?<div\b[^>]*class=["'][^"']*\barticle\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<div\b[^>]*class=["'][^"']*\barticle\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi
  ];

  for (const pattern of articlePatterns) {
    for (const match of String(html).matchAll(pattern)) {
      const content = cleanNovelText(htmlToText(match[1]));
      if (content) {
        candidates.push(content);
      }
    }
  }

  return candidates.sort((a, b) => b.length - a.length)[0] || '';
}

function buildAppReaderUrl(bookId, chapterNumber) {
  return `https://www.qimao.com/app/book/${bookId}/read/${chapterNumber}/`;
}

function buildSignedQuery(params) {
  const signedParams = { ...params, sign: sign(params) };
  return new URLSearchParams(signedParams).toString();
}

async function getAppBook(bookId, options = {}) {
  const cached = appBookCache.get(bookId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }
  appBookCache.delete(bookId);

  const detailQuery = buildSignedQuery({
    id: bookId,
    imei_ip: '2937357107',
    teeny_mode: '0'
  });
  const detailData = await fetchJson(`https://api-bc.wtzw.com/api/v4/book/detail?${detailQuery}`, {
    headers: requestHeaders(bookId),
    timeoutMs: 30000,
    signal: options.signal
  });
  const book = detailData?.data?.book;
  if (!book?.link) {
    throw new Error('七猫没有返回可用的正文文件。');
  }

  const { buffer } = await fetchBinary(book.link, {
    headers: createBrowserHeaders(),
    timeoutMs: 30000,
    signal: options.signal
  });
  const archive = await JSZip.loadAsync(buffer);
  const entries = Object.keys(archive.files)
    .map((name) => {
      const number = Number(name.match(/^(\d+)\.epub$/i)?.[1]) || 0;
      return { name, number };
    })
    .filter((entry) => entry.number > 0)
    .sort((left, right) => left.number - right.number);
  if (!entries.length) {
    throw new Error('七猫正文文件中没有可阅读章节。');
  }

  const appBook = {
    book,
    archive,
    entries,
    expiresAt: Date.now() + APP_BOOK_CACHE_TTL
  };
  appBookCache.set(bookId, appBook);
  while (appBookCache.size > APP_BOOK_CACHE_LIMIT) {
    appBookCache.delete(appBookCache.keys().next().value);
  }
  return appBook;
}

function decryptAppEntry(encryptedText) {
  const encrypted = Buffer.from(String(encryptedText || ''), 'base64');
  if (encrypted.length <= 16) {
    throw new Error('七猫正文章节数据为空。');
  }

  try {
    const decipher = crypto.createDecipheriv(
      'aes-128-cbc',
      APP_CONTENT_KEY,
      encrypted.subarray(0, 16)
    );
    return Buffer.concat([decipher.update(encrypted.subarray(16)), decipher.final()]);
  } catch {
    throw new Error('七猫正文章节解密失败。');
  }
}

async function extractAppEntry(archive, entryName, bookTitle) {
  const encryptedText = await archive.file(entryName).async('string');
  const epub = await JSZip.loadAsync(decryptAppEntry(encryptedText));
  const htmlPaths = Object.keys(epub.files).filter((name) => /\.x?html?$/i.test(name));
  let selected = { content: '', title: '' };

  for (const htmlPath of htmlPaths) {
    const html = await epub.file(htmlPath).async('string');
    const content =
      extractQimaoChapterContent(html) || cleanNovelText(htmlToText(stripNoisyBlocks(html)));
    if (content.length > selected.content.length) {
      selected = {
        content,
        title: extractTitle(html, bookTitle)
      };
    }
  }

  if (!selected.content) {
    throw new Error('七猫正文文件中没有识别到章节内容。');
  }
  return selected;
}

async function loadAppChapter(bookId, chapterNumber, options = {}) {
  const appBook = await getAppBook(bookId, options);
  const entryIndex = appBook.entries.findIndex((entry) => entry.number === chapterNumber);
  if (entryIndex < 0) {
    throw new Error('七猫正文文件中没有找到该章节。');
  }

  const current = appBook.entries[entryIndex];
  const previous = entryIndex > 0 ? appBook.entries[entryIndex - 1] : null;
  const next = entryIndex < appBook.entries.length - 1 ? appBook.entries[entryIndex + 1] : null;
  const chapter = await extractAppEntry(appBook.archive, current.name, appBook.book.title);
  const bookTitle = normalizeText(appBook.book.title);
  const chapterTitle = normalizeText(chapter.title);

  return {
    kind: 'chapter',
    source: 'qimao',
    url: buildAppReaderUrl(bookId, current.number),
    title:
      chapterTitle && bookTitle && chapterTitle !== bookTitle
        ? `${chapterTitle} | ${bookTitle}`
        : chapterTitle || bookTitle,
    content: chapter.content,
    bookTitle,
    author: normalizeText(appBook.book.author),
    contentUnavailable: false,
    prevUrl: previous ? buildAppReaderUrl(bookId, previous.number) : '',
    nextUrl: next ? buildAppReaderUrl(bookId, next.number) : '',
    catalogUrl: ''
  };
}

async function loadBook(bookId, url, options = {}) {
  const headers = createBrowserHeaders();
  const [page, chapterData] = await Promise.all([
    fetchHtml(url, { ...options, headers }),
    fetchJson(`https://www.qimao.com/qimaoapi/api/book/chapter-list?book_id=${bookId}`, {
      headers: createJsonHeaders(url, 'https://www.qimao.com'),
      timeoutMs: 15000,
      signal: options.signal
    })
  ]);
  const chapters =
    chapterData && chapterData.data && Array.isArray(chapterData.data.chapters)
      ? chapterData.data.chapters
      : [];
  const items = chapters
    .filter((chapter) => chapter && chapter.id && chapter.title)
    .map((chapter) => ({
      text: normalizeText(chapter.title),
      url: `https://www.qimao.com/shuku/${bookId}-${chapter.id}/`
    }));

  if (!items.length) {
    throw new Error('七猫没有识别到章节目录。');
  }

  return {
    kind: 'list',
    source: 'qimao',
    url,
    title: getBookTitle(page.html, page.url),
    items
  };
}

async function loadChapter(bookId, url, options = {}) {
  const { html, url: finalUrl } = await fetchHtml(url, {
    ...options,
    headers: createBrowserHeaders()
  });
  const content = extractQimaoChapterContent(html);

  const anchors = extractAnchors(html, finalUrl);
  const prev = anchors.find((item) => /^(上一章|上一页|上一篇)$/i.test(item.text));
  const next = anchors.find((item) => /^(下一章|下一页|下一篇)$/i.test(item.text));
  const chapterMatch = new URL(finalUrl).pathname.match(CHAPTER_PATTERN);
  const resolvedBookId = bookId || (chapterMatch ? chapterMatch[1] : '');

  return {
    kind: 'chapter',
    source: 'qimao',
    url: finalUrl,
    title: getChapterTitle(html, finalUrl),
    content,
    contentUnavailable: !content,
    contentUnavailableReason: content ? '' : '该章节需要七猫会员，当前来源暂不提供正文。',
    prevUrl: prev ? prev.url : '',
    nextUrl: next ? next.url : '',
    catalogUrl: resolvedBookId ? `https://www.qimao.com/shuku/${resolvedBookId}/` : ''
  };
}

async function load(url, options = {}) {
  const pathname = new URL(url).pathname;
  const appMatch = pathname.match(APP_READER_PATTERN);
  if (appMatch) {
    return loadAppChapter(String(appMatch[1]), Number(appMatch[2]), options);
  }

  const bookMatch = pathname.match(BOOK_PATTERN);
  if (bookMatch) {
    return loadBook(bookMatch[1], url, options);
  }

  const chapterMatch = pathname.match(CHAPTER_PATTERN);
  if (!chapterMatch) {
    throw new Error('没有识别到七猫书籍或章节 ID。');
  }
  return loadChapter(chapterMatch[1], url, options);
}

module.exports = {
  extractQimaoChapterContent,
  load,
  match
};
