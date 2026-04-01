/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchOpenRouterModelCapabilities,
  modelSupportsImages,
  getVisionModelIds,
  clearModelCapabilitiesCache,
} from '../../src/providers/modelCapabilities.js';
import { supportsVision, isImagePath, getMimeTypeFromExtension } from '../../src/core/ImageManager.js';

describe('modelCapabilities', () => {
  beforeEach(() => {
    clearModelCapabilitiesCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchOpenRouterModelCapabilities', () => {
    it('fetches models from OpenRouter API', async () => {
      const mockModels = {
        data: [
          {
            id: 'anthropic/claude-3.5-sonnet',
            name: 'Claude 3.5 Sonnet',
            architecture: {
              input_modalities: ['image', 'text'],
              output_modalities: ['text'],
            },
          },
          {
            id: 'openai/gpt-4o',
            name: 'GPT-4o',
            architecture: {
              input_modalities: ['image', 'text'],
              output_modalities: ['text'],
            },
          },
          {
            id: 'openai/gpt-4',
            name: 'GPT-4',
            architecture: {
              input_modalities: ['text'],
              output_modalities: ['text'],
            },
          },
        ],
      };

      const originalFetch = globalThis.fetch;
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockModels),
      });
      (globalThis as any).fetch = fetchMock;

      try {
        const result = await fetchOpenRouterModelCapabilities();

        expect(result).toHaveLength(3);
        expect(result[0].id).toBe('anthropic/claude-3.5-sonnet');
        expect(result[0].architecture?.input_modalities).toContain('image');
        expect(fetchMock).toHaveBeenCalledWith(
          'https://openrouter.ai/api/v1/models',
          expect.objectContaining({
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });

    it('caches results and returns cached data on subsequent calls', async () => {
      const mockModels = {
        data: [{ id: 'test/model', name: 'Test' }],
      };

      const originalFetch = globalThis.fetch;
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockModels),
      });
      (globalThis as any).fetch = fetchMock;

      try {
        const result1 = await fetchOpenRouterModelCapabilities();
        const result2 = await fetchOpenRouterModelCapabilities();

        expect(result1).toEqual(result2);
        expect(fetchMock).toHaveBeenCalledTimes(1); // Only one fetch due to caching
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });

    it('returns cached data on network failure if cache exists', async () => {
      const mockModels = {
        data: [{ id: 'test/model', name: 'Test' }],
      };

      const originalFetch = globalThis.fetch;
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockModels),
        })
        .mockRejectedValueOnce(new Error('Network error'));

      (globalThis as any).fetch = fetchMock;

      try {
        const result1 = await fetchOpenRouterModelCapabilities();
        expect(result1).toHaveLength(1);

        // Second call should use cache even though fetch would fail
        const result2 = await fetchOpenRouterModelCapabilities();
        expect(result2).toHaveLength(1);
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });

    it('throws error when API fails and no cache exists', async () => {
      const originalFetch = globalThis.fetch;
      const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'));
      (globalThis as any).fetch = fetchMock;

      try {
        await expect(fetchOpenRouterModelCapabilities()).rejects.toThrow('Network error');
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });

    it('handles empty or malformed API response', async () => {
      const originalFetch = globalThis.fetch;
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}), // No 'data' field
      });
      (globalThis as any).fetch = fetchMock;

      try {
        const result = await fetchOpenRouterModelCapabilities();
        expect(result).toEqual([]);
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });
  });

  describe('modelSupportsImages', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      (globalThis as any).fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    });

    afterEach(() => {
      (globalThis as any).fetch = originalFetch;
    });

    it('returns true for Claude models', async () => {
      expect(await modelSupportsImages('anthropic/claude-3.5-sonnet')).toBe(true);
      expect(await modelSupportsImages('anthropic/claude-3-opus')).toBe(true);
      expect(await modelSupportsImages('anthropic/claude-4-sonnet')).toBe(true);
    });

    it('returns true for GPT-4o models', async () => {
      expect(await modelSupportsImages('openai/gpt-4o')).toBe(true);
      expect(await modelSupportsImages('openai/gpt-4o-mini')).toBe(true);
      expect(await modelSupportsImages('openai/chatgpt-4o-latest')).toBe(true);
    });

    it('returns true for Gemini models', async () => {
      expect(await modelSupportsImages('google/gemini-2.0-flash')).toBe(true);
      expect(await modelSupportsImages('google/gemini-1.5-pro')).toBe(true);
      expect(await modelSupportsImages('google/gemini-2.5-pro')).toBe(true);
    });

    it('returns true for Pixtral models', async () => {
      expect(await modelSupportsImages('mistralai/pixtral-12b')).toBe(true);
    });

    it('returns true for Qwen VL models', async () => {
      expect(await modelSupportsImages('qwen/qwen2.5-vl-72b')).toBe(true);
    });

    it('returns false for text-only models', async () => {
      expect(await modelSupportsImages('openai/gpt-4')).toBe(false);
      expect(await modelSupportsImages('anthropic/claude-2')).toBe(false);
      expect(await modelSupportsImages('meta-llama/llama-3-70b')).toBe(false);
    });

    it('uses dynamic detection when model is in OpenRouter API', async () => {
      const mockModels = {
        data: [
          {
            id: 'custom/vision-model',
            name: 'Custom Vision',
            architecture: {
              input_modalities: ['image', 'text'],
              output_modalities: ['text'],
            },
          },
        ],
      };

      const originalFetch = globalThis.fetch;
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockModels),
      });
      (globalThis as any).fetch = fetchMock;

      try {
        expect(await modelSupportsImages('custom/vision-model')).toBe(true);
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });

    it('refreshes the cache when the requested model is missing from cached capabilities', async () => {
      const originalFetch = globalThis.fetch;
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            data: [
              {
                id: 'openai/gpt-4',
                architecture: {
                  input_modalities: ['text'],
                },
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            data: [
              {
                id: 'openai/gpt-4',
                architecture: {
                  input_modalities: ['text'],
                },
              },
              {
                id: 'meta-llama/llama-4-maverick',
                architecture: {
                  input_modalities: ['text', 'image'],
                },
              },
            ],
          }),
        });

      (globalThis as any).fetch = fetchMock;

      try {
        await fetchOpenRouterModelCapabilities();

        await expect(modelSupportsImages('meta-llama/llama-4-maverick')).resolves.toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });
  });

  describe('getVisionModelIds', () => {
    it('returns list of vision model IDs from API', async () => {
      const mockModels = {
        data: [
          {
            id: 'anthropic/claude-3.5-sonnet',
            architecture: { input_modalities: ['image', 'text'] },
          },
          {
            id: 'openai/gpt-4',
            architecture: { input_modalities: ['text'] },
          },
        ],
      };

      const originalFetch = globalThis.fetch;
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockModels),
      });
      (globalThis as any).fetch = fetchMock;

      try {
        const result = await getVisionModelIds();
        expect(result).toContain('anthropic/claude-3.5-sonnet');
        expect(result).not.toContain('openai/gpt-4');
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });

    it('returns empty array on API failure', async () => {
      const originalFetch = globalThis.fetch;
      const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'));
      (globalThis as any).fetch = fetchMock;

      try {
        const result = await getVisionModelIds();
        expect(result).toEqual([]);
      } finally {
        (globalThis as any).fetch = originalFetch;
      }
    });
  });
});

describe('supportsVision (ImageManager)', () => {
  it('returns true for Claude 3+ models', () => {
    expect(supportsVision('anthropic/claude-3-opus')).toBe(true);
    expect(supportsVision('anthropic/claude-3.5-sonnet')).toBe(true);
    expect(supportsVision('anthropic/claude-3.7-sonnet')).toBe(true);
    expect(supportsVision('anthropic/claude-4-sonnet')).toBe(true);
    expect(supportsVision('anthropic/claude-opus-4')).toBe(true);
  });

  it('returns true for GPT-4o and variants', () => {
    expect(supportsVision('openai/gpt-4o')).toBe(true);
    expect(supportsVision('openai/gpt-4o-mini')).toBe(true);
    expect(supportsVision('openai/gpt-4-turbo')).toBe(true);
    expect(supportsVision('openai/gpt-4.5-preview')).toBe(true);
    expect(supportsVision('openai/chatgpt-4o-latest')).toBe(true);
  });

  it('returns true for Gemini 1.5+ and 2.x', () => {
    expect(supportsVision('google/gemini-1.5-pro')).toBe(true);
    expect(supportsVision('google/gemini-1.5-flash')).toBe(true);
    expect(supportsVision('google/gemini-2.0-flash')).toBe(true);
    expect(supportsVision('google/gemini-2.5-pro')).toBe(true);
    expect(supportsVision('google/gemini-pro-vision')).toBe(true);
  });

  it('returns true for Pixtral models', () => {
    expect(supportsVision('mistralai/pixtral-12b')).toBe(true);
  });

  it('returns true for Qwen VL models', () => {
    expect(supportsVision('qwen/qwen2.5-vl-72b')).toBe(true);
    expect(supportsVision('qwen/qwen-vl-max')).toBe(true);
  });

  it('returns true for MiniCPM-V models', () => {
    expect(supportsVision('openbmb/minicpm-v-2.6')).toBe(true);
  });

  it('returns true for DeepSeek VL models', () => {
    expect(supportsVision('deepseek/deepseek-vl2')).toBe(true);
  });

  it('returns true for models with vision/vl/multimodal in name', () => {
    expect(supportsVision('some/vision-model')).toBe(true);
    expect(supportsVision('some/model-vl')).toBe(true);
    expect(supportsVision('some/vl-model')).toBe(true);
    expect(supportsVision('some/multimodal-model')).toBe(true);
  });

  it('returns false for text-only models', () => {
    expect(supportsVision('openai/gpt-4')).toBe(false);
    expect(supportsVision('openai/gpt-3.5-turbo')).toBe(false);
    expect(supportsVision('anthropic/claude-2')).toBe(false);
    expect(supportsVision('anthropic/claude-instant')).toBe(false);
    expect(supportsVision('meta-llama/llama-3-70b')).toBe(false);
    expect(supportsVision('mistralai/mistral-large')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(supportsVision('ANTHROPIC/CLAUDE-3.5-SONNET')).toBe(true);
    expect(supportsVision('OpenAI/GPT-4O')).toBe(true);
    expect(supportsVision('Google/GEMINI-2.0-FLASH')).toBe(true);
  });
});

describe('isImagePath', () => {
  it('returns true for image file paths', () => {
    expect(isImagePath('screenshot.png')).toBe(true);
    expect(isImagePath('photo.jpg')).toBe(true);
    expect(isImagePath('photo.jpeg')).toBe(true);
    expect(isImagePath('animation.gif')).toBe(true);
    expect(isImagePath('image.webp')).toBe(true);
    expect(isImagePath('path/to/screenshot.PNG')).toBe(true);
    expect(isImagePath('./assets/logo.JPG')).toBe(true);
  });

  it('returns false for non-image files', () => {
    expect(isImagePath('document.txt')).toBe(false);
    expect(isImagePath('script.ts')).toBe(false);
    expect(isImagePath('data.json')).toBe(false);
    expect(isImagePath('README.md')).toBe(false);
    expect(isImagePath('image.bmp')).toBe(false);
  });
});

describe('getMimeTypeFromExtension', () => {
  it('returns correct MIME type for supported extensions', () => {
    expect(getMimeTypeFromExtension('.png')).toBe('image/png');
    expect(getMimeTypeFromExtension('png')).toBe('image/png');
    expect(getMimeTypeFromExtension('.jpg')).toBe('image/jpeg');
    expect(getMimeTypeFromExtension('.jpeg')).toBe('image/jpeg');
    expect(getMimeTypeFromExtension('.gif')).toBe('image/gif');
    expect(getMimeTypeFromExtension('.webp')).toBe('image/webp');
  });

  it('returns undefined for unsupported extensions', () => {
    expect(getMimeTypeFromExtension('.bmp')).toBeUndefined();
    expect(getMimeTypeFromExtension('.tiff')).toBeUndefined();
    expect(getMimeTypeFromExtension('.svg')).toBeUndefined();
    expect(getMimeTypeFromExtension('.txt')).toBeUndefined();
  });

  it('is case insensitive', () => {
    expect(getMimeTypeFromExtension('.PNG')).toBe('image/png');
    expect(getMimeTypeFromExtension('.JPG')).toBe('image/jpeg');
    expect(getMimeTypeFromExtension('.WebP')).toBe('image/webp');
  });
});
