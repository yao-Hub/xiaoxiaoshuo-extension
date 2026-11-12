const assert = require('node:assert/strict');
const test = require('node:test');
const { buildSearchMetadata, getReaderBookTitle } = require('../src/analytics');
const { getSearchTitleScore, normalizeSearchText, searchBooks } = require('../src/search/service');
const { createServerApi, mapResolvedPage } = require('../src/server/client');
const { renderHomeHtml, renderPageHtml } = require('../src/ui/renderer');
const { BookshelfStore } = require('../src/sidebar/stores/bookshelf-store');
const { HistoryStore } = require('../src/sidebar/stores/history-store');
const { NavigationStore } = require('../src/sidebar/stores/navigation-store');
const { isLikelyUrl, normalizeUrl, resolveUrl } = require('../src/core/url');

test('URL normalization accepts HTTP(S) and rejects unsafe schemes', () => {
  assert.deepEqual(normalizeUrl('example.com/book/1'), {
    ok: true,
    url: 'https://example.com/book/1'
  });
  assert.equal(normalizeUrl('javascript:alert(1)').ok, false);
  assert.equal(normalizeUrl('').ok, false);
  assert.equal(isLikelyUrl('https://example.com/book/1'), true);
  assert.equal(isLikelyUrl('完美世界'), false);
  assert.equal(
    resolveUrl('/chapter/2', 'https://example.com/book/1'),
    'https://example.com/chapter/2'
  );
});

test('search title normalization removes punctuation and site suffixes', () => {
  assert.equal(normalizeSearchText('《完美 世界》最新章节'), '完美世界');
});

test('search ranking prefers exact matches over partial matches', () => {
  const query = '完美世界';
  const exact = getSearchTitleScore('完美世界', query);
  const contained = getSearchTitleScore('从完美世界开始', query);
  const unrelated = getSearchTitleScore('盘龙', query);
  assert.ok(exact > contained);
  assert.ok(contained > unrelated);
});

test('search analytics includes queries, modes and source outcomes', () => {
  const metadata = buildSearchMetadata({
    query: '辰东',
    items: [
      { text: '圣墟', mode: 'app' },
      { text: '完美世界', mode: 'app' },
      { text: '神墓', mode: 'web' }
    ],
    groups: [
      { source: 'qimao', label: '七猫', items: [{}, {}], error: '' },
      { source: 'qidian', label: '起点', items: [], error: '请求超时' }
    ]
  });

  assert.equal(metadata.query, '辰东');
  assert.equal(metadata.resultCount, 3);
  assert.deepEqual(metadata.searchModes, { app: 2, web: 1 });
  assert.equal(metadata.failedSourceCount, 1);
  assert.equal(metadata.sourceResults[0].freeResultCount, 2);
  assert.equal(metadata.sourceResults[1].error, '请求超时');
});

test('reader analytics resolves book title from chapter title formats', () => {
  assert.equal(getReaderBookTitle({ bookTitle: '完美世界' }), '完美世界');
  assert.equal(getReaderBookTitle({ title: '第一章 | 辰东《完美世界》' }), '完美世界');
  assert.equal(getReaderBookTitle({ title: '提要 | 东皋录' }), '东皋录');
});

test('search uses server results and maps books into openable items', async () => {
  const updates = [];
  const page = await searchBooks('完美世界', {
    serverApi: {
      async search(query) {
        assert.equal(query, '完美世界');
        return {
          items: [
            {
              title: '完美世界',
              author: '辰东',
              intro: '简介',
              source: 'qidian',
              sourceLabel: '起点中文网',
              catalogUrl: 'https://example.com/book/1/',
              readUrl: 'https://example.com/chapter/1'
            }
          ],
          filteredItems: [],
          groups: [{ source: 'qidian', label: '起点中文网', error: '' }]
        };
      }
    },
    onPartialResults(value) {
      updates.push(value);
    }
  });

  assert.equal(page.items[0].text, '完美世界');
  assert.equal(page.items[0].chaptersUrl, 'https://example.com/book/1/');
  assert.equal(page.groups[0].label, '起点中文网');
  assert.equal(updates.length, 1);
});

test('search exposes completed source groups before the final response', async () => {
  const updates = [];
  let responseCompleted = false;
  const page = await searchBooks('完美世界', {
    serverApi: {
      async search(query, options) {
        options.onGroup({
          total: 2,
          group: {
            source: 'qidian',
            label: '起点中文网',
            count: 1,
            filteredCount: 0,
            error: ''
          },
          items: [
            {
              title: '完美世界',
              author: '辰东',
              source: 'qidian',
              sourceLabel: '起点中文网',
              catalogUrl: 'https://example.com/book/1/',
              readUrl: 'https://example.com/chapter/1'
            }
          ],
          filteredItems: []
        });
        assert.equal(responseCompleted, false);
        responseCompleted = true;
        return {
          items: [
            {
              title: '完美世界',
              author: '辰东',
              source: 'qidian',
              sourceLabel: '起点中文网',
              catalogUrl: 'https://example.com/book/1/',
              readUrl: 'https://example.com/chapter/1'
            }
          ],
          filteredItems: [],
          groups: [
            {
              source: 'qidian',
              label: '起点中文网',
              count: 1,
              filteredCount: 0,
              error: ''
            }
          ]
        };
      }
    },
    onPartialResults(value) {
      updates.push(value);
    }
  });

  assert.equal(updates[0].items[0].text, '完美世界');
  assert.equal(updates[0].pendingCount, 1);
  assert.equal(updates.at(-1).pendingCount, 0);
  assert.equal(page.items.length, 1);
});

test('search surfaces server errors without a network-tool hint', async () => {
  await assert.rejects(
    searchBooks('完美世界', {
      serverApi: {
        async search() {
          throw new Error('服务器请求失败（HTTP 503）。');
        }
      }
    }),
    (error) => /服务器请求失败/.test(error.message) && !/科学/.test(error.message)
  );
});

test('server catalog and chapter responses map to plugin pages', () => {
  const catalog = mapResolvedPage(
    {
      kind: 'catalog',
      book: {
        title: '完美世界',
        author: '辰东',
        source: 'qidian',
        catalogUrl: 'https://example.com/book/1/'
      },
      chapters: [{ title: '第一章', url: 'https://example.com/chapter/1' }]
    },
    'https://example.com/book/1/'
  );
  assert.equal(catalog.kind, 'list');
  assert.equal(catalog.items[0].text, '第一章');
  assert.equal(catalog.bookTitle, '完美世界');

  const chapter = mapResolvedPage(
    {
      kind: 'chapter',
      title: '第一章',
      content: '正文',
      source: 'qidian',
      chapterUrl: 'https://example.com/chapter/1',
      catalogUrl: 'https://example.com/book/1/',
      prevUrl: '',
      nextUrl: 'https://example.com/chapter/2'
    },
    'https://example.com/chapter/1'
  );
  assert.equal(chapter.kind, 'chapter');
  assert.equal(chapter.content, '正文');
  assert.equal(chapter.nextUrl, 'https://example.com/chapter/2');
});

test('server requests include the extension version header', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), headers: options.headers });
    const data = String(url).endsWith('/api/extension/session')
      ? { token: 'test-token' }
      : { items: [], filteredItems: [], groups: [] };
    return new Response(JSON.stringify({ code: 0, msg: 'ok', data }), { status: 200 });
  };

  try {
    const api = createServerApi({
      extension: { packageJSON: { version: '0.1.6' } },
      globalState: {
        get: () => 'TEST-MACHINE-ID',
        update: async () => undefined
      }
    });
    await api.search('完美世界');
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers['X-Extension-Version'], '0.1.6');
  assert.equal(requests[1].headers['X-Extension-Version'], '0.1.6');
  assert.equal(requests[1].headers.accept, 'application/x-ndjson');
});

test('streaming search forwards source groups before its final result', async () => {
  const originalFetch = global.fetch;
  const encoder = new TextEncoder();
  const events = [
    {
      type: 'group',
      total: 2,
      group: {
        source: 'qidian',
        label: '起点中文网',
        count: 1,
        filteredCount: 0,
        error: ''
      },
      items: [{ title: '完美世界' }],
      filteredItems: []
    },
    {
      type: 'done',
      data: {
        query: '完美世界',
        mode: 'all',
        items: [{ title: '完美世界' }],
        filteredItems: [],
        groups: [],
        page: 1,
        pageSize: 50,
        hasMore: false
      }
    }
  ];
  global.fetch = async (url) => {
    if (String(url).endsWith('/api/extension/session')) {
      return new Response(JSON.stringify({ code: 0, msg: 'ok', data: { token: 'test-token' } }), {
        status: 200
      });
    }
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(events.map((event) => `${JSON.stringify(event)}\n`).join(''))
          );
          controller.close();
        }
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/x-ndjson; charset=utf-8' }
      }
    );
  };

  try {
    const api = createServerApi({
      extension: { packageJSON: { version: '0.1.6' } },
      globalState: {
        get: () => 'TEST-MACHINE-ID',
        update: async () => undefined
      }
    });
    const groups = [];
    const result = await api.search('完美世界', {
      onGroup: (event) => groups.push(event)
    });

    assert.equal(groups.length, 1);
    assert.equal(groups[0].group.source, 'qidian');
    assert.equal(result.items[0].title, '完美世界');
  } finally {
    global.fetch = originalFetch;
  }
});

test('server timeouts surface an actionable message', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  };

  try {
    const api = createServerApi({
      extension: { packageJSON: { version: '0.1.6' } },
      globalState: {
        get: () => 'TEST-MACHINE-ID',
        update: async () => undefined
      }
    });
    await assert.rejects(api.search('完美世界'), /请求超时，请稍后重试。/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('webview renderer injects isolated styles and client state', () => {
  const html = renderHomeHtml({}, '');
  assert.match(html, /<style>/);
  assert.match(html, /class="toolbar"/);
  assert.match(html, /id="back"[^>]*aria-label="返回"/);
  assert.match(html, /id="forward"[^>]*aria-label="前进"/);
  assert.match(html, /id="refresh"[^>]*aria-label="刷新当前页面"/);
  assert.match(html, /id="historyToggle"[^>]*>历史<\/button>/);
  assert.match(html, /id="bookshelfToggle"[^>]*>书架<\/button>/);
  assert.doesNotMatch(html, /id="load"/);
  assert.match(html, /toolbar\.requestSubmit\(\)/);
  assert.match(html, /const state =/);
  assert.doesNotMatch(html, /\$\{safeState\}/);
});

test('webview renderer shows a neutral message for unavailable content', () => {
  const html = renderPageHtml(
    {},
    {
      kind: 'chapter',
      title: '会员章节',
      content: '',
      contentUnavailable: true,
      contentUnavailableReason: '该章节需要会员，当前暂不提供正文。',
      url: 'https://example.com/chapter/1',
      prevUrl: '',
      nextUrl: ''
    }
  );
  assert.match(html, /class="content-unavailable"/);
  assert.match(html, /该章节需要会员，当前暂不提供正文。/);
  assert.match(html, /data-add-bookshelf[^>]*>加入书架<\/button>/);
});

test('search results are flat and always open the catalog', () => {
  const page = {
    kind: 'search',
    query: '完美世界',
    items: [
      {
        text: '完美世界',
        meta: '辰东',
        chaptersUrl: 'https://example.com/book/1/',
        url: 'https://example.com/book/1/1.html'
      }
    ],
    groups: [
      {
        source: 'example',
        label: '示例站点',
        items: [
          {
            text: '完美世界',
            meta: '辰东',
            chaptersUrl: 'https://example.com/book/1/',
            url: 'https://example.com/book/1/1.html'
          }
        ],
        error: ''
      }
    ]
  };
  const html = renderPageHtml({}, page);
  assert.doesNotMatch(html, /id="searchModeFilter"/);
  assert.doesNotMatch(html, /class="search-group/);
  assert.doesNotMatch(html, /class="button search-action"/);
  assert.match(html, /class="search-results-flat"/);
  assert.match(html, /data-open-url="https:\/\/example\.com\/book\/1\/"/);
  assert.match(html, /data-reading-url="https:\/\/example\.com\/book\/1\/1\.html"/);
});

test('catalog unavailable page offers a start reading action', () => {
  const html = renderPageHtml(
    {},
    {
      kind: 'catalog-unavailable',
      title: '示例作品',
      readingUrl: 'https://example.com/chapter/1'
    }
  );

  assert.match(html, /暂无目录/);
  assert.match(
    html,
    /class="button catalog-start-button"[^>]*data-open-url="https:\/\/example\.com\/chapter\/1"/
  );
});

test('bookshelf page lists saved books with a remove action', () => {
  const html = renderPageHtml(
    {},
    {
      kind: 'bookshelf',
      items: [
        {
          key: 'catalog:https://example.com/book/1',
          title: '完美世界',
          author: '辰东',
          url: 'https://example.com/book/1'
        }
      ]
    }
  );

  assert.match(html, /class="bookshelf-view"/);
  assert.match(html, /完美世界/);
  assert.match(html, /data-remove-bookshelf="catalog:https:\/\/example\.com\/book\/1"/);
});

test('search results only show the current result count', () => {
  const page = {
    kind: 'search',
    query: '完美世界',
    pendingCount: 2,
    items: [{ text: '完美世界', chaptersUrl: 'https://example.com/book/1/' }],
    groups: [
      {
        source: 'example',
        label: '示例站点',
        items: [{ text: '完美世界', chaptersUrl: 'https://example.com/book/1/' }],
        error: '示例站点搜索失败'
      }
    ]
  };
  const html = renderPageHtml({}, page);

  assert.match(html, /共找到 1 个结果，正在继续搜索…/);
  assert.doesNotMatch(html, /网站搜索失败|部分来源搜索失败|class="search-alert"/);
  assert.doesNotMatch(html, /\.search-alert\s*\{/);

  page.pendingCount = 0;
  const completedHtml = renderPageHtml({}, page);
  assert.match(completedHtml, /共找到 1 个结果。/);
  assert.doesNotMatch(completedHtml, /网站搜索失败|部分来源搜索失败|class="search-alert"/);
});

test('history store deduplicates and persists history', async () => {
  const values = new Map();
  const storage = {
    get(key, fallback) {
      return values.has(key) ? values.get(key) : fallback;
    },
    async update(key, value) {
      values.set(key, value);
    }
  };
  const store = new HistoryStore(storage);
  await store.rememberSearch('完美世界');
  await store.rememberSearch('盘龙');
  await store.rememberSearch('完美世界');
  assert.deepEqual(store.searchHistory, ['完美世界', '盘龙']);
  await store.deleteSearchHistory('盘龙');
  assert.deepEqual(store.searchHistory, ['完美世界']);
});

test('bookshelf store persists books and avoids duplicates', async () => {
  const values = new Map();
  const storage = {
    get(key, fallback) {
      return values.has(key) ? values.get(key) : fallback;
    },
    async update(key, value) {
      values.set(key, value);
    }
  };
  const store = new BookshelfStore(storage);
  const page = {
    kind: 'chapter',
    title: '第一章 | 完美世界',
    bookTitle: '完美世界',
    author: '辰东',
    url: 'https://example.com/chapter/1',
    catalogUrl: 'https://example.com/book/1'
  };

  await store.addPage(page);
  await store.addPage(page);
  assert.equal(store.books.length, 1);
  assert.equal(store.books[0].title, '完美世界');
  assert.equal(store.books[0].url, 'https://example.com/book/1');
  assert.equal(store.hasPage(page), true);

  await store.remove(store.books[0].key);
  assert.equal(store.books.length, 0);
});

test('navigation store maintains bounded back and forward state', () => {
  const navigation = new NavigationStore();
  navigation.pushCurrent({ kind: 'home' });
  navigation.pushForward({ kind: 'chapter', url: 'https://example.com/2' });
  assert.equal(navigation.backAvailable, true);
  assert.equal(navigation.forwardAvailable, true);
  assert.deepEqual(navigation.takeForward(), {
    kind: 'chapter',
    url: 'https://example.com/2'
  });
  assert.equal(navigation.forwardAvailable, false);
});

test('bookshelf pages do not enter route history', () => {
  const navigation = new NavigationStore();
  navigation.pushCurrent({ kind: 'bookshelf' });
  navigation.pushForward({ kind: 'bookshelf' });

  assert.equal(navigation.backAvailable, false);
  assert.equal(navigation.forwardAvailable, false);
});
