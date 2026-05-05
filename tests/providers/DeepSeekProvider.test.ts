/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_MODELS,
  DeepSeekProvider,
} from "../../src/providers/DeepSeekProvider.js";

describe("DeepSeekProvider", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("exposes current DeepSeek API model choices with the V4 models first", async () => {
    const provider = new DeepSeekProvider({
      apiKey: "test-deepseek-key",
      model: "deepseek-v4-flash",
    });

    await expect(provider.listModels()).resolves.toEqual([...DEEPSEEK_MODELS]);
    expect(DEEPSEEK_MODELS[0]).toBe("deepseek-v4-flash");
    expect(DEEPSEEK_MODELS[1]).toBe("deepseek-v4-pro");
  });

  it("uses the OpenAI-compatible DeepSeek chat completions endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "deepseek-response",
          created: 123,
          choices: [
            {
              message: { content: "hello" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 3,
            completion_tokens: 2,
            total_tokens: 5,
          },
        }),
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const provider = new DeepSeekProvider({
      apiKey: "test-deepseek-key",
      model: "deepseek-v4-flash",
    });

    const response = await provider.complete({
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 32,
    });

    expect(response.content).toBe("hello");
    expect(fetchMock).toHaveBeenCalledWith(
      `${DEEPSEEK_DEFAULT_BASE_URL}/chat/completions`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-deepseek-key",
          "Content-Type": "application/json",
        }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      model: string;
      max_tokens: number;
    };
    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.max_tokens).toBe(32);
  });
});
