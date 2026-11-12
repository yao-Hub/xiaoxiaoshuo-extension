async function searchBooks(input, options = {}) {
  const query = String(input || '').trim();
  if (!query) {
    throw new Error('请输入要搜索的书名。');
  }
  if (!options.serverApi) {
    throw new Error('搜索服务不可用，请重新加载插件。');
  }

  options.onProgress?.({ fraction: 0.1, label: '正在连接服务器' });
  const streamedGroups = [];
  const streamedBooks = [];
  const response = await options.serverApi.search(query, {
    page: 1,
    pageSize: 50,
    signal: options.signal,
    onGroup: (event) => {
      streamedGroups.push(event.group);
      streamedBooks.push(...(event.items || []), ...(event.filteredItems || []));
      const items = mapServerBooks(streamedBooks, query);
      const totalGroups = Math.max(streamedGroups.length, Number(event.total) || 0);
      options.onPartialResults?.(
        createSearchPage(
          query,
          buildSearchGroups(streamedGroups, items),
          items,
          totalGroups - streamedGroups.length
        )
      );
    }
  });
  throwIfAborted(options.signal);

  const allBooks = [...(response.items || []), ...(response.filteredItems || [])];
  const items = mapServerBooks(allBooks, query);

  const page = createSearchPage(query, buildSearchGroups(response.groups, items), items);
  options.onPartialResults?.(page);
  options.onProgress?.({ fraction: 0.95, label: '搜索结果已返回' });
  return page;
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    const error = new Error('请求已取消。');
    error.name = 'AbortError';
    throw error;
  }
}

function mapServerBooks(books, query) {
  const seen = new Set();
  return sortSearchItems(
    books
      .filter((book) => {
        const key = `${book.source}:${book.catalogUrl || book.readUrl}`;
        if (!book.title || !key || seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .map((book) => ({
        text: book.title,
        meta: book.author || '',
        intro: book.intro || '',
        chaptersUrl: book.catalogUrl || book.readUrl || '',
        url: book.readUrl || book.catalogUrl || '',
        coverUrl: book.coverUrl || '',
        source: book.source || '',
        sourceLabel: book.sourceLabel || '',
        requiresMembership: Boolean(book.requiresMembership),
        unavailableReason: book.unavailableReason || ''
      })),
    query
  );
}

function createSearchPage(query, groups, items, pendingCount = 0) {
  return {
    kind: 'search',
    source: 'search',
    url: '',
    query,
    title: `搜索：${query}`,
    pendingCount,
    groups,
    items
  };
}

function buildSearchGroups(sourceGroups, items) {
  const groups = new Map();
  for (const group of Array.isArray(sourceGroups) ? sourceGroups : []) {
    groups.set(group.source, {
      source: group.source,
      label: group.label || group.source,
      items: [],
      error: String(group.error || '')
    });
  }
  for (const item of items) {
    const source = item.source || 'server';
    if (!groups.has(source)) {
      groups.set(source, {
        source,
        label: item.sourceLabel || source,
        items: [],
        error: ''
      });
    }
    groups.get(source).items.push(item);
  }
  return [...groups.values()].sort((left, right) => {
    if (Boolean(left.error) !== Boolean(right.error)) {
      return left.error ? 1 : -1;
    }
    return right.items.length - left.items.length;
  });
}

function sortSearchItems(items, query) {
  return items
    .map((item, index) => ({
      item,
      index,
      score: getSearchTitleScore(item.text || '', query)
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ item }) => item);
}

function getSearchTitleScore(title, query) {
  const normalizedTitle = normalizeSearchText(title);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedTitle || !normalizedQuery) {
    return 0;
  }

  if (normalizedTitle === normalizedQuery) {
    return 100000;
  }

  if (normalizedTitle.startsWith(normalizedQuery)) {
    return 80000 - Math.abs(normalizedTitle.length - normalizedQuery.length);
  }

  const containedAt = normalizedTitle.indexOf(normalizedQuery);
  if (containedAt >= 0) {
    return 60000 - containedAt * 100 - Math.abs(normalizedTitle.length - normalizedQuery.length);
  }

  if (normalizedQuery.includes(normalizedTitle)) {
    return 40000 - Math.abs(normalizedTitle.length - normalizedQuery.length);
  }

  let sharedPrefix = 0;
  while (
    sharedPrefix < normalizedTitle.length &&
    sharedPrefix < normalizedQuery.length &&
    normalizedTitle[sharedPrefix] === normalizedQuery[sharedPrefix]
  ) {
    sharedPrefix += 1;
  }

  const titleCharacters = new Set(normalizedTitle);
  let sharedCharacters = 0;
  for (const character of new Set(normalizedQuery)) {
    if (titleCharacters.has(character)) {
      sharedCharacters += 1;
    }
  }

  return (
    sharedPrefix * 100 +
    sharedCharacters * 10 -
    Math.abs(normalizedTitle.length - normalizedQuery.length)
  );
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .replace(/(?:txt|最新章节|全文阅读|无弹窗|全文免费阅读)$/u, '');
}

module.exports = {
  buildSearchGroups,
  getSearchTitleScore,
  normalizeSearchText,
  searchBooks
};
