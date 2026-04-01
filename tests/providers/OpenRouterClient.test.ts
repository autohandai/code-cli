/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterClient } from '../../src/providers/OpenRouterClient.js';
import { clearModelCapabilitiesCache } from '../../src/providers/modelCapabilities.js';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('OpenRouterClient', () => {
  beforeEach(() => {
    clearModelCapabilitiesCache();
  });

  afterEach(() => {
    clearModelCapabilitiesCache();
    vi.restoreAllMocks();
  });

  it('sends multipart content when the selected model supports image input', async () => {
    const client = new OpenRouterClient({
      apiKey: 'test-key',
      model: 'google/gemini-2.5-flash',
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        data: [
          {
            id: 'google/gemini-2.5-flash',
            architecture: {
              input_modalities: ['text', 'image'],
            },
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: 'resp_1',
        created: 123,
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'done',
            },
            finish_reason: 'stop',
          },
        ],
      }));

    await client.complete({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this screenshot.' },
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/png;base64,ZmFrZS1pbWFnZQ==',
              },
            },
          ] as unknown as string,
        },
      ],
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const chatRequest = fetchSpy.mock.calls[1];
    expect(chatRequest[0]).toBe('https://openrouter.ai/api/v1/chat/completions');

    const body = JSON.parse(chatRequest[1]?.body as string);
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this screenshot.' },
          {
            type: 'image_url',
            image_url: {
              url: 'data:image/png;base64,ZmFrZS1pbWFnZQ==',
            },
          },
        ],
      },
    ]);
  });

  it('falls back to text-only content when the selected model does not support image input', async () => {
    const client = new OpenRouterClient({
      apiKey: 'test-key',
      model: 'openai/gpt-4',
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        data: [
          {
            id: 'openai/gpt-4',
            architecture: {
              input_modalities: ['text'],
            },
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: 'resp_2',
        created: 123,
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'done',
            },
            finish_reason: 'stop',
          },
        ],
      }));

    await client.complete({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '[Image #1] screenshot.png\n\nWhat is broken here?' },
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/png;base64,ZmFrZS1pbWFnZQ==',
              },
            },
          ] as unknown as string,
        },
      ],
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const chatRequest = fetchSpy.mock.calls[1];
    const body = JSON.parse(chatRequest[1]?.body as string);

    expect(body.messages).toEqual([
      {
        role: 'user',
        content: '[Image #1] screenshot.png\n\nWhat is broken here?',
      },
    ]);
  });
});
