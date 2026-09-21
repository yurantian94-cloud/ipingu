import type { BookReadingStatus, BookRecord, ReaderDiscussionMessage, ReadingNote, ReadingNoteType } from '../types';
import { buildReaderContextSnapshot, type ReaderContextSnapshot, writeReaderContextSnapshot } from './readerContext';

const DB_NAME = 'SullyOS_OmniReader';
const DB_VERSION = 2;
const BOOKS = 'books';
const NOTES = 'notes';
const DISCUSSIONS = 'discussions';
let dbPromise: Promise<IDBDatabase> | null = null;

const makeId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
const openDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is not available'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BOOKS)) db.createObjectStore(BOOKS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(NOTES)) {
        const notes = db.createObjectStore(NOTES, { keyPath: 'id' });
        notes.createIndex('bookId', 'bookId', { unique: false });
        notes.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains(DISCUSSIONS)) {
        const discussions = db.createObjectStore(DISCUSSIONS, { keyPath: 'id' });
        discussions.createIndex('bookId', 'bookId', { unique: false });
        discussions.createIndex('scopeKey', 'scopeKey', { unique: false });
      }
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => { dbPromise = null; reject(request.error); };
  });
  return dbPromise;
};

const request = <T>(storeName: string, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
  openDB().then(db => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const op = work(transaction.objectStore(storeName));
    op.onsuccess = () => resolve(op.result);
    op.onerror = () => reject(op.error);
    transaction.onerror = () => reject(transaction.error);
  }));

const blobToDataUrl = (blob?: Blob): Promise<string | undefined> => new Promise(resolve => {
  if (!blob) { resolve(undefined); return; }
  const reader = new FileReader();
  reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined);
  reader.onerror = () => resolve(undefined);
  reader.readAsDataURL(blob);
});

const dataUrlToBlob = (value?: string): Blob | undefined => {
  if (!value || !value.startsWith('data:')) return undefined;
  try {
    const comma = value.indexOf(',');
    if (comma < 0) return undefined;
    const head = value.slice(5, comma);
    const body = value.slice(comma + 1);
    const base64 = head.endsWith(';base64');
    const mime = (base64 ? head.slice(0, -7) : head) || 'application/octet-stream';
    const bytes = base64 ? Uint8Array.from(atob(body), c => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(body));
    return new Blob([bytes], { type: mime });
  } catch { return undefined; }
};

export const exportBackup = async () => {
  const [books, notes, discussions] = await Promise.all([getAllBooks(), getAllReadingNotes(), request<ReaderDiscussionMessage[]>(DISCUSSIONS, 'readonly', store => store.getAll())]);
  const readerBooks = await Promise.all(books.map(async book => ({ ...book, coverDataUrl: await blobToDataUrl(book.coverBlob), coverBlob: undefined })));
  return { readerBooks, readerNotes: notes, readerDiscussions: discussions };
};

export const importBackup = async (input: { readerBooks?: Array<BookRecord & { coverDataUrl?: string }>; readerNotes?: ReadingNote[]; readerDiscussions?: ReaderDiscussionMessage[] }) => {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([BOOKS, NOTES, DISCUSSIONS], 'readwrite');
    tx.objectStore(BOOKS).clear(); tx.objectStore(NOTES).clear(); tx.objectStore(DISCUSSIONS).clear();
    for (const book of input.readerBooks || []) {
      const { coverDataUrl, ...rest } = book;
      const coverBlob = dataUrlToBlob(coverDataUrl);
      tx.objectStore(BOOKS).put({ ...rest, ...(coverBlob ? { coverBlob } : {}) });
    }
    for (const note of input.readerNotes || []) tx.objectStore(NOTES).put(note);
    for (const message of input.readerDiscussions || []) tx.objectStore(DISCUSSIONS).put({ ...message, scopeKey: (message as ReaderDiscussionMessage & { scopeKey?: string }).scopeKey || `${message.bookId}:${message.scope}:${message.noteId || ''}` });
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
  await refreshReaderContextSnapshot();
};

export const getAllBooks = () => request<BookRecord[]>(BOOKS, 'readonly', store => store.getAll());
export const getAllReadingNotes = () => request<ReadingNote[]>(NOTES, 'readonly', store => store.getAll());
export const getNotesForBook = (bookId: string) => request<ReadingNote[]>(NOTES, 'readonly', store => store.index('bookId').getAll(bookId));
export const getDiscussionForScope = (bookId: string, scope: ReaderDiscussionMessage['scope'], noteId?: string) =>
  request<(ReaderDiscussionMessage & { scopeKey?: string })[]>(DISCUSSIONS, 'readonly', store => store.index('scopeKey').getAll(`${bookId}:${scope}:${noteId || ''}`))
    .then(items => items.sort((a, b) => a.timestamp - b.timestamp));
export const saveBook = (book: BookRecord) => request<IDBValidKey>(BOOKS, 'readwrite', store => store.put({ ...book, updatedAt: Date.now() })).then(() => undefined);
export const saveNote = (note: ReadingNote) => request<IDBValidKey>(NOTES, 'readwrite', store => store.put(note)).then(() => undefined);
export const deleteBook = async (id: string) => {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([BOOKS, NOTES, DISCUSSIONS], 'readwrite');
    tx.objectStore(BOOKS).delete(id);
    const cursor = tx.objectStore(NOTES).index('bookId').openCursor(IDBKeyRange.only(id));
    cursor.onsuccess = () => { const item = cursor.result; if (item) { item.delete(); item.continue(); } };
    const discussionCursor = tx.objectStore(DISCUSSIONS).index('bookId').openCursor(IDBKeyRange.only(id));
    discussionCursor.onsuccess = () => { const item = discussionCursor.result; if (item) { item.delete(); item.continue(); } };
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
};
export const deleteNote = async (id: string) => {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([NOTES, DISCUSSIONS], 'readwrite');
    tx.objectStore(NOTES).delete(id);
    const cursor = tx.objectStore(DISCUSSIONS).openCursor();
    cursor.onsuccess = () => { const item = cursor.result; if (item) { if (item.value.noteId === id) item.delete(); item.continue(); } };
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
};

export const createBook = async (input: Partial<Omit<BookRecord, 'id' | 'createdAt' | 'updatedAt'>> & Pick<BookRecord, 'title'>): Promise<BookRecord> => {
  const now = Date.now();
  const book: BookRecord = { id: makeId('book'), title: input.title.trim().slice(0, 160) || '未命名书籍', author: (input.author || '').trim().slice(0, 100), coverBlob: input.coverBlob, startDate: input.startDate ?? null, endDate: input.endDate ?? null, status: input.status || 'WISH', review: input.review || '', createdAt: now, updatedAt: now };
  await saveBook(book); return book;
};
export const createReadingNote = async (input: { bookId: string; type: ReadingNoteType; content: string; pageNumber?: number; timestamp?: number }): Promise<ReadingNote> => {
  const content = input.content.replace(/\s+/g, ' ').trim().slice(0, 3000);
  if (!content) throw new Error('Reading note content cannot be empty');
  const note: ReadingNote = { id: makeId('note'), bookId: input.bookId, type: input.type, content, timestamp: input.timestamp ?? Date.now(), ...(input.pageNumber ? { pageNumber: input.pageNumber } : {}) };
  await saveNote(note); return note;
};
export const createDiscussionMessage = async (input: Omit<ReaderDiscussionMessage, 'id' | 'timestamp'> & { timestamp?: number }): Promise<ReaderDiscussionMessage> => {
  const content = input.content.replace(/\s+/g, ' ').trim().slice(0, 4000);
  if (!content) throw new Error('Discussion message cannot be empty');
  const message = { id: makeId('reader-chat'), ...input, content, timestamp: input.timestamp ?? Date.now(), scopeKey: `${input.bookId}:${input.scope}:${input.noteId || ''}` };
  await request<IDBValidKey>(DISCUSSIONS, 'readwrite', store => store.put(message));
  return message;
};
export const findBookByTitle = async (title: string): Promise<BookRecord | undefined> => {
  const query = title.replace(/\s+/g, '').toLowerCase();
  return (await getAllBooks()).find(book => { const name = book.title.replace(/\s+/g, '').toLowerCase(); return name === query || name.includes(query) || query.includes(name); });
};
export const refreshReaderContextSnapshot = async (): Promise<ReaderContextSnapshot> => {
  const [books, notes] = await Promise.all([getAllBooks(), getAllReadingNotes()]);
  const snapshot = buildReaderContextSnapshot(books, notes); writeReaderContextSnapshot(snapshot); return snapshot;
};
export const ReaderStore = { getAllBooks, getAllReadingNotes, getNotesForBook, getDiscussionForScope, saveBook, saveNote, deleteBook, deleteNote, createBook, createReadingNote, createDiscussionMessage, findBookByTitle, refreshReaderContextSnapshot, exportBackup, importBackup };
export type { BookReadingStatus };
