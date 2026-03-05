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
});
