import { GalleryStore } from './galleryStore';
import { generateImage, readConfiguredImageGenerator } from './imageGenerator';

const completed = new Set<string>();
const fallback = () => new Blob([new Uint8Array([137,80,78,71,13,10,26,10])], { type: 'image/png' });

export async function unlockAchievement(input: { key: string; title: string; description: string; coreItem: string; notify?: (message: string) => void }) {
  if (completed.has(input.key)) return null;
  const existing = (await GalleryStore.list()).find(item => item.type === 'ACHIEVEMENT' && item.achievementKey === input.key);
  if (existing) { completed.add(input.key); return existing; }
  let blob: Blob;
  try {
    const imageApi = readConfiguredImageGenerator();
    if (!imageApi.enabled || !imageApi.baseUrl) throw new Error('生图 API 未启用');
    blob = await generateImage(input.coreItem, { ...imageApi, size: imageApi.gallerySize });
  } catch { blob = fallback(); }
  const item = await GalleryStore.add({ type: 'ACHIEVEMENT', title: input.title, description: input.description, coreItem: input.coreItem, achievementKey: input.key, imageBlob: blob });
  completed.add(input.key);
  input.notify?.(`🏆 达成成就：${input.title}，快去纪念馆看看吧！`);
  return item;
}
