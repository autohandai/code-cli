/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { AzureProvider } from '../../src/providers/AzureProvider';
import type { AzureSettings } from '../../src/types';

describe('AzureProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const defaultSettings: AzureSettings = {
    model: 'gpt-4o',
    resourceName: 'test-resource',
    deploymentName: 'test-deploy',
    apiKey: 'test-key',
    authMethod: 'api-key'
  };

  it('should return "azure" as provider name', () => {
    const provider = new AzureProvider(defaultSettings);
    expect(provider.getName()).toBe('azure');
  });

  it('should update model via setModel', () => {
    const provider = new AzureProvider(defaultSettings);
    provider.setModel('gpt-4o-mini');
    expect(provider.getName()).toBe('azure');
  });

  it('should list Azure-compatible models', async () => {
    const provider = new AzureProvider(defaultSettings);
    const models = await provider.listModels();
    expect(models).toContain('gpt-4o');
    expect(models).toContain('gpt-4o-mini');
    expect(models.length).toBeGreaterThan(0);
  });

  it('should return true for isAvailable when configured', async () => {
    const provider = new AzureProvider(defaultSettings);
    const available = await provider.isAvailable();
    expect(available).toBe(true);
  });

  it('should delegate complete to AzureClient', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'resp-1', created: 123,
        choices: [{ message: { content: 'Azure response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 }
      })
    } as Response);

    const provider = new AzureProvider(defaultSettings);
    const response = await provider.complete({
      messages: [{ role: 'user', content: 'hello' }]
    });

    expect(response.content).toBe('Azure response');
    expect(response.finishReason).toBe('stop');
  });

  it('keeps managed identity and stored credentials intact after a pre-request auth failure, then permits explicit retry', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('IMDS connection failed'))
      .mockResolvedValueOnce(Response.json({ access_token: 'fixture-managed-token', expires_in: 3600 }))
      .mockResolvedValueOnce(Response.json({
        id: 'azure-retry', choices: [{ message: { content: 'Explicit retry succeeded' }, finish_reason: 'stop' }],
      }));
    const settings: AzureSettings = { ...defaultSettings, authMethod: 'managed-identity', apiKey: 'preserve-configured-key' };
    const provider = new AzureProvider(settings, { maxRetries: 3, retryDelay: 1 });
    await expect(provider.complete({ messages: [{ role: 'user', content: 'Hello' }] }))
      .rejects.toMatchObject({ code: 'auth_failed', retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(settings.authMethod).toBe('managed-identity');
    expect(settings.apiKey).toBe('preserve-configured-key');
    await expect(provider.complete({ messages: [{ role: 'user', content: 'Try again' }] }))
      .resolves.toMatchObject({ content: 'Explicit retry succeeded' });
    expect(fetch).toHaveBeenCalledTimes(3);
    const headers = new Headers(fetch.mock.calls[2]?.[1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer fixture-managed-token');
    expect(headers.has('api-key')).toBe(false);
  });
});
