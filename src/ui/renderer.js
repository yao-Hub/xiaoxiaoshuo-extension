const { renderClientScript } = require('./webview/client');
const { WEBVIEW_STYLES } = require('./webview/styles');
const { escapeAttribute, escapeHtml, escapeScriptJson } = require('../core/html');
const { isLikelyUrl } = require('../core/url');

function createNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';

  for (let i = 0; i < 32; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return text;
}

function getDisplayTitle(value, fallback) {
  const text = String(value || '').trim();
  return text && !isLikelyUrl(text) ? text : fallback;
}

function getPanelTitle(page) {
  if (page && page.kind === 'search') {
    const query = getDisplayTitle(page.query, '');
    return query ? `搜索: ${query}` : '搜索';
  }

  if (page && page.kind === 'history') {
    return '历史';
  }

  if (page && page.kind === 'bookshelf') {
    return '书架';
  }

  if (page && page.kind === 'local-list') {
    const title = getDisplayTitle(page.title, '');
    return title ? `本地: ${title}` : '本地小说';
  }

  if (page && page.kind === 'local-chapter') {
    const title = getDisplayTitle(page.title, '');
    return title ? `本地阅读: ${title}` : '本地阅读';
  }

  if (!page || !page.kind) {
    return '小小小说';
  }

  if (page.kind === 'list') {
    const title = getDisplayTitle(page.title, '');
    return title ? `列表: ${title}` : '列表';
  }

  if (page.kind === 'chapter') {
    const title = getDisplayTitle(page.title, '');
    return title ? `阅读: ${title}` : '阅读';
  }

  if (page.kind === 'catalog-unavailable') {
    const title = getDisplayTitle(page.title, '');
    return title ? `阅读: ${title}` : '暂无目录';
  }

  return '小小小说';
}

function renderLoadingHtml(
  webview,
  url,
  history = [],
  value = url,
  backAvailable = false,
  forwardAvailable = false
) {
  return renderShell(webview, {
    kind: 'loading',
    url,
    value,
    history,
    backAvailable,
    forwardAvailable,
    title: '正在加载',
    body: '<div class="status">正在读取页面内容。</div>'
  });
}

function renderErrorHtml(
  webview,
  url,
  message,
  history = [],
  value = url,
  backAvailable = false,
  forwardAvailable = false
) {
  return renderShell(webview, {
    kind: 'error',
    url,
    value,
    history,
    backAvailable,
    forwardAvailable,
    title: '读取失败',
    body: `<div class="status error">${escapeHtml(message)}</div>`
  });
}

function renderSearchLoadingHtml(
  webview,
  query,
  history = [],
  backAvailable = false,
  forwardAvailable = false
) {
  return renderShell(webview, {
    kind: 'loading',
    url: '',
    value: query,
    mode: 'title',
    history,
    backAvailable,
    forwardAvailable,
    title: '正在搜索',
    body: '<div class="status">正在搜索已支持的小说网站。</div>'
  });
}

function renderSearchErrorHtml(
  webview,
  query,
  message,
  history = [],
  backAvailable = false,
  forwardAvailable = false
) {
  return renderShell(webview, {
    kind: 'error',
    url: '',
    value: query,
    mode: 'title',
    history,
    backAvailable,
    forwardAvailable,
    title: '搜索失败',
    body: `<div class="status error">${escapeHtml(message)}</div>`
  });
}

function renderHomeHtml(
  webview,
  url,
  history = [],
  searchHistory = [],
  backAvailable = false,
  forwardAvailable = false
) {
  return renderShell(webview, {
    kind: 'home',
    url,
    history,
    searchHistory,
    backAvailable,
    forwardAvailable,
    title: '小小小说',
    pageTitle: '小小小说',
    body: '<div class="status">在上方输入书名或地址，然后按回车读取。</div>'
  });
}

function renderPageHtml(webview, page, history = [], searchHistory = []) {
  if (!page) {
    return renderErrorHtml(webview, '', '页面内容为空。');
  }

  if (page.kind === 'search') {
    return renderShell(webview, {
      kind: 'search',
      url: '',
      value: page.query || '',
      mode: 'title',
      title: page.title || '搜索',
      pageTitle: getPanelTitle(page),
      backAvailable: Boolean(page.backAvailable),
      forwardAvailable: Boolean(page.forwardAvailable),
      history,
      searchHistory,
      body: renderSearchBody(page)
    });
  }

  if (page.kind === 'history') {
    return renderShell(webview, {
      kind: 'history',
      url: '',
      value: '',
      title: '历史',
      pageTitle: '历史',
      backAvailable: Boolean(page.backAvailable),
      forwardAvailable: Boolean(page.forwardAvailable),
      history,
      searchHistory,
      body: renderHistoryPageBody(history, searchHistory)
    });
  }

  if (page.kind === 'bookshelf') {
    return renderShell(webview, {
      kind: 'bookshelf',
      url: '',
      value: '',
      title: '书架',
      pageTitle: '书架',
      backAvailable: Boolean(page.backAvailable),
      forwardAvailable: Boolean(page.forwardAvailable),
      history,
      searchHistory,
      body: renderBookshelfBody(page.items)
    });
  }

  if (page.kind === 'local-list') {
    return renderShell(webview, {
      kind: 'local-list',
      url: '',
      value: '',
      title: page.title || '本地小说',
      pageTitle: getPanelTitle(page),
      backAvailable: Boolean(page.backAvailable),
      forwardAvailable: Boolean(page.forwardAvailable),
      history,
      searchHistory,
      body: renderLocalCatalogBody(page)
    });
  }

  if (page.kind === 'local-chapter') {
    return renderShell(webview, {
      kind: 'local-chapter',
      url: '',
      value: '',
      title: page.title || '本地阅读',
      pageTitle: getPanelTitle(page),
      backAvailable: Boolean(page.backAvailable),
      forwardAvailable: Boolean(page.forwardAvailable),
      history,
      searchHistory,
      body: renderLocalChapterBody(page)
    });
  }

  if (page.kind === 'list') {
    return renderShell(webview, {
      kind: 'list',
      url: page.url,
      value: page.value || page.url,
      title: page.title || '列表',
      pageTitle: getPanelTitle(page),
      backAvailable: Boolean(page.backAvailable),
      forwardAvailable: Boolean(page.forwardAvailable),
      history,
      searchHistory,
      body: renderListBody(page)
    });
  }

  if (page.kind === 'catalog-unavailable') {
    return renderShell(webview, {
      kind: 'catalog-unavailable',
      url: '',
      value: page.title || '暂无目录',
      title: '暂无目录',
      pageTitle: getPanelTitle(page),
      backAvailable: Boolean(page.backAvailable),
      forwardAvailable: Boolean(page.forwardAvailable),
      history,
      searchHistory,
      body: renderCatalogUnavailableBody(page)
    });
  }

  return renderShell(webview, {
    kind: 'chapter',
    url: page.url,
    value: page.value || page.url,
    title: page.title || '阅读',
    pageTitle: getPanelTitle(page),
    backAvailable: Boolean(page.backAvailable),
    forwardAvailable: Boolean(page.forwardAvailable),
    prevUrl: page.prevUrl || '',
    nextUrl: page.nextUrl || '',
    content: page.content || '',
    history,
    searchHistory,
    body: renderChapterBodyWithToc(page)
  });
}

function renderHistoryPage(
  webview,
  history = [],
  searchHistory = [],
  backAvailable = false,
  forwardAvailable = false
) {
  return renderPageHtml(
    webview,
    {
      kind: 'history',
      url: '',
      title: '历史',
      history,
      searchHistory,
      backAvailable,
      forwardAvailable
    },
    history,
    searchHistory
  );
}

function renderHistoryPageBody(history, _searchHistory) {
  const readItems = Array.isArray(history) ? history.slice(0, 20) : [];
  const readButtons = readItems
    .map((item) => {
      const url = typeof item === 'string' ? item : item.url || '';
      const title = getDisplayTitle(typeof item === 'string' ? item : item.title, '未命名阅读记录');
      if (!url) {
        return '';
      }
      return `
        <div class="history-page-row">
          <input class="history-select-input" type="checkbox" data-history-select value="${escapeAttribute(url)}" aria-label="选择这条阅读历史">
          <button class="history-page-link" type="button" data-open-url="${escapeAttribute(url)}">
            <span class="history-title">${escapeHtml(title)}</span>
          </button>
        </div>`;
    })
    .join('');

  return `
    <section class="history-view">
      <div class="history-section-head">
        <h2>阅读历史</h2>
        ${readItems.length ? '<button class="history-manage-toggle" type="button" data-toggle-history-management>管理</button>' : ''}
      </div>
      ${
        readItems.length
          ? `
        <div class="history-manage-actions" hidden>
          <button class="history-manage-button" type="button" data-select-all-history>全选</button>
          <button class="history-manage-button" type="button" data-delete-selected-history>删除选中</button>
          <button class="history-manage-button danger" type="button" data-clear-reading-history>全部删除</button>
        </div>`
          : ''
      }
      ${readItems.length ? readButtons : '<div class="history-empty">暂无阅读历史</div>'}
    </section>`;
}

function renderBookshelfBody(books) {
  const items = Array.isArray(books) ? books : [];
  const rows = items
    .map((item) => {
      const isLocal = item.kind === 'local' && item.localId;
      const openAttribute = isLocal
        ? `data-open-local-book="${escapeAttribute(item.localId)}"`
        : `data-open-url="${escapeAttribute(item.url)}"`;
      const meta = isLocal
        ? `本地 TXT · ${Number(item.chapterCount) || 1} 章`
        : item.author || '在线阅读';
      const title = getDisplayTitle(item.title, '未命名书籍');

      return `
      <div class="bookshelf-row">
        <button class="history-page-link bookshelf-link" type="button" ${openAttribute}>
          <span class="history-title">${escapeHtml(title)}</span>
          <span class="history-meta">${escapeHtml(meta)}</span>
        </button>
        <button class="bookshelf-remove" type="button" data-remove-bookshelf="${escapeAttribute(item.key)}">移出</button>
      </div>`;
    })
    .join('');

  return `
    <section class="bookshelf-view">
      <div class="bookshelf-head">
        <h1>书架</h1>
        <button class="button bookshelf-upload-button" type="button" data-upload-local-novel>上传本地小说</button>
      </div>
      ${items.length ? `<div class="bookshelf-list">${rows}</div>` : '<div class="history-empty">书架为空</div>'}
    </section>`;
}

function renderLocalCatalogBody(page) {
  const items = Array.isArray(page.items) ? page.items : [];
  const rows = items
    .map(
      (item) => `
      <tr>
        <td class="title-cell">
          <button class="item-link" type="button" data-open-local-chapter="${escapeAttribute(
            item.index
          )}" data-local-book-id="${escapeAttribute(page.localBookId)}">${escapeHtml(
            item.text || `第 ${item.index + 1} 章`
          )}</button>
        </td>
      </tr>`
    )
    .join('');

  return `
    <section class="local-catalog-view">
      <div class="local-book-summary">
        <h1>${escapeHtml(getDisplayTitle(page.title, '本地小说'))}</h1>
        <p>本地 TXT · 共 ${items.length} 章</p>
      </div>
      ${
        items.length
          ? `<table class="list-table"><tbody>${rows}</tbody></table>`
          : '<div class="history-empty">这本小说还没有章节</div>'
      }
    </section>`;
}

function renderLocalChapterBody(page) {
  const bookId = escapeAttribute(page.localBookId);
  const prevDisabled = Number.isInteger(page.prevIndex) ? '' : 'disabled';
  const nextDisabled = Number.isInteger(page.nextIndex) ? '' : 'disabled';
  const navigation = (position) => `
    <nav class="chapter-nav${position === 'top' ? ' chapter-nav-top' : ''}" aria-label="章节导航">
      <button class="nav-button" type="button" data-open-local-chapter="${escapeAttribute(
        page.prevIndex ?? ''
      )}" data-local-book-id="${bookId}" ${prevDisabled}>上一章</button>
      <button class="nav-button nav-directory" type="button" data-open-local-catalog="${bookId}">目录</button>
      <button class="nav-button" type="button" data-open-local-chapter="${escapeAttribute(
        page.nextIndex ?? ''
      )}" data-local-book-id="${bookId}" ${nextDisabled}>下一章</button>
    </nav>`;

  return `
    <article class="chapter-view">
      <div class="chapter-title-row">
        <h1>${escapeHtml(getDisplayTitle(page.title, '本地阅读'))}</h1>
      </div>
      <p class="source">${escapeHtml(getDisplayTitle(page.bookTitle, '本地小说'))} · 第 ${
        Number(page.localChapterIndex) + 1
      } / ${Number(page.chapterCount) || 1} 章</p>
      ${navigation('top')}
      <div class="content">${renderChapterContent(page)}</div>
      ${navigation('bottom')}
    </article>`;
}

function renderSearchSuggestions(searchHistory) {
  const queryItems = Array.isArray(searchHistory) ? searchHistory.slice(0, 20) : [];
  if (!queryItems.length) {
    return '';
  }

  const rows = queryItems
    .map(
      (query) => `
      <div class="suggestion-row">
        <button class="suggestion-query" type="button" data-search-query="${escapeAttribute(query)}">${escapeHtml(query)}</button>
        <button class="suggestion-remove" type="button" data-delete-search-query="${escapeAttribute(query)}" aria-label="删除这条搜索历史">×</button>
      </div>`
    )
    .join('');

  return `
    <div class="search-suggestions" id="searchSuggestions" hidden>
      <div class="suggestions-head">
        <span>搜索历史</span>
        ${queryItems.length ? '<button class="suggestions-clear" type="button" data-clear-search-history>清除全部</button>' : ''}
      </div>
      ${rows}
    </div>`;
}

function renderSearchBody(page) {
  const groups = Array.isArray(page.groups) ? page.groups : [];
  const pendingCount = Math.max(0, Number(page.pendingCount) || 0);
  const items = Array.isArray(page.items)
    ? page.items
    : groups.flatMap((group) => (Array.isArray(group.items) ? group.items : []));
  const rows = items
    .map((item) => {
      const readingUrl = item.url || '';
      const catalogUrl = item.chaptersUrl || '';
      return `
      <div class="search-row">
        <button class="search-link" type="button" data-open-url="${escapeAttribute(catalogUrl || readingUrl)}" data-reading-url="${escapeAttribute(readingUrl)}" data-item-title="${escapeAttribute(item.text || '')}"${catalogUrl ? '' : ' data-catalog-missing="true"'}>
          <span class="search-title">${escapeHtml(getDisplayTitle(item.text, '未命名书籍'))}</span>
          ${item.meta ? `<span class="search-meta">${escapeHtml(item.meta)}</span>` : ''}
        </button>
      </div>`;
    })
    .join('');
  const summary = pendingCount
    ? `共找到 ${items.length} 个结果，正在继续搜索…`
    : `共找到 ${items.length} 个结果。`;

  return `
    <section class="search-view">
      <h1>“${escapeHtml(page.query || '')}” 的搜索结果</h1>
      <p class="search-summary">${summary}</p>
      <div class="search-results-flat">
        ${rows || '<div class="search-empty">没有找到相关作品</div>'}
      </div>
    </section>`;
}

function renderCatalogUnavailableBody(page) {
  return `
    <section class="catalog-unavailable-view">
      <h1>${escapeHtml(getDisplayTitle(page.title, '暂无目录'))}</h1>
      <div class="status">暂无目录</div>
      <button class="button catalog-start-button" type="button" data-open-url="${escapeAttribute(page.readingUrl)}">开始阅读</button>
    </section>`;
}

function renderListBody(page) {
  const items = Array.isArray(page.items) ? page.items.slice(0, 5000) : [];

  if (!items.length) {
    return '<div class="status">未识别到列表项。</div>';
  }

  const rows = items
    .map(
      (item) => `
      <tr>
        <td class="title-cell">
          <button class="item-link" type="button" data-open-url="${escapeAttribute(item.url)}">${escapeHtml(getDisplayTitle(item.text, '未命名章节'))}</button>
        </td>
      </tr>`
    )
    .join('');

  return `
    <section class="list-view">
      <table class="list-table">
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function renderTocBody(page) {
  const items = Array.isArray(page.toc) ? page.toc : [];

  if (!items.length) {
    return '';
  }

  return `
    <section class="toc-section">
      <h2>目录</h2>
      ${renderTocList(items, page.url || '')}
    </section>`;
}

function renderTocList(items, currentUrl) {
  const rows = items
    .map((item) => {
      const isActive = item.url && item.url === currentUrl;
      const title = escapeHtml(getDisplayTitle(item.title, '未命名章节'));
      const link = item.url
        ? `<button class="toc-link${isActive ? ' is-active' : ''}" type="button" data-open-url="${escapeAttribute(item.url)}" ${isActive ? 'aria-current="page"' : ''}>${title}</button>`
        : `<span class="toc-link toc-text">${title}</span>`;
      const children =
        item.children && item.children.length
          ? `<div class="toc-children">${renderTocList(item.children, currentUrl)}</div>`
          : '';

      return `<li class="toc-item">${link}${children}</li>`;
    })
    .join('');

  return `<ul class="toc-list">${rows}</ul>`;
}

function renderChapterBodyWithToc(page) {
  return `
    <article class="chapter-view">
      <div class="chapter-title-row">
        <h1>${escapeHtml(getDisplayTitle(page.title, '阅读'))}</h1>
        <button class="button chapter-shelf-button" type="button" data-add-bookshelf ${page.isInBookshelf ? 'disabled' : ''}>${page.isInBookshelf ? '已在书架' : '加入书架'}</button>
      </div>
      ${renderChapterNavigation(page, 'top')}
      <div class="content">${renderChapterContent(page)}</div>
      ${renderChapterNavigation(page, 'bottom')}
      ${renderTocBody(page)}
    </article>`;
}

function renderChapterContent(page) {
  if (page.contentUnavailable) {
    return `<p class="content-unavailable">${escapeHtml(
      page.contentUnavailableReason || '当前内容暂不可用。'
    )}</p>`;
  }

  return String(page.content || '')
    .split(/\n{2,}/)
    .map((line) => `<p>${escapeHtml(line).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function renderChapterNavigation(page, position) {
  const hasToc = Array.isArray(page.toc) && page.toc.length > 0;
  let directoryAttributes = 'disabled';

  if (hasToc) {
    directoryAttributes = 'data-scroll-toc';
  } else if (page.catalogUrl) {
    directoryAttributes = `data-open-url="${escapeAttribute(page.catalogUrl)}"`;
  } else if (page.backAvailable) {
    directoryAttributes = 'data-go-back';
  }

  return `
    <nav class="chapter-nav${position === 'top' ? ' chapter-nav-top' : ''}" aria-label="章节导航">
      <button class="nav-button" type="button" data-open-url="${escapeAttribute(page.prevUrl || '')}" ${page.prevUrl ? '' : 'disabled'}>上一章</button>
      <button class="nav-button nav-directory" type="button" ${directoryAttributes}>目录</button>
      <button class="nav-button" type="button" data-open-url="${escapeAttribute(page.nextUrl || '')}" ${page.nextUrl ? '' : 'disabled'}>下一章</button>
    </nav>`;
}

function renderShell(webview, page) {
  const nonce = createNonce();
  const searchHistory = Array.isArray(page.searchHistory) ? page.searchHistory : [];
  const addressValue =
    page.kind === 'search' || page.mode === 'title' ? page.value || page.query || '' : '';
  const safeState = escapeScriptJson({
    kind: page.kind,
    value: isLikelyUrl(addressValue) ? '' : addressValue,
    mode: page.mode || (page.kind === 'search' ? 'title' : 'url'),
    canRefresh: Boolean(
      page.url ||
      page.mode === 'title' ||
      page.kind === 'search' ||
      page.kind === 'history' ||
      page.kind === 'local-list' ||
      page.kind === 'local-chapter'
    ),
    title: page.title,
    canGoBack: Boolean(page.backAvailable),
    canGoForward: Boolean(page.forwardAvailable)
  });
  const pageTitle = escapeHtml(page.pageTitle || getPanelTitle(page));
  const bodyClass = page.kind ? `page-${page.kind}` : 'page';
  const backDisabled = page.backAvailable ? '' : 'disabled';
  const forwardDisabled = page.forwardAvailable ? '' : 'disabled';
  const refreshDisabled =
    page.url ||
    page.mode === 'title' ||
    page.kind === 'search' ||
    page.kind === 'history' ||
    page.kind === 'local-list' ||
    page.kind === 'local-chapter'
      ? ''
      : 'disabled';
  const loadingProgress =
    page.kind === 'loading'
      ? '<div class="loading-progress" role="progressbar" aria-label="加载中" aria-valuemin="0" aria-valuemax="100" aria-valuenow="3"><div class="loading-progress-bar"></div></div>'
      : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>${pageTitle}</title>
  <style>${WEBVIEW_STYLES}</style>
</head>
<body class="${bodyClass}">
  <div class="app">
    <form class="toolbar" id="toolbar">
      <button class="button icon-button" id="back" type="button" title="返回" aria-label="返回" ${backDisabled}>
        <svg class="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M19 12H5m6-6-6 6 6 6"></path>
        </svg>
      </button>
      <button class="button icon-button" id="forward" type="button" title="前进" aria-label="前进" ${forwardDisabled}>
        <svg class="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 12h14m-6-6 6 6-6 6"></path>
        </svg>
      </button>
      <div class="address-group" id="addressGroup">
        <input class="address" id="address" type="url" aria-label="地址" spellcheck="false">
      </div>
      <button class="button icon-button" id="refresh" type="button" title="刷新当前页面" aria-label="刷新当前页面" ${refreshDisabled}>
        <svg class="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M21 12a9 9 0 1 1-2.64-6.36"></path>
          <path d="M21 3v6h-6"></path>
        </svg>
      </button>
      <button class="button" id="historyToggle" type="button" title="历史记录" aria-expanded="false">历史</button>
      <button class="button" id="bookshelfToggle" type="button" title="我的书架" aria-expanded="false">书架</button>
    </form>
    ${renderSearchSuggestions(searchHistory)}
    ${loadingProgress}
    <main class="reader-shell">
      ${page.body}
    </main>
  </div>
  <div class="toast" id="toast" role="status"></div>
  ${renderClientScript(nonce, safeState)}
</body>
</html>`;
}

module.exports = {
  getPanelTitle,
  renderErrorHtml,
  renderHistoryPage,
  renderHomeHtml,
  renderLoadingHtml,
  renderPageHtml,
  renderSearchBody,
  renderSearchErrorHtml,
  renderSearchLoadingHtml
};
