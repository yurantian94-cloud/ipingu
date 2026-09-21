import { DB } from './db';
import type { GalleryItem } from '../types';

/** 星光纪念馆的本地存储门面：图片始终以 Blob 形式写入 IndexedDB。 */
export const GalleryStore = {
  list: () => DB.getStarlightItems(),
  save: (item: GalleryItem) => DB.saveStarlightItem(item),
  remove: (id: string) => DB.deleteStarlightItem(id),
  async add(input: Omit<GalleryItem, 'id' | 'date'> & { id?: string; date?: number }) {
    const item: GalleryItem = { ...input, id: input.id || `starlight_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, date: input.date || Date.now() };
    await DB.saveStarlightItem(item);
    return item;
  },
};

export type { GalleryItem };
