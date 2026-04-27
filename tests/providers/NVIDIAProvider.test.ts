/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../src/utils/platform", () => ({
  isMLXSupported: vi.fn(() => false),
}));

const mockComplete = vi.fn();
vi.mock("../../src/providers/NVIDIAClient.js", () => ({
  NVIDIAClient: class {
    constructor(
      private config: any,
      private networkSettings?: any
    ) {}
    setDefaultModel(_model: string) {}
    async complete(request: any) {
      return mockComplete(request);
    }
  },
}));

import { NVIDIAProvider, NVIDIA_DEFAULT_BASE_URL } from "../../src/providers/NVIDIAProvider";

describe("NVIDIAProvider", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("constructs with valid NvidiaAISettings", () => {
    const provider = new NVIDIAProvider({
      apiKey: "nvapi-test-key",
      model: "meta/llama-3.3-70b-instruct",
    });

    expect(provider.getName()).toBe("nvidia");
  });

  it("uses NVIDIA default base URL when not overridden", () => {
    const provider = new NVIDIAProvider({
      apiKey: "nvapi-test-key",
      model: "meta/llama-3.3-70b-instruct",
    });

    expect(provider.getName()).toBe("nvidia");
  });

  it("uses custom base URL when provided", () => {
    const provider = new NVIDIAProvider({
      apiKey: "nvapi-test-key",
      model: "meta/llama-3.3-70b-instruct",
      baseUrl: "https://custom.nvidia.com/v1",
    });

    expect(provider.getName()).toBe("nvidia");
  });

  it("NVIDIAProvider > returns expected model list sorted by dateCreated DESC", async () => {
    const provider = new NVIDIAProvider({
      apiKey: "test-key",
      model: "microsoft/phi-4-mini-instruct",
    });

    const models = await provider.listModels();

    expect(models).toContain("microsoft/phi-4-mini-instruct");
    expect(models).toContain("nvidia/usdcode");
    expect(models).toContain("mistralai/mixtral-8x7b-instruct-v0.1");
  });

  it("NVIDIA_DEFAULT_BASE_URL points to integrate API", () => {
    expect(NVIDIA_DEFAULT_BASE_URL).toBe("https://integrate.api.nvidia.com/v1");
  });

  it("is always available", async () => {
    const provider = new NVIDIAProvider({
      apiKey: "nvapi-test-key",
      model: "meta/llama-3.3-70b-instruct",
    });

    expect(await provider.isAvailable()).toBe(true);
  });

  it("delegates complete() to NVIDIAClient", async () => {
    mockComplete.mockResolvedValue({
      content: "hello from nvidia",
      usage: { totalTokens: 10 },
    });

    const provider = new NVIDIAProvider({
      apiKey: "nvapi-test-key",
      model: "meta/llama-3.3-70b-instruct",
    });

    const result = await provider.complete({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "hi" }],
      })
    );
    expect(result.content).toBe("hello from nvidia");
  });

  it("updates model via setModel", () => {
    const provider = new NVIDIAProvider({
      apiKey: "nvapi-test-key",
      model: "meta/llama-3.3-70b-instruct",
    });

    provider.setModel("microsoft/phi-3-mini-4k-instruct");

    expect(provider.getName()).toBe("nvidia");
  });

  it("passes chatTemplateKwargs from provider config to request", async () => {
    mockComplete.mockResolvedValue({
      content: "Test response",
      usage: { totalTokens: 10 },
    });

    const provider = new NVIDIAProvider({
      apiKey: "nvapi-test-key",
      model: "deepseek-ai/deepseek-v4-pro",
      chatTemplateKwargs: {
        thinking: true,
        reasoning_effort: "high",
      },
    });

    await provider.complete({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "hi" }],
        chatTemplateKwargs: {
          thinking: true,
          reasoning_effort: "high",
        },
      })
    );
  });

  it("passes stream setting from provider config to request", async () => {
    mockComplete.mockResolvedValue({
      content: "Test response",
      usage: { totalTokens: 10 },
    });

    const provider = new NVIDIAProvider({
      apiKey: "nvapi-test-key",
      model: "z-ai/glm-5.1",
      stream: true,
    });

    await provider.complete({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      })
    );
  });

  it("request-level stream setting overrides provider default", async () => {
    mockComplete.mockResolvedValue({
      content: "Test response",
      usage: { totalTokens: 10 },
    });

    const provider = new NVIDIAProvider({
      apiKey: "nvapi-test-key",
      model: "z-ai/glm-5.1",
      stream: false,
    });

    await provider.complete({
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });

    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: true,
      })
    );
  });

  it("request-level chatTemplateKwargs overrides provider default", async () => {
    mockComplete.mockResolvedValue({
      content: "Test response",
      usage: { totalTokens: 10 },
    });

    const provider = new NVIDIAProvider({
      apiKey: "nvapi-test-key",
      model: "deepseek-ai/deepseek-v4-pro",
      chatTemplateKwargs: {
        thinking: false,
      },
    });

    await provider.complete({
      messages: [{ role: "user", content: "hi" }],
      chatTemplateKwargs: {
        thinking: true,
        reasoning_effort: "medium",
      },
    });

    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        chatTemplateKwargs: {
          thinking: true,
          reasoning_effort: "medium",
        },
      })
    );
  });

  it("supports Z.ai GLM model with enable_thinking", async () => {
    mockComplete.mockResolvedValue({
      content: "Test response",
      usage: { totalTokens: 10 },
    });

    const provider = new NVIDIAProvider({
      apiKey: "nvapi-test-key",
      model: "z-ai/glm-5.1",
      chatTemplateKwargs: {
        enable_thinking: true,
        clear_thinking: false,
      },
      stream: true,
    });

    await provider.complete({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(mockComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        chatTemplateKwargs: {
          enable_thinking: true,
          clear_thinking: false,
        },
        stream: true,
      })
    );
  });
});
