import { extractModelIds } from './modelList';

const POSITIVE = 'masterpiece, best quality, highres, still life, UI icon, game prop, beautiful detailed lighting, glowing, (art style of yingfashi:0.8), (art style of Ask:0.6), volumetric lighting, simple background, white background, isolated';
const NEGATIVE = 'worst quality, low quality, character, human, person, face, text, signature, watermark, multiple items';

export type ImageApiProtocol = 'openai-compatible' | 'legacy-worker';

export interface ImageGeneratorOptions {
  /** 服务根地址、/v1，或完整的 /images/generations 地址。 */
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  size?: string;
  gallerySize?: string;
  quality?: string;
  protocol?: ImageApiProtocol;
}

export interface ConfiguredImageGenerator extends ImageGeneratorOptions {
  enabled: boolean;
}

const trimUrl = (value: unknown) => String(value || '').trim().replace(/\/+$/, '');
const normalizeGallerySize = (value: unknown) => {
  const match = String(value || '').trim().match(/^(\d+)x(\d+)$/i);
  if (!match || match[1] !== match[2]) return '1024x1024';
  const side = Math.max(256, Math.min(2048, Number(match[1])));
  return `${side}x${side}`;
};

/** NewAPI 的地址可以填三种形式，这里统一成生图端点。 */
export function resolveImageGenerationEndpoint(baseUrl: string): string {
  const base = trimUrl(baseUrl);
  if (/\/images\/generations$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return `${base}/images/generations`;
  return `${base}/v1/images/generations`;
}

/** 同一个服务的模型列表地址。 */
export function resolveImageModelsEndpoint(baseUrl: string): string {
  const base = trimUrl(baseUrl).replace(/\/images\/generations$/i, '');
  if (/\/v1$/i.test(base)) return `${base}/models`;
  return `${base}/v1/models`;
}

/** 读取当前配置，同时把旧版 Worker 配置无缝迁移成可用的配置。 */
export function readConfiguredImageGenerator(): ConfiguredImageGenerator {
  try {
    const raw = JSON.parse(localStorage.getItem('os_api_config') || '{}');
    const config = raw?.imageApi || {};
    const legacy = config as { workerUrl?: unknown; provider?: unknown };
    const isRemovedLocalDream = config.protocol === 'local-dream';
    const protocol = config.protocol === 'legacy-worker' || legacy.provider ? 'legacy-worker' : 'openai-compatible';
    return {
      enabled: isRemovedLocalDream ? false : config.enabled === true,
      baseUrl: isRemovedLocalDream ? '' : trimUrl(config.baseUrl || legacy.workerUrl),
      apiKey: typeof config.apiKey === 'string' ? config.apiKey.trim() : '',
      model: typeof config.model === 'string' && config.model.trim()
        ? (isRemovedLocalDream ? 'gpt-image-1' : config.model.trim())
        : legacy.provider === 'novelai' ? 'novelai' : 'gpt-image-1',
      size: typeof config.size === 'string' && config.size.trim() && !isRemovedLocalDream ? config.size.trim() : '1024x1024',
      gallerySize: isRemovedLocalDream ? '1024x1024' : normalizeGallerySize(config.gallerySize),
      quality: typeof config.quality === 'string' && config.quality.trim() ? config.quality.trim() : 'auto',
      protocol,
    };
  } catch {
    return { enabled: false, baseUrl: '', apiKey: '', model: 'gpt-image-1', size: '1024x1024', gallerySize: '1024x1024', quality: 'auto', protocol: 'openai-compatible' };
  }
}

export function wrapImagePrompt(coreItem: string) {
  const safe = coreItem.trim().replace(/[\r\n]+/g, ' ').slice(0, 160);
  return { prompt: `${POSITIVE}, ${safe}`, negativePrompt: NEGATIVE };
}

function base64ToBlob(value: string, mime = 'image/png') {
  const raw = value.includes(',') ? value.split(',')[1] : value;
  const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

async function responseToImageBlob(response: Response): Promise<Blob> {
  if (!response.ok) throw new Error(`图片服务返回 HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('image/')) return response.blob();
  const data = await response.json();
  const item = data?.data?.[0];
  const encoded = data?.image || data?.base64 || item?.b64_json;
  if (typeof encoded === 'string') return base64ToBlob(encoded, data?.mimeType || 'image/png');
  const imageUrl = item?.url || data?.url;
  if (typeof imageUrl === 'string' && imageUrl) {
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) throw new Error(`图片下载失败（HTTP ${imageResponse.status}）`);
    return imageResponse.blob();
  }
  throw new Error('接口没有返回图片数据');
}

/** 拉取 NewAPI / OpenAI 兼容服务的可用模型。 */
export async function fetchImageModels(options: Pick<ImageGeneratorOptions, 'baseUrl' | 'apiKey'>): Promise<string[]> {
  const baseUrl = trimUrl(options.baseUrl);
  if (!baseUrl) throw new Error('请先填写服务地址');
  const response = await fetch(resolveImageModelsEndpoint(baseUrl), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.apiKey?.trim() ? { Authorization: `Bearer ${options.apiKey.trim()}` } : {}) },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return extractModelIds(await response.json());
}

/**
 * NewAPI / OpenAI 兼容：POST /v1/images/generations。
 * legacy-worker 保留给已配置的旧接口，避免已有用户的图片能力失效。
 */
export async function generateImage(coreItem: string, options: ImageGeneratorOptions = {}): Promise<Blob> {
  const baseUrl = trimUrl(options.baseUrl) || (typeof import.meta !== 'undefined' ? trimUrl((import.meta as any).env?.VITE_IMAGE_GENERATOR_WORKER) : '');
  const protocol = options.protocol || (baseUrl ? 'openai-compatible' : 'legacy-worker');
  const endpoint = protocol === 'openai-compatible'
    ? resolveImageGenerationEndpoint(baseUrl)
    : baseUrl || '/api/image-generation';
  const model = options.model?.trim() || 'gpt-image-1';
  const isDallE = /^dall-e-/i.test(model);
  const quality = options.quality?.trim() || 'auto';
  const body = protocol === 'legacy-worker'
    ? model === 'gpt-image-1'
      ? { model, prompt: coreItem.trim().slice(0, 1000), size: options.size?.trim() || '1024x1024' }
      : { ...wrapImagePrompt(coreItem), provider: model || 'novelai' }
    : {
      model,
      prompt: coreItem.trim().slice(0, 32000),
      n: 1,
      size: options.size?.trim() || '1024x1024',
      // DALL·E 只认识 standard/hd；auto 留空便于同一份配置换模型。
      ...(!isDallE || quality !== 'auto' ? { quality } : {}),
      ...(isDallE ? { response_format: 'b64_json' } : {}),
    };
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(options.apiKey?.trim() ? { Authorization: `Bearer ${options.apiKey.trim()}` } : {}) },
    body: JSON.stringify(body),
  });
  return responseToImageBlob(response);
}
