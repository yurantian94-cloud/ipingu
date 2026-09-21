import { describe, expect, it } from 'vitest';
import type { BookRecord, ReadingNote } from '../types';
import { buildReaderContextSnapshot, formatReaderContextBlock } from './readerContext';

describe('OmniReader context snapshot', () => {
  it('only exposes a currently-reading book and its newest note', () => {
    const books: BookRecord[] = [
      { id: 'active', title: '故事', author: '作者甲', status: 'READING', review: '', createdAt: 1, updatedAt: 1 },
      { id: 'done', title: '旧书', author: '作者乙', status: 'FINISHED', review: '', createdAt: 1, updatedAt: 1 },
    ];
    const notes: ReadingNote[] = [
      { id: 'early', bookId: 'active', timestamp: 2, type: 'EXCERPT', content: '较早摘抄' },
      { id: 'late', bookId: 'active', timestamp: 3, type: 'THOUGHT', content: ' 最新  想法 ' },
    ];
    const snapshot = buildReaderContextSnapshot(books, notes);
    expect(snapshot.readingBooks).toEqual([{ id: 'active', title: '故事', author: '作者甲', latestNote: '最新 想法' }]);
    expect(formatReaderContextBlock(snapshot)).toContain('《故事》（作者：作者甲）。最近的一条笔记是：最新 想法');
  });
});
