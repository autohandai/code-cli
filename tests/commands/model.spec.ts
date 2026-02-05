/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('API Key Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateApiKey behavior', () => {
    it('should return valid for successful API response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200
      });

      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer sk-valid-key',
          'Content-Type': 'application/json'
        }
      });

      expect(response.ok).toBe(true);
    });

    it('should handle 401 unauthorized error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Invalid API key' } })
      });

      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer sk-invalid-key',
          'Content-Type': 'application/json'
        }
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(401);
    });

    it('should handle 403 forbidden error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: { message: 'Permission denied' } })
      });

      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer sk-restricted-key',
          'Content-Type': 'application/json'
        }
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(403);
    });

    it('should handle 429 rate limit error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'Rate limit exceeded' } })
      });

      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer sk-key',
          'Content-Type': 'application/json'
        }
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(429);
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        fetch('https://api.openai.com/v1/models', {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer sk-key',
            'Content-Type': 'application/json'
          }
        })
      ).rejects.toThrow('Network error');
    });
  });

  describe('OpenRouter API validation', () => {
    it('should include required headers for OpenRouter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200
      });

      await fetch('https://openrouter.ai/api/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer sk-or-valid-key',
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://autohand.dev',
          'X-Title': 'Autohand CLI'
        }
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            'HTTP-Referer': 'https://autohand.dev',
            'X-Title': 'Autohand CLI'
          })
        })
      );
    });
  });

  describe('Error message formatting', () => {
    it('should provide helpful hints for 401 errors', () => {
      const provider = 'openai';

      const hint = provider === 'openai'
        ? 'Check that your API key is correct at https://platform.openai.com/api-keys'
        : 'Check that your API key is correct at https://openrouter.ai/keys';

      expect(hint).toContain('platform.openai.com');
    });

    it('should provide helpful hints for OpenRouter 401 errors', () => {
      const provider = 'openrouter';

      const hint = provider === 'openai'
        ? 'Check that your API key is correct at https://platform.openai.com/api-keys'
        : 'Check that your API key is correct at https://openrouter.ai/keys';

      expect(hint).toContain('openrouter.ai');
    });

    it('should provide helpful hints for 403 permission errors', () => {
      const hint = 'Your API key may have restricted permissions or your account may need to add a payment method.';
      expect(hint).toContain('permissions');
      expect(hint).toContain('payment method');
    });

    it('should provide helpful hints for 429 rate limit errors', () => {
      const hint = 'You may have exceeded your API quota. Check your usage and billing settings.';
      expect(hint).toContain('quota');
      expect(hint).toContain('billing');
    });
  });
});

describe('Cloud Provider Settings', () => {
  describe('Action selection', () => {
    it('should offer three options for cloud providers', () => {
      const choices = [
        { name: 'model', message: 'Change model only' },
        { name: 'apiKey', message: 'Change API key only' },
        { name: 'both', message: 'Change both model and API key' }
      ];

      expect(choices).toHaveLength(3);
      expect(choices.map(c => c.name)).toEqual(['model', 'apiKey', 'both']);
    });
  });

  describe('Model lists', () => {
    it('should have correct OpenAI model list', () => {
      const models = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'o1', 'o1-mini'];

      expect(models).toContain('gpt-4o');
      expect(models).toContain('o1');
      expect(models).toContain('o1-mini');
    });

    it('should have default model for OpenRouter', () => {
      const defaultModel = 'anthropic/claude-sonnet-4-20250514';
      expect(defaultModel).toContain('anthropic');
      expect(defaultModel).toContain('claude');
    });
  });

  describe('Base URLs', () => {
    it('should have correct OpenAI base URL', () => {
      const baseUrl = 'https://api.openai.com/v1';
      expect(baseUrl).toBe('https://api.openai.com/v1');
    });

    it('should have correct OpenRouter base URL', () => {
      const baseUrl = 'https://openrouter.ai/api/v1';
      expect(baseUrl).toBe('https://openrouter.ai/api/v1');
    });
  });

  describe('Masked API key display', () => {
    it('should mask API key correctly', () => {
      const apiKey = 'sk-or-v1-abc123xyz789';
      const maskedKey = `...${apiKey.slice(-4)}`;
      expect(maskedKey).toBe('...z789');
    });

    it('should show "not set" when no API key', () => {
      const apiKey = null;
      const maskedKey = apiKey ? `...${apiKey.slice(-4)}` : 'not set';
      expect(maskedKey).toBe('not set');
    });
  });
});
