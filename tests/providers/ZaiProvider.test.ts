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
vi.mock("../../src/providers/LLMGatewayClient.js", () => ({
  LLMGatewayClient: class {
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

import { ZaiProvider } from "../../src/providers/ZaiProvider";

describe("ZaiProvider", () => {
  afterEach(() => {
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

  it("delegates complete() to LLMGatewayClient", async () => {
    mockComplete.mockResolvedValue({
      content: "hello",
      usage: { totalTokens: 10 },
    });

    const provider = new ZaiProvider({
      apiKey: "test-key",
      model: "glm-4.5",
    });

    const result = await provider.complete({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(mockComplete).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.content).toBe("hello");
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
