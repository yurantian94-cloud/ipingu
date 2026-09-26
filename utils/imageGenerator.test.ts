import { describe, expect, it } from 'vitest';
import { readConfiguredImageGenerator, resolveImageGenerationEndpoint, resolveImageModelsEndpoint } from './imageGenerator';

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

  it('keeps image generation disabled until a unified API is configured', () => {
    localStorage.removeItem('os_api_config');
    expect(readConfiguredImageGenerator()).toMatchObject({
      enabled: false,
      baseUrl: '',
      model: 'gpt-image-1',
      size: '1024x1024',
      gallerySize: '1024x1024',
      protocol: 'openai-compatible',
    });
  });
});
