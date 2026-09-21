import { extractModelIds } from './modelList';

const POSITIVE = 'masterpiece, best quality, highres, still life, UI icon, game prop, beautiful detailed lighting, glowing, (art style of yingfashi:0.8), (art style of Ask:0.6), volumetric lighting, simple background, white background, isolated';
const NEGATIVE = 'worst quality, low quality, character, human, person, face, text, signature, watermark, multiple items';
const LOCAL_DREAM_NEGATIVE = 'worst quality, low quality, blurry, text, signature, watermark, bad anatomy, bad hands, extra fingers, deformed';

export type ImageApiProtocol = 'openai-compatible' | 'legacy-worker' | 'local-dream';

export interface ImageGeneratorOptions {
  /** 服务根地址、/v1，或完整的 /images/generations 地址。 */
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  size?: string;
  quality?: string;
  negativePrompt?: string;
  /** Local Dream 参数。它们只在 protocol === 'local-dream' 时使用。 */
  steps?: number;
  cfg?: number;
  seed?: number;
  useOpencl?: boolean;
  protocol?: ImageApiProtocol;
}

export interface ConfiguredImageGenerator extends ImageGeneratorOptions {
  enabled: boolean;
}

const trimUrl = (value: unknown) => String(value || '').trim().replace(/\/+$/, '');

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

/** Local Dream 的本机 HTTP 服务默认地址。模型在 Local Dream App 内选择。 */
export function resolveLocalDreamEndpoint(baseUrl = 'http://127.0.0.1:8081'): string {
  const base = trimUrl(baseUrl) || 'http://127.0.0.1:8081';
  return /\/generate$/i.test(base) ? base : `${base}/generate`;
}

/** 读取当前配置，同时把旧版 Worker 配置无缝迁移成可用的配置。 */
export function readConfiguredImageGenerator(): ConfiguredImageGenerator {
  try {
    const raw = JSON.parse(localStorage.getItem('os_api_config') || '{}');
    const config = raw?.imageApi || {};
    const legacy = config as { workerUrl?: unknown; provider?: unknown };
    const hasExplicitLegacyOrRemoteConfig = Boolean(legacy.provider || legacy.workerUrl || config.baseUrl || config.apiKey);
    const isOldEmptyDefault = (config.model === 'gpt-image-1' || !config.model) && !hasExplicitLegacyOrRemoteConfig;
    const protocol = config.protocol === 'legacy-worker'
      ? 'legacy-worker'
      : config.protocol === 'local-dream'
        ? 'local-dream'
        : legacy.provider
          ? 'legacy-worker'
          : isOldEmptyDefault
            ? 'local-dream'
            : 'openai-compatible';
    const isLocalDream = protocol === 'local-dream';
    return {
      // 新安装默认使用本机 Local Dream；已有远程地址的用户保留原设置。
      enabled: config.enabled === true || isLocalDream && !Object.keys(config).length,
      baseUrl: trimUrl(config.baseUrl || legacy.workerUrl) || (isLocalDream ? 'http://127.0.0.1:8081' : ''),
      apiKey: typeof config.apiKey === 'string' ? config.apiKey.trim() : '',
      model: typeof config.model === 'string' && config.model.trim()
        ? config.model.trim()
        : legacy.provider === 'novelai' ? 'novelai' : isLocalDream ? 'sd15-local' : 'gpt-image-1',
      size: typeof config.size === 'string' && config.size.trim() ? config.size.trim() : isLocalDream ? '512x512' : '1024x1024',
      quality: typeof config.quality === 'string' && config.quality.trim() ? config.quality.trim() : 'auto',
      protocol,
    };
  } catch {
    return { enabled: true, baseUrl: 'http://127.0.0.1:8081', apiKey: '', model: 'sd15-local', size: '512x512', quality: 'auto', protocol: 'local-dream' };
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

function isPngBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

/** Local Dream 返回的是原始 RGB/RGBA 像素，不是 PNG；在 WebView 内转成 SullyOS 能保存的 Blob。 */
async function localDreamPixelsToBlob(value: string, width: number, height: number, channels: number): Promise<Blob> {
  const raw = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (isPngBytes(raw)) return new Blob([raw], { type: 'image/png' });
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || ![3, 4].includes(channels)) {
    throw new Error('Local Dream 返回了无法识别的图片尺寸');
  }
  if (raw.length < width * height * channels) throw new Error('Local Dream 返回的图片数据不完整');
  if (typeof document === 'undefined') throw new Error('当前环境无法转换 Local Dream 图片');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前环境无法创建图片画布');
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let src = 0, dst = 0; dst < rgba.length; src += channels, dst += 4) {
    rgba[dst] = raw[src];
    rgba[dst + 1] = raw[src + 1];
    rgba[dst + 2] = raw[src + 2];
    rgba[dst + 3] = channels === 4 ? raw[src + 3] : 255;
  }
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Local Dream 图片转换失败')), 'image/png'));
}

async function responseToLocalDreamBlob(response: Response): Promise<Blob> {
  if (!response.ok) throw new Error(`Local Dream 返回 HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('image/')) return response.blob();

  // 兼容未来版本可能直接返回 JSON，也兼容当前的 text/event-stream。
  const text = await response.text();
  const events: any[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try { events.push(JSON.parse(payload)); } catch { /* 忽略非 JSON SSE 行 */ }
  }
  if (!events.length) {
    try { events.push(JSON.parse(text)); } catch { /* 下面给出统一错误 */ }
  }
  const complete = [...events].reverse().find(event => event?.type === 'complete' || event?.image);
  if (!complete?.image) throw new Error('Local Dream 没有返回图片');
  return localDreamPixelsToBlob(
    complete.image,
    Number(complete.width),
    Number(complete.height),
    Number(complete.channels || 3),
  );
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
export async function generateGalleryImage(coreItem: string, options: ImageGeneratorOptions = {}): Promise<Blob> {
  const baseUrl = trimUrl(options.baseUrl) || (typeof import.meta !== 'undefined' ? trimUrl((import.meta as any).env?.VITE_IMAGE_GENERATOR_WORKER) : '');
  const protocol = options.protocol || (baseUrl ? 'openai-compatible' : 'legacy-worker');
  if (protocol === 'local-dream') {
    const sizeMatch = String(options.size || '512x512').match(/^(\d+)x(\d+)$/i);
    const width = Number(sizeMatch?.[1] || 512);
    const height = Number(sizeMatch?.[2] || 512);
    const response = await fetch(resolveLocalDreamEndpoint(baseUrl || undefined), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        prompt: coreItem.trim().slice(0, 32000),
        negative_prompt: options.negativePrompt?.trim() || LOCAL_DREAM_NEGATIVE,
        // Local Dream 当前 HTTP API 使用正方形尺寸；非正方形先取宽度，避免请求被引擎拒绝。
        size: width,
        ...(Number.isFinite(options.steps) ? { steps: options.steps } : {}),
        ...(Number.isFinite(options.cfg) ? { cfg: options.cfg } : {}),
        ...(Number.isFinite(options.seed) ? { seed: options.seed } : {}),
        ...(options.useOpencl ? { use_opencl: true } : {}),
      }),
    });
    return responseToLocalDreamBlob(response);
  }
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
