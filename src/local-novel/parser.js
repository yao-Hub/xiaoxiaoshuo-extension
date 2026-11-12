const path = require('node:path');

const MAX_CHAPTER_TITLE_LENGTH = 80;
const FALLBACK_CHAPTER_SIZE = 8000;
const CHAPTER_HEADING =
  /^\s*(?:第[0-9０-９零〇一二三四五六七八九十百千万两]+[章节回](?:(?:[：:、.\-—]\s*|\s+).{0,60})?|(?:序章|楔子|引子|序言|前言|后记|尾声|最终章|大结局)(?:[：:、.\-—]\s*.{0,60})?|番外(?:篇)?(?:\s*[0-9０-９零〇一二三四五六七八九十百千万两]+)?(?:[：:、.\-—]\s*.{0,60})?|Chapter\s+\d+(?:[：:.\-—]?\s*.{0,60})?)\s*$/i;

function decodeNovel(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (!bytes.length) {
    throw new Error('文件内容为空。');
  }

  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }

  const content =
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    text = new TextDecoder('gb18030').decode(content);
  }

  if (!text.trim()) {
    throw new Error('文件内容为空。');
  }
  return text;
}

function splitNovelText(text, fallbackTitle = '未命名小说') {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\u0000')
    .join('')
    .split('\n');
  const headings = [];

  lines.forEach((line, index) => {
    const title = line.trim();
    if (title.length <= MAX_CHAPTER_TITLE_LENGTH && CHAPTER_HEADING.test(title)) {
      headings.push({ title, lineIndex: index });
    }
  });

  if (!headings.length) {
    return splitIntoFallbackChapters(lines);
  }

  const chapters = [];
  const preamble = cleanParagraphs(lines.slice(0, headings[0].lineIndex).join('\n'));
  headings.forEach((heading, index) => {
    const end = headings[index + 1]?.lineIndex ?? lines.length;
    const body = cleanParagraphs(lines.slice(heading.lineIndex + 1, end).join('\n'));
    if (body) {
      chapters.push({ title: heading.title, content: body });
    } else if (chapters.length) {
      chapters[chapters.length - 1].title += ` ${heading.title}`;
    }
  });

  if (preamble && chapters.length) {
    chapters[0].content = `${preamble}\n\n${chapters[0].content}`;
  }
  if (!chapters.length) {
    return splitIntoFallbackChapters(lines, fallbackTitle);
  }
  return chapters;
}

function splitIntoFallbackChapters(lines, fallbackTitle = '正文') {
  const paragraphs = cleanParagraphs(lines.join('\n')).split(/\n{2,}/);
  const chapters = [];
  let content = '';

  for (const paragraph of paragraphs) {
    const nextContent = content ? `${content}\n\n${paragraph}` : paragraph;
    if (content && nextContent.length > FALLBACK_CHAPTER_SIZE) {
      chapters.push({
        title: `${fallbackTitle} ${chapters.length + 1}`,
        content
      });
      content = paragraph;
    } else {
      content = nextContent;
    }
  }

  if (content) {
    chapters.push({
      title: chapters.length ? `${fallbackTitle} ${chapters.length + 1}` : fallbackTitle,
      content
    });
  }
  if (!chapters.length) {
    throw new Error('没有识别到可阅读的小说正文。');
  }
  return chapters;
}

function cleanParagraphs(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getNovelTitle(filename) {
  return path.basename(String(filename || ''), path.extname(String(filename || ''))).trim();
}

module.exports = {
  decodeNovel,
  getNovelTitle,
  splitNovelText
};
