import { describe, expect, it, vi } from 'vitest';
import { executeReaderDirectives } from './readerChat';
import { ReaderStore } from './readerStore';

describe('OmniReader chat directive', () => {
  it('creates a local reading book when no fuzzy title match exists and strips the tag', async () => {
    const title = `测试书-${Date.now()}`;
    const toast = vi.fn();
    const visible = await executeReaderDirectives(`这段很打动我。[[ADD_BOOK_NOTE: {"bookTitle":"${title}","type":"THOUGHT","content":"人物弧光在这里完成了转折"}]]`, toast);
    const book = await ReaderStore.findBookByTitle(title);
    expect(visible).toBe('这段很打动我。');
    expect(book?.status).toBe('READING');
    expect((await ReaderStore.getNotesForBook(book!.id))[0]?.content).toBe('人物弧光在这里完成了转折');
  });
});
