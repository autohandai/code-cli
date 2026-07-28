/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTOHAND_AI_CLOUD_MODELS,
  AUTOHAND_AI_DEFAULT_BASE_URL,
  AUTOHAND_AI_DEFAULT_CONTEXT_WINDOW,
  AUTOHAND_AI_MOA_CONTEXT_WINDOW,
  AutohandAIProvider,
} from "../../src/providers/AutohandAIProvider.js";

describe("AutohandAIProvider", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("exposes Fantail and Moa cloud models with the provider context contract", async () => {
    const provider = new AutohandAIProvider({
      plan: "cloud",
      authMode: "api-key",
      apiKey: "test-autohand-key",
      model: "fantail",
    });

    await expect(provider.listModels()).resolves.toEqual([...AUTOHAND_AI_CLOUD_MODELS]);
    expect(AUTOHAND_AI_CLOUD_MODELS).toEqual(["fantail", "moa"]);
    expect(AUTOHAND_AI_DEFAULT_CONTEXT_WINDOW).toBe(16_000);
    expect(AUTOHAND_AI_MOA_CONTEXT_WINDOW).toBe(1_000_000);
  });

  it("uses the Autohand AI cloud chat completions endpoint with API key auth and temperature 0.1", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "autohand-response",
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

    const provider = new AutohandAIProvider({
      plan: "cloud",
      authMode: "api-key",
      apiKey: "test-autohand-key",
      model: "fantail",
    });

    const response = await provider.complete({
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 32,
    });

    expect(response.content).toBe("hello");
    expect(fetchMock).toHaveBeenCalledWith(
      `${AUTOHAND_AI_DEFAULT_BASE_URL}/chat/completions`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-autohand-key",
          "Content-Type": "application/json",
          "x-source": "Autohand Code CLI",
        }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      model: string;
      temperature: number;
      max_tokens: number;
    };
    expect(body.model).toBe("fantail");
    expect(body.temperature).toBe(0.1);
    expect(body.max_tokens).toBe(32);
  });

  it("uses the logged-in account token for cloud account auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "autohand-response",
          created: 123,
          choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
        }),
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const provider = new AutohandAIProvider({
      plan: "cloud",
      authMode: "account",
      accountToken: "account-session-token",
      model: "moa",
    });

    await provider.complete({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer account-session-token",
        }),
      }),
    );
  });

  it("sends Moa thinking effort through the OpenAI-compatible request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "autohand-response",
          created: 123,
          choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
        }),
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const provider = new AutohandAIProvider({
      plan: "cloud",
      authMode: "api-key",
      apiKey: "test-autohand-key",
      model: "moa",
      reasoningEffort: "xhigh",
    });

    await provider.complete({
      messages: [{ role: "user", content: "think" }],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      extra_body?: { chat_template_kwargs?: { reasoning_effort?: string } };
    };
    expect(body.extra_body?.chat_template_kwargs?.reasoning_effort).toBe("xhigh");
  });

  it("requires an API key when SDK mode uses cloud API-key auth", async () => {
    const provider = new AutohandAIProvider({
      plan: "cloud",
      authMode: "api-key",
      apiKey: "",
      model: "fantail",
    });

    await expect(
      provider.complete({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toThrow(/Autohand AI API key is required/);
  });
});
