import type { ReadingNoteType } from '../types';
import { createBook, createReadingNote, findBookByTitle, refreshReaderContextSnapshot } from './readerStore';

const NOTE_TAG_RE = /\[\[ADD_BOOK_NOTE:\s*(\{[\s\S]*?\})\s*\]\]/gi;

/** 将 AI 的阅读闪念标签写入本地手账；无论解析是否成功，标签都不会显示在聊天气泡中。 */
export const executeReaderDirectives = async (
  content: string,
  addToast: (message: string, type: 'info' | 'success' | 'error') => void,
  timestamp?: number,
): Promise<string> => {
  const matches = [...content.matchAll(NOTE_TAG_RE)];
  const clean = content.replace(NOTE_TAG_RE, '').trim();
  for (const match of matches) {
    try {
      const data = JSON.parse(match[1]) as { bookTitle?: unknown; type?: unknown; content?: unknown; pageNumber?: unknown };
      const title = typeof data.bookTitle === 'string' ? data.bookTitle.trim() : '';
      const noteContent = typeof data.content === 'string' ? data.content : '';
      if (!title || !noteContent.trim()) throw new Error('missing title or content');
      const type: ReadingNoteType = data.type === 'EXCERPT' ? 'EXCERPT' : 'THOUGHT';
      const book = await findBookByTitle(title) || await createBook({ title, status: 'READING', review: '' });
      const pageNumber = typeof data.pageNumber === 'number' && data.pageNumber > 0 ? Math.floor(data.pageNumber) : undefined;
      await createReadingNote({ bookId: book.id, type, content: noteContent, pageNumber, timestamp });
      addToast(`已记进《${book.title}》的阅读手账`, 'success');
    } catch (error) {
      console.warn('[OmniReader] note directive ignored:', error);
    }
  }
  if (matches.length) await refreshReaderContextSnapshot().catch(error => console.warn('[OmniReader] context snapshot refresh failed:', error));
  return clean;
};
