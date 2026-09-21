import type { ImageApiConfig } from '../types';

/** 生图 API 单独保存的方案，不和聊天/识图/语音 API 共用。 */
export interface ImageApiProfile {
  id: string;
  name: string;
  config: ImageApiConfig;
  updatedAt: number;
}

export const IMAGE_API_PROFILES_STORAGE_KEY = 'os_image_api_profiles';
export const IMAGE_API_ACTIVE_PROFILE_STORAGE_KEY = 'os_image_api_active_profile';

const localDreamDefaults: ImageApiConfig = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:8081',
  apiKey: '',
  model: 'sd15-local',
  size: '512x512',
  quality: 'auto',
  protocol: 'local-dream',
};

const normalizeConfig = (value: unknown, fallback: ImageApiConfig): ImageApiConfig => {
  const raw = value && typeof value === 'object' ? value as Partial<ImageApiConfig> : {};
  const protocol = raw.protocol === 'legacy-worker' || raw.protocol === 'local-dream'
    ? raw.protocol
    : 'openai-compatible';
  return {
    enabled: raw.enabled === true,
    baseUrl: String(raw.baseUrl ?? fallback.baseUrl ?? '').trim().replace(/\/+$/, ''),
    apiKey: String(raw.apiKey ?? fallback.apiKey ?? '').trim(),
    model: String(raw.model ?? fallback.model ?? '').trim(),
    size: String(raw.size ?? fallback.size ?? '1024x1024').trim() || '1024x1024',
    quality: String(raw.quality ?? fallback.quality ?? 'auto').trim() || 'auto',
    protocol,
  };
};

const makeId = () => `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * 没有新方案记录时，把当前生图配置迁移成第一张卡片。
 * 这样旧用户已有的 NewAPI 不会被强制改成本机 Local Dream。
 */
export function readImageApiProfiles(currentConfig?: ImageApiConfig): ImageApiProfile[] {
  const fallback = currentConfig || localDreamDefaults;
  const shouldUseLocalDream = fallback.protocol === 'local-dream'
    || (!fallback.baseUrl && !fallback.apiKey && (!fallback.model || fallback.model === 'gpt-image-1'));
  const seedConfig = shouldUseLocalDream ? localDreamDefaults : fallback;
  try {
    const raw = JSON.parse(localStorage.getItem(IMAGE_API_PROFILES_STORAGE_KEY) || 'null');
    if (Array.isArray(raw)) {
      const profiles = raw
        .filter(item => item && typeof item === 'object')
        .map(item => ({
          id: String(item.id || makeId()),
          name: String(item.name || '未命名生图方案').trim() || '未命名生图方案',
          config: normalizeConfig(item.config, fallback),
          updatedAt: Number(item.updatedAt) || Date.now(),
        }));
      if (profiles.length) return profiles;
    }
  } catch {
    // 本地缓存损坏时回到当前配置，不影响其它 API。
  }
  return [{
    id: 'image-default',
    name: shouldUseLocalDream ? '默认 Local Dream' : '当前生图方案',
    config: normalizeConfig(seedConfig, localDreamDefaults),
    updatedAt: Date.now(),
  }];
}

export function writeImageApiProfiles(profiles: ImageApiProfile[]) {
  try {
    localStorage.setItem(IMAGE_API_PROFILES_STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    // 隐私模式/存储空间不足时，当前配置仍然会由 os_api_config 保存。
  }
}

export function readActiveImageApiProfileId(profiles: ImageApiProfile[]): string {
  if (!profiles.length) return '';
  try {
    const id = localStorage.getItem(IMAGE_API_ACTIVE_PROFILE_STORAGE_KEY);
    if (id && profiles.some(profile => profile.id === id)) return id;
  } catch {
    // ignore
  }
  return profiles[0].id;
}

export function writeActiveImageApiProfileId(id: string) {
  try { localStorage.setItem(IMAGE_API_ACTIVE_PROFILE_STORAGE_KEY, id); } catch { /* ignore */ }
}

export function createImageApiProfile(name: string, config: ImageApiConfig): ImageApiProfile {
  return { id: makeId(), name: name.trim() || '未命名生图方案', config: normalizeConfig(config, localDreamDefaults), updatedAt: Date.now() };
}
