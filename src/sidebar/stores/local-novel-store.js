const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { decodeNovel, getNovelTitle, splitNovelText } = require('../../local-novel/parser');

const LOCAL_BOOKS_KEY = 'xiaoxiaoshuo.localNovels';
const MAX_LOCAL_BOOKS = 50;
const MAX_CACHED_BOOKS = 2;

class LocalNovelStore {
  constructor(storage, storageUri) {
    this.storage = storage;
    this.rootDir = storageUri?.fsPath ? path.join(storageUri.fsPath, 'local-novels') : '';
    this.books = this.readBooks();
    this.bookCache = new Map();
  }

  readBooks() {
    const stored = this.storage?.get ? this.storage.get(LOCAL_BOOKS_KEY, []) : [];
    if (!Array.isArray(stored)) {
      return [];
    }

    return stored
      .filter(
        (item) =>
          item &&
          typeof item.id === 'string' &&
          item.id &&
          typeof item.title === 'string' &&
          item.title.trim()
      )
      .slice(0, MAX_LOCAL_BOOKS);
  }

  async importBuffer(buffer, filename) {
    if (!this.rootDir) {
      throw new Error('扩展存储目录不可用。');
    }

    const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const id = crypto.createHash('sha256').update(source).digest('hex').slice(0, 20);
    const title = getNovelTitle(filename) || '未命名小说';
    const chapters = splitNovelText(decodeNovel(source), title);
    const book = {
      id,
      title,
      chapterCount: chapters.length,
      fileSize: source.length,
      sourceFilename: String(filename || ''),
      addedAt: Date.now()
    };

    await fs.mkdir(this.rootDir, { recursive: true });
    await fs.writeFile(
      this.getBookPath(id),
      JSON.stringify({ version: 1, book, chapters }),
      'utf8'
    );
    this.cacheBook(id, { ...book, chapters });
    this.books = [book, ...this.books.filter((item) => item.id !== id)].slice(0, MAX_LOCAL_BOOKS);
    await this.persist();
    return book;
  }

  async getBook(id) {
    const bookId = String(id || '');
    if (!bookId || !this.rootDir) {
      return undefined;
    }
    if (this.bookCache.has(bookId)) {
      return this.bookCache.get(bookId);
    }

    try {
      const parsed = JSON.parse(await fs.readFile(this.getBookPath(bookId), 'utf8'));
      if (!Array.isArray(parsed?.chapters)) {
        return undefined;
      }
      const book = { ...parsed.book, chapters: parsed.chapters };
      this.cacheBook(bookId, book);
      return book;
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) {
        return undefined;
      }
      throw error;
    }
  }

  async remove(id) {
    const bookId = String(id || '');
    if (!bookId) {
      return;
    }

    if (this.rootDir) {
      await fs.unlink(this.getBookPath(bookId)).catch((error) => {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
      });
    }
    this.books = this.books.filter((item) => item.id !== bookId);
    this.bookCache.delete(bookId);
    await this.persist();
  }

  getBookPath(id) {
    return path.join(this.rootDir, `${id}.json`);
  }

  cacheBook(id, book) {
    this.bookCache.delete(id);
    this.bookCache.set(id, book);
    while (this.bookCache.size > MAX_CACHED_BOOKS) {
      this.bookCache.delete(this.bookCache.keys().next().value);
    }
  }

  async persist() {
    if (this.storage?.update) {
      await this.storage.update(LOCAL_BOOKS_KEY, this.books);
    }
  }
}

module.exports = { LocalNovelStore };
