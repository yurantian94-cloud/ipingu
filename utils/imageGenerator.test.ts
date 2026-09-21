import { describe, expect, it } from 'vitest';
import { readConfiguredImageGenerator, resolveImageGenerationEndpoint, resolveImageModelsEndpoint, resolveLocalDreamEndpoint } from './imageGenerator';

describe('NewAPI image endpoints', () => {
  it('accepts a service root, /v1, or a full generations URL', () => {
    expect(resolveImageGenerationEndpoint('https://api.example.com')).toBe('https://api.example.com/v1/images/generations');
    expect(resolveImageGenerationEndpoint('https://api.example.com/v1/')).toBe('https://api.example.com/v1/images/generations');
    expect(resolveImageGenerationEndpoint('https://api.example.com/v1/images/generations')).toBe('https://api.example.com/v1/images/generations');
  });

  it('uses the matching standard models endpoint', () => {
    expect(resolveImageModelsEndpoint('https://api.example.com')).toBe('https://api.example.com/v1/models');
    expect(resolveImageModelsEndpoint('https://api.example.com/v1/images/generations')).toBe('https://api.example.com/v1/models');
  });

  it('resolves Local Dream to its local generate endpoint', () => {
    expect(resolveLocalDreamEndpoint()).toBe('http://127.0.0.1:8081/generate');
    expect(resolveLocalDreamEndpoint('http://127.0.0.1:8081/')).toBe('http://127.0.0.1:8081/generate');
    expect(resolveLocalDreamEndpoint('http://192.168.1.8:8081/generate')).toBe('http://192.168.1.8:8081/generate');
  });

  it('uses Local Dream as the default when no image API has been configured', () => {
    localStorage.removeItem('os_api_config');
    expect(readConfiguredImageGenerator()).toMatchObject({
      enabled: true,
      baseUrl: 'http://127.0.0.1:8081',
      model: 'sd15-local',
      size: '512x512',
      protocol: 'local-dream',
    });
  });
});
