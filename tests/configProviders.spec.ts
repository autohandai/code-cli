/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { getProviderConfig } from '../src/config.js';
import type { AutohandConfig } from '../src/types.js';

describe('getProviderConfig', () => {
  it('returns openrouter settings when configured', () => {
    const cfg: AutohandConfig = {
      provider: 'openrouter',
      openrouter: { apiKey: 'test', model: 'foo', baseUrl: 'https://example.com' }
    };

    const result = getProviderConfig(cfg);
    expect(result.baseUrl).toBe('https://example.com');
    expect(result.model).toBe('foo');
    expect(result.apiKey).toBe('test');
  });

  it('returns default base url for ollama when missing', () => {
    const cfg: AutohandConfig = {
      provider: 'ollama',
      ollama: { model: 'llama2' }
    };

    const result = getProviderConfig(cfg);
    expect(result.baseUrl).toMatch(/^http:\/\/localhost:/);
    expect(result.model).toBe('llama2');
  });

  it('throws when provider config is missing', () => {
    const cfg: AutohandConfig = {
      provider: 'ollama',
      openrouter: { apiKey: 'x', model: 'y' }
    };

    expect(() => getProviderConfig(cfg)).toThrow(/not configured/i);
  });
});
