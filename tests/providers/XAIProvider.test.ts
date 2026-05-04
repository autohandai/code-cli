/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { XAIProvider } from '../../src/providers/XAIProvider.js';
import { ApiError } from '../../src/providers/errors.js';

describe('XAIProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('surfaces xAI-specific authentication errors', async () => {
    const provider = new XAIProvider({
      apiKey: 'invalid-key',
      model: 'grok-4.20-reasoning',
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    try {
      await provider.complete({
        messages: [{ role: 'user', content: 'hi' }],
      });
      throw new Error('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('auth_failed');
      expect((error as Error).message).toContain('xAI API key');
      expect((error as Error).message).not.toContain('LLM Gateway');
    }
  });
});
