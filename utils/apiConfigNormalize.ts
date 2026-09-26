import type { APIConfig, ApiPreset } from '../types';

// Clipboard contents can carry zero-width characters that String.trim() does not
// remove. They are never valid at the edges of an API URL, token, or model id.
const EDGE_INVISIBLE_CHARS = /^[\s\u200B-\u200D\u2060\uFEFF]+|[\s\u200B-\u200D\u2060\uFEFF]+$/g;

const cleanEdgeCharacters = (value: unknown): string =>
  String(value ?? '').replace(EDGE_INVISIBLE_CHARS, '');

export const normalizeApiBaseUrl = (value: unknown): string =>
  cleanEdgeCharacters(value).replace(/\/+$/, '');

export const normalizeApiCredential = (value: unknown): string =>
  cleanEdgeCharacters(value);

export const normalizeApiModel = (value: unknown): string =>
  cleanEdgeCharacters(value);

export const normalizeSquareImageSize = (value: unknown): string => {
  const match = cleanEdgeCharacters(value).match(/^(\d+)x(\d+)$/i);
  if (!match || match[1] !== match[2]) return '1024x1024';
  const side = Math.max(256, Math.min(2048, Number(match[1])));
  return `${side}x${side}`;
};

export function normalizeApiConfig(config: APIConfig): APIConfig {
  const visionApi = config.visionApi;
  const imageApi = config.imageApi;
  return {
    ...config,
    baseUrl: normalizeApiBaseUrl(config.baseUrl),
    apiKey: normalizeApiCredential(config.apiKey),
    model: normalizeApiModel(config.model),
    ...(visionApi ? {
      visionApi: {
        enabled: visionApi.enabled === true,
        baseUrl: normalizeApiBaseUrl(visionApi.baseUrl),
        apiKey: normalizeApiCredential(visionApi.apiKey),
        model: normalizeApiModel(visionApi.model),
      },
    } : {}),
    ...(imageApi ? {
      imageApi: {
        // Local Dream 已移除；导入旧备份时关闭这条旧配置，避免继续请求本机服务。
        enabled: (imageApi as any).protocol === 'local-dream' ? false : imageApi.enabled === true,
        // workerUrl/provider 是旧版字段。导入旧备份时仍可正常迁移到新接口设置。
        baseUrl: (imageApi as any).protocol === 'local-dream' ? '' : normalizeApiBaseUrl(imageApi.baseUrl || (imageApi as any).workerUrl),
        apiKey: normalizeApiCredential(imageApi.apiKey),
        model: (imageApi as any).protocol === 'local-dream' ? 'gpt-image-1' : normalizeApiModel(imageApi.model) || 'gpt-image-1',
        size: (imageApi as any).protocol === 'local-dream' ? '1024x1024' : normalizeApiModel(imageApi.size) || '1024x1024',
        gallerySize: (imageApi as any).protocol === 'local-dream' ? '1024x1024' : normalizeSquareImageSize((imageApi as any).gallerySize),
        quality: (imageApi as any).protocol === 'local-dream' ? 'auto' : normalizeApiModel(imageApi.quality) || 'auto',
        protocol: imageApi.protocol === 'legacy-worker' || (imageApi as any).provider ? 'legacy-worker' : 'openai-compatible',
      },
    } : {}),
  };
}

export function normalizeApiPreset(preset: ApiPreset): ApiPreset {
  return {
    ...preset,
    name: String(preset.name ?? '').trim(),
    config: normalizeApiConfig(preset.config),
  };
}
