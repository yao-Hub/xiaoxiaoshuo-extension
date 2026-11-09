const BOOKSHELF_KEY = 'xiaoxiaoshuo.bookshelf';
const MAX_BOOKS = 100;

function getBookKey(page) {
  if (page?.catalogUrl) {
    return `catalog:${page.catalogUrl}`;
  }

  const appMatch = String(page?.url || '').match(
    /^https?:\/\/www\.qimao\.com\/app\/book\/(\d+)\/read\/\d+\/?$/i
  );
  if (appMatch) {
    return `qimao-app:${appMatch[1]}`;
  }

  return page?.url ? `url:${page.url}` : '';
}

class BookshelfStore {
  constructor(storage) {
    this.storage = storage;
    this.books = this.readBooks();
  }

  readBooks() {
    const stored = this.storage && this.storage.get ? this.storage.get(BOOKSHELF_KEY, []) : [];
    if (!Array.isArray(stored)) {
      return [];
    }

    return stored
      .filter(
        (item) =>
          item &&
          typeof item.key === 'string' &&
          item.key &&
          typeof item.url === 'string' &&
          item.url
      )
      .slice(0, MAX_BOOKS);
  }

  hasPage(page) {
    const key = getBookKey(page);
    return Boolean(key && this.books.some((item) => item.key === key));
  }

  async addPage(page) {
    const key = getBookKey(page);
    if (!key || !page) {
      return false;
    }

    const book = {
      key,
      title: String(page.bookTitle || page.title || page.url),
      author: String(page.author || ''),
      url: String(page.catalogUrl || page.url),
      addedAt: Date.now()
    };
    this.books = [book, ...this.books.filter((item) => item.key !== key)].slice(0, MAX_BOOKS);
    await this.persist();
    return true;
  }

  async remove(key) {
    const value = String(key || '');
    if (!value) {
      return;
    }
    this.books = this.books.filter((item) => item.key !== value);
    await this.persist();
  }

  async persist() {
    if (this.storage && this.storage.update) {
      await this.storage.update(BOOKSHELF_KEY, this.books);
    }
  }
}

module.exports = { BookshelfStore, getBookKey };
