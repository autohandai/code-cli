/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import type { AutohandConfig } from "../../src/types";

vi.mock("../../src/utils/platform", () => ({
  isMLXSupported: vi.fn(() => false),
}));

import { ProviderFactory } from "../../src/providers/ProviderFactory";

describe("ProviderFactory", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getProviderNames()", () => {
    it("should always include openrouter, ollama, openai, llamacpp, llmgateway, azure, zai", () => {
      const providers = ProviderFactory.getProviderNames();

      expect(providers).toContain("openrouter");
      expect(providers).toContain("ollama");
      expect(providers).toContain("openai");
      expect(providers).toContain("llamacpp");
      expect(providers).toContain("llmgateway");
      expect(providers).toContain("azure");
      expect(providers).toContain("zai");
    });

    it("should always include azure in provider list", () => {
      const providers = ProviderFactory.getProviderNames();
      expect(providers).toContain("azure");
    });

    it("should include zai in provider list", () => {
      const providers = ProviderFactory.getProviderNames();
      expect(providers).toContain("zai");
    });

    it("should not include mlx on non-Apple Silicon", () => {
      const providers = ProviderFactory.getProviderNames();
      expect(providers).not.toContain("mlx");
      expect(providers).toEqual([
        "openrouter",
        "ollama",
        "openai",
        "llamacpp",
        "llmgateway",
        "azure",
        "zai",
      ]);
    });
  });

  describe("create()", () => {
    it("should create OllamaProvider when ollama is configured", () => {
      const config: AutohandConfig = {
        provider: "ollama",
        ollama: {
          model: "llama3.2:latest",
          baseUrl: "http://localhost:11434",
        },
      };

      const provider = ProviderFactory.create(config);

      expect(provider.getName()).toBe("ollama");
    });

    it("should create OpenAIProvider when openai is configured", () => {
      const config: AutohandConfig = {
        provider: "openai",
        openai: {
          apiKey: "test-key",
          model: "gpt-4",
        },
      };

      const provider = ProviderFactory.create(config);

      expect(provider.getName()).toBe("openai");
    });

    it("should create LlamaCppProvider when llamacpp is configured", () => {
      const config: AutohandConfig = {
        provider: "llamacpp",
        llamacpp: {
          model: "test-model",
          baseUrl: "http://localhost:8080",
        },
      };

      const provider = ProviderFactory.create(config);

      expect(provider.getName()).toBe("llamacpp");
    });

    it("should create AzureProvider when azure is configured", () => {
      const config: AutohandConfig = {
        provider: "azure",
        azure: {
          model: "gpt-4o",
          apiKey: "test-azure-key",
          baseUrl: "https://my-resource.openai.azure.com",
          deploymentName: "gpt-4o",
          apiVersion: "2024-08-01-preview",
        },
      };

      const provider = ProviderFactory.create(config);

      expect(provider.getName()).toBe("azure");
    });

    it("should return UnconfiguredProvider when azure config is missing", () => {
      const config: AutohandConfig = {
        provider: "azure",
      };

      const provider = ProviderFactory.create(config);

      expect(provider.getName()).toBe("unconfigured");
    });

    it("should create ZaiProvider when zai is configured", () => {
      const config: AutohandConfig = {
        provider: "zai",
        zai: {
          apiKey: "test-zai-key",
          model: "glm-4.5",
        },
      };

      const provider = ProviderFactory.create(config);

      expect(provider.getName()).toBe("zai");
    });

    it("should return UnconfiguredProvider when zai config is missing", () => {
      const config: AutohandConfig = {
        provider: "zai",
      };

      const provider = ProviderFactory.create(config);

      expect(provider.getName()).toBe("unconfigured");
    });

    it("should default to openrouter when no provider specified", () => {
      const config: AutohandConfig = {
        openrouter: {
          apiKey: "test-key",
          model: "anthropic/claude-sonnet-4-20250514",
        },
      };

      const provider = ProviderFactory.create(config);

      expect(provider.getName()).toBe("openrouter");
    });
  });

  describe("isValidProvider()", () => {
    it("should return true for openrouter", () => {
      expect(ProviderFactory.isValidProvider("openrouter")).toBe(true);
    });

    it("should return true for ollama", () => {
      expect(ProviderFactory.isValidProvider("ollama")).toBe(true);
    });

    it("should return true for openai", () => {
      expect(ProviderFactory.isValidProvider("openai")).toBe(true);
    });

    it("should return true for llamacpp", () => {
      expect(ProviderFactory.isValidProvider("llamacpp")).toBe(true);
    });

    it("should return true for llmgateway", () => {
      expect(ProviderFactory.isValidProvider("llmgateway")).toBe(true);
    });

    it("should return true for azure", () => {
      expect(ProviderFactory.isValidProvider("azure")).toBe(true);
    });

    it("should return true for zai", () => {
      expect(ProviderFactory.isValidProvider("zai")).toBe(true);
    });

    it("should return false for invalid provider", () => {
      expect(ProviderFactory.isValidProvider("invalid")).toBe(false);
      expect(ProviderFactory.isValidProvider("gpt4")).toBe(false);
      expect(ProviderFactory.isValidProvider("")).toBe(false);
    });
  });
});
