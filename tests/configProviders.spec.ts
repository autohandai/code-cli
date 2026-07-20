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
    expect(result).not.toBeNull();
    expect(result!.baseUrl).toBe('https://example.com');
    expect(result!.model).toBe('foo');
    expect(result!.apiKey).toBe('test');
  });

  it('returns default base url for ollama when missing', () => {
    const cfg: AutohandConfig = {
      provider: 'ollama',
      ollama: { model: 'llama2' }
    };

    const result = getProviderConfig(cfg);
    expect(result).not.toBeNull();
    expect(result!.baseUrl).toMatch(/^http:\/\/localhost:/);
    expect(result!.model).toBe('llama2');
  });

  it('returns null when provider config is missing', () => {
    const cfg: AutohandConfig = {
      provider: 'ollama',
      openrouter: { apiKey: 'x', model: 'y' }
    };

    const result = getProviderConfig(cfg);
    expect(result).toBeNull();
  });

  it('returns llmgateway settings when configured', () => {
    const cfg: AutohandConfig = {
      provider: 'llmgateway',
      llmgateway: { apiKey: 'lg-test-key', model: 'gpt-4o', baseUrl: 'https://api.llmgateway.io/v1' }
    };

    const result = getProviderConfig(cfg);
    expect(result).not.toBeNull();
    expect(result!.baseUrl).toBe('https://api.llmgateway.io/v1');
    expect(result!.model).toBe('gpt-4o');
    expect(result!.apiKey).toBe('lg-test-key');
  });

  it('returns default base url for llmgateway when missing', () => {
    const cfg: AutohandConfig = {
      provider: 'llmgateway',
      llmgateway: { apiKey: 'lg-test-key', model: 'gpt-4o' }
    };

    const result = getProviderConfig(cfg);
    expect(result).not.toBeNull();
    expect(result!.baseUrl).toBe('https://api.llmgateway.io/v1');
    expect(result!.model).toBe('gpt-4o');
  });

  it('returns null when llmgateway config has no api key', () => {
    const cfg: AutohandConfig = {
      provider: 'llmgateway',
      llmgateway: { apiKey: '', model: 'gpt-4o' }
    };

    const result = getProviderConfig(cfg);
    expect(result).toBeNull();
  });

  it('returns openai chatgpt settings when configured with oauth tokens', () => {
    const cfg: AutohandConfig = {
      provider: 'openai',
      openai: {
        authMode: 'chatgpt',
        model: 'gpt-5.4',
        chatgptAuth: {
          accessToken: 'chatgpt-access-token',
          refreshToken: 'chatgpt-refresh-token',
          accountId: 'account-123'
        }
      }
    };

    const result = getProviderConfig(cfg);
    expect(result).not.toBeNull();
    expect(result!.baseUrl).toBe('https://api.openai.com/v1');
    expect(result!.model).toBe('gpt-5.4');
    expect((result as AutohandConfig['openai'])?.authMode).toBe('chatgpt');
    expect((result as AutohandConfig['openai'])?.chatgptAuth?.accountId).toBe('account-123');
  });

  it('returns null when openai chatgpt settings are missing account id', () => {
    const cfg: AutohandConfig = {
      provider: 'openai',
      openai: {
        authMode: 'chatgpt',
        model: 'gpt-5.4',
        chatgptAuth: {
          accessToken: 'chatgpt-access-token'
        }
      }
    };

    const result = getProviderConfig(cfg);
    expect(result).toBeNull();
  });

  it('returns nvidia settings when configured', () => {
    const cfg: AutohandConfig = {
      provider: 'nvidia',
      nvidia: { apiKey: 'nvapi-test-key', model: 'meta/llama-3.3-70b-instruct', baseUrl: 'https://integrate.api.nvidia.com/v1' }
    };

    const result = getProviderConfig(cfg);
    expect(result).not.toBeNull();
    expect(result!.baseUrl).toBe('https://integrate.api.nvidia.com/v1');
    expect(result!.model).toBe('meta/llama-3.3-70b-instruct');
    expect(result!.apiKey).toBe('nvapi-test-key');
  });

  it('returns default base url for nvidia when missing', () => {
    const cfg: AutohandConfig = {
      provider: 'nvidia',
      nvidia: { apiKey: 'nvapi-test-key', model: 'meta/llama-3.3-70b-instruct' }
    };

    const result = getProviderConfig(cfg);
    expect(result).not.toBeNull();
    expect(result!.baseUrl).toBe('https://integrate.api.nvidia.com/v1');
  });

  it('returns null when nvidia config has no api key', () => {
    const cfg: AutohandConfig = {
      provider: 'nvidia',
      nvidia: { apiKey: '', model: 'meta/llama-3.3-70b-instruct' }
    };

    const result = getProviderConfig(cfg);
    expect(result).toBeNull();
  });

  it('returns default base url for sakana when missing', () => {
    const cfg: AutohandConfig = {
      provider: 'sakana',
      sakana: { apiKey: 'sakana-test-key', model: 'fugu' }
    };

    const result = getProviderConfig(cfg);
    expect(result).not.toBeNull();
    expect(result!.baseUrl).toBe('https://api.sakana.ai/v1');
    expect(result!.model).toBe('fugu');
    expect(result!.apiKey).toBe('sakana-test-key');
  });

  it('returns null when sakana config has no api key', () => {
    const cfg: AutohandConfig = {
      provider: 'sakana',
      sakana: { apiKey: '', model: 'fugu' }
    };

    const result = getProviderConfig(cfg);
    expect(result).toBeNull();
  });

  it('returns custom OpenAI-compatible provider settings when configured', () => {
    const cfg: AutohandConfig = {
      provider: 'custom:acme',
      customProviders: {
        acme: {
          id: 'acme',
          displayName: 'Acme AI',
          apiFormat: 'openai-compatible',
          baseUrl: 'https://api.acme.example/v1',
          apiKey: 'acme-test-key',
          apiKeyRequired: true,
          model: 'acme-code-1',
          contextWindow: 256000,
          reasoningEffort: 'high'
        }
      }
    };

    const result = getProviderConfig(cfg);
    expect(result).toEqual(expect.objectContaining({
      baseUrl: 'https://api.acme.example/v1',
      model: 'acme-code-1',
      apiKey: 'acme-test-key',
      contextWindow: 256000,
      reasoningEffort: 'high'
    }));
  });

  it('allows custom OpenAI-compatible providers with optional API keys', () => {
    const cfg: AutohandConfig = {
      provider: 'custom:local-openai',
      customProviders: {
        'local-openai': {
          id: 'local-openai',
          displayName: 'Local OpenAI Proxy',
          apiFormat: 'openai-compatible',
          baseUrl: 'http://localhost:8080/v1',
          apiKeyRequired: false,
          model: 'local-code-model'
        }
      }
    };

    const result = getProviderConfig(cfg);
    expect(result).toEqual(expect.objectContaining({
      baseUrl: 'http://localhost:8080/v1',
      model: 'local-code-model'
    }));
  });

  it('returns null for custom providers that require an API key but do not have one', () => {
    const cfg: AutohandConfig = {
      provider: 'custom:acme',
      customProviders: {
        acme: {
          id: 'acme',
          displayName: 'Acme AI',
          apiFormat: 'openai-compatible',
          baseUrl: 'https://api.acme.example/v1',
          apiKeyRequired: true,
          model: 'acme-code-1'
        }
      }
    };

    const result = getProviderConfig(cfg);
    expect(result).toBeNull();
  });

  it('returns runtime extension provider settings without discarding provider-owned fields', () => {
    const cfg: AutohandConfig = {
      provider: 'extension:company-release',
      extensionProviders: {
        'extension:company-release': {
          model: 'release-model',
          endpointId: 'release-cluster',
        },
      },
    };

    expect(getProviderConfig(cfg)).toEqual({
      model: 'release-model',
      endpointId: 'release-cluster',
    });
  });
});
