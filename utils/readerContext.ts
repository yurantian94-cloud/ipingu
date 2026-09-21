import type { BookRecord, ReadingNote } from '../types';

export const READER_CONTEXT_STORAGE_KEY = 'sully_omni_reader_context_v1';

export interface ReaderContextSnapshot {
  readingBooks: Array<{ id: string; title: string; author: string; latestNote: string | null }>;
  updatedAt: number;
}

export const buildReaderContextSnapshot = (books: BookRecord[], notes: ReadingNote[]): ReaderContextSnapshot => ({
  readingBooks: books.filter(book => book.status === 'READING').slice(0, 3).map(book => ({
    id: book.id,
    title: book.title,
    author: book.author,
    latestNote: notes.filter(note => note.bookId === book.id)
      .sort((a, b) => b.timestamp - a.timestamp)[0]?.content.replace(/\s+/g, ' ').trim().slice(0, 180) || null,
  })),
  updatedAt: Date.now(),
});

export const readReaderContextSnapshot = (): ReaderContextSnapshot | null => {
  try {
    const raw = localStorage.getItem(READER_CONTEXT_STORAGE_KEY);
    const value = raw ? JSON.parse(raw) as ReaderContextSnapshot : null;
    return value && Array.isArray(value.readingBooks) ? value : null;
  } catch { return null; }
};

export const writeReaderContextSnapshot = (snapshot: ReaderContextSnapshot): void => {
  try { localStorage.setItem(READER_CONTEXT_STORAGE_KEY, JSON.stringify(snapshot)); } catch { /* IndexedDB remains authoritative. */ }
};

export const formatReaderContextBlock = (snapshot = readReaderContextSnapshot()): string => {
  const book = snapshot?.readingBooks[0];
  if (!book) return '';
  let result = `### 用户的阅读状态 (OmniReader)\n【阅读状态】用户目前正在阅读《${book.title}》（作者：${book.author || '未知'}）。`;
  if (book.latestNote) result += `最近的一条笔记是：${book.latestNote}`;
  return `${result}\n当话题自然相关时，可把这本书当作你们共同的阅读背景，而不是每轮都主动提及。\n\n`;
};
