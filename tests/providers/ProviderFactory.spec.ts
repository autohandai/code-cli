/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from "vitest";
import { ProviderFactory } from "../../src/providers/ProviderFactory.js";
import type { AutohandConfig } from "../../src/types.js";

describe("ProviderFactory", () => {
  describe("create", () => {
    it("should create LLMGatewayProvider when llmgateway is configured", () => {
      const config: AutohandConfig = {
        provider: "llmgateway",
        llmgateway: {
          apiKey: "test-key",
          model: "gpt-4o",
        },
      };

      const provider = ProviderFactory.create(config);
      expect(provider.getName()).toBe("llmgateway");
    });

    it("should return UnconfiguredProvider when llmgateway config is missing", () => {
      const config: AutohandConfig = {
        provider: "llmgateway",
      };

      const provider = ProviderFactory.create(config);
      expect(provider.getName()).toBe("unconfigured");
    });

    it("should create OpenRouterProvider by default", () => {
      const config: AutohandConfig = {
        openrouter: {
          apiKey: "test-key",
          model: "your-modelcard-id-here",
        },
      };

      const provider = ProviderFactory.create(config);
      expect(provider.getName()).toBe("openrouter");
    });

    it("should create a custom OpenAI-compatible provider when configured", () => {
      const config: AutohandConfig = {
        provider: "custom:acme",
        customProviders: {
          acme: {
            id: "acme",
            displayName: "Acme AI",
            apiFormat: "openai-compatible",
            baseUrl: "https://api.acme.example/v1",
            apiKey: "acme-test-key",
            apiKeyRequired: true,
            model: "acme-code-1",
          },
        },
      };

      const provider = ProviderFactory.create(config);
      expect(provider.getName()).toBe("custom:acme");
    });

    it("should return UnconfiguredProvider when a custom provider is missing", () => {
      const config: AutohandConfig = {
        provider: "custom:missing",
      };

      const provider = ProviderFactory.create(config);
      expect(provider.getName()).toBe("unconfigured");
    });
  });

  describe("getProviderNames", () => {
    it("should include llmgateway in the list", () => {
      const providers = ProviderFactory.getProviderNames();
      expect(providers).toContain("llmgateway");
    });

    it("should include openrouter in the list", () => {
      const providers = ProviderFactory.getProviderNames();
      expect(providers).toContain("openrouter");
    });

    it("should include configured custom providers in the list", () => {
      const providers = ProviderFactory.getProviderNames({
        customProviders: {
          acme: {
            id: "acme",
            displayName: "Acme AI",
            apiFormat: "openai-compatible",
            baseUrl: "https://api.acme.example/v1",
            apiKeyRequired: true,
            model: "acme-code-1",
          },
        },
      });

      expect(providers).toContain("custom:acme");
    });
  });

  describe("isValidProvider", () => {
    it("should return true for llmgateway", () => {
      expect(ProviderFactory.isValidProvider("llmgateway")).toBe(true);
    });

    it("should return true for openrouter", () => {
      expect(ProviderFactory.isValidProvider("openrouter")).toBe(true);
    });

    it("should return false for invalid provider", () => {
      expect(ProviderFactory.isValidProvider("invalid-provider")).toBe(false);
    });

    it("should return true for nvidia", () => {
      expect(ProviderFactory.isValidProvider("nvidia")).toBe(true);
    });

    it("should return true for sakana", () => {
      expect(ProviderFactory.isValidProvider("sakana")).toBe(true);
    });

    it("should return true for configured custom providers", () => {
      expect(ProviderFactory.isValidProvider("custom:acme", {
        customProviders: {
          acme: {
            id: "acme",
            displayName: "Acme AI",
            apiFormat: "openai-compatible",
            baseUrl: "https://api.acme.example/v1",
            apiKeyRequired: true,
            model: "acme-code-1",
          },
        },
      })).toBe(true);
    });
  });

  describe("sakana provider", () => {
    it("should create SakanaProvider when sakana is configured", () => {
      const config: AutohandConfig = {
        provider: "sakana",
        sakana: {
          apiKey: "sakana-test-key",
          model: "fugu",
        },
      };

      const provider = ProviderFactory.create(config);
      expect(provider.getName()).toBe("sakana");
    });

    it("should return UnconfiguredProvider when sakana config is missing", () => {
      const config: AutohandConfig = {
        provider: "sakana",
      };

      const provider = ProviderFactory.create(config);
      expect(provider.getName()).toBe("unconfigured");
    });

    it("should include sakana in the list", () => {
      const providers = ProviderFactory.getProviderNames();
      expect(providers).toContain("sakana");
    });
  });

  describe("nvidia provider", () => {
    it("should create NVIDIAProvider when nvidia is configured", () => {
      const config: AutohandConfig = {
        provider: "nvidia",
        nvidia: {
          apiKey: "nvapi-test-key",
          model: "meta/llama-3.3-70b-instruct",
        },
      };

      const provider = ProviderFactory.create(config);
      expect(provider.getName()).toBe("nvidia");
    });

    it("should return UnconfiguredProvider when nvidia config is missing", () => {
      const config: AutohandConfig = {
        provider: "nvidia",
      };

      const provider = ProviderFactory.create(config);
      expect(provider.getName()).toBe("unconfigured");
    });

    it("should include nvidia in the list", () => {
      const providers = ProviderFactory.getProviderNames();
      expect(providers).toContain("nvidia");
    });
  });
});
