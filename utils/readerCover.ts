/** 将用户选取的封面压缩至最长边 400px，并以 JPEG Blob 保存在 IndexedDB。 */
export const compressReaderCover = async (file: File, maxDimension = 400): Promise<Blob> => {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('封面图片无法读取')); img.src = url; });
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('封面压缩失败')), 'image/jpeg', 0.82));
  } finally { URL.revokeObjectURL(url); }
};
