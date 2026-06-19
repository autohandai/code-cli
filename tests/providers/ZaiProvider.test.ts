/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../src/utils/platform", () => ({
  isMLXSupported: vi.fn(() => false),
}));

import { ZaiProvider } from "../../src/providers/ZaiProvider";

describe("ZaiProvider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("constructs with valid ZaiSettings", () => {
    const provider = new ZaiProvider({
      apiKey: "test-zai-key",
      model: "glm-4.5",
    });

    expect(provider.getName()).toBe("zai");
  });

  it("uses Z.AI default base URL when not overridden", () => {
    const provider = new ZaiProvider({
      apiKey: "test-key",
      model: "glm-4.5",
    });

    expect(provider.getName()).toBe("zai");
  });

  it("uses custom base URL when provided", () => {
    const provider = new ZaiProvider({
      apiKey: "test-key",
      model: "glm-4.5",
      baseUrl: "https://custom.z.ai/v1",
    });

    expect(provider.getName()).toBe("zai");
  });

  it("returns expected model list", async () => {
    const provider = new ZaiProvider({
      apiKey: "test-key",
      model: "glm-4.5",
    });

    const models = await provider.listModels();

    expect(models.slice(0, 2)).toEqual(["glm-5.2", "glm-5.1"]);
    expect(models).toContain("glm-5.2");
    expect(models).toContain("glm-5.1");
    expect(models).toContain("glm-4.5");
    expect(models).toContain("glm-4.5v");
    expect(models).toContain("glm-4.5-flash");
    expect(models).toContain("cogview-4.5");
  });

  it("is always available", async () => {
    const provider = new ZaiProvider({
      apiKey: "test-key",
      model: "glm-4.5",
    });

    expect(await provider.isAvailable()).toBe(true);
  });

  it("delegates complete() through the Z.ai-compatible endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        id: "zai-response",
        created: Date.now(),
        choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
        usage: { total_tokens: 10 },
      }),
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new ZaiProvider({
      apiKey: "test-key",
      model: "glm-4.5",
    });

    const result = await provider.complete({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.z.ai/api/paas/v4/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      })
    );
    expect(result.content).toBe("hello");
  });

  it("surfaces Z.ai-specific authentication errors", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: { message: "token expired or incorrect" } }),
    }) as typeof fetch;

    const provider = new ZaiProvider({
      apiKey: "invalid-key",
      model: "glm-4.5",
    }, { maxRetries: 0 });

    try {
      await provider.complete({
        messages: [{ role: "user", content: "hi" }],
      });
      throw new Error("Should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("Z.ai API key");
      expect((error as Error).message).not.toContain("LLM Gateway");
    }
  });

  it("updates model via setModel", () => {
    const provider = new ZaiProvider({
      apiKey: "test-key",
      model: "glm-4.5",
    });

    provider.setModel("glm-4.5-flash");

    expect(provider.getName()).toBe("zai");
  });
});
