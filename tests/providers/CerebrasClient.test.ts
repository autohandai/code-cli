/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CerebrasClient } from '../../src/providers/CerebrasClient.js';
import type { CerebrasSettings } from '../../src/types.js';

const settings: CerebrasSettings = { apiKey: 'csk-test-key', model: 'llama-3.3-70b' };

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

describe('CerebrasClient', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('complete', () => {
    it('keeps an explicit stop finish reason from a stream', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: sseBody([
          'data: {"id":"stream-test","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
          'data: {"id":"stream-test","choices":[{"delta":{"content":"!"},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      });

      const response = await new CerebrasClient(settings).complete({
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      });

      expect(response.content).toBe('Hello!');
      expect(response.finishReason).toBe('stop');
    });

    it('treats a stream that ends without a finish reason as truncated', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: sseBody([
          'data: {"id":"stream-test","choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n',
          'data: [DONE]\n\n',
        ]),
      });

      const response = await new CerebrasClient(settings).complete({
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      });

      expect(response.content).toBe('partial');
      expect(response.finishReason).toBe('length');
    });

    it('maps a vendor max_tokens finish reason to length and keeps tool_calls', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({
          id: 'cerebras-1', created: 1, choices: [{ message: { content: 'partial' }, finish_reason: 'max_tokens' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          id: 'cerebras-2', created: 2, choices: [{ message: { content: '', tool_calls: [
            { id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{}' } },
          ] }, finish_reason: 'tool_calls' }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      global.fetch = fetchMock;
      const client = new CerebrasClient(settings);

      const truncated = await client.complete({ messages: [{ role: 'user', content: 'Hello' }] });
      const toolCall = await client.complete({ messages: [{ role: 'user', content: 'Hello' }] });

      expect(truncated.finishReason).toBe('length');
      expect(toolCall.finishReason).toBe('tool_calls');
    });
  });
});
