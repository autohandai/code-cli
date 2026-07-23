/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

async function importCatalog() {
  vi.resetModules();
  return import("../../src/providers/modelCatalog.js");
}

describe("modelCatalog", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("loads bundled provider models from src/providers/models.json", async () => {
    const {
      getBundledModelCatalogPath,
      getProviderDefaultModel,
      getProviderModelIds,
    } = await importCatalog();

    expect(getBundledModelCatalogPath()).toMatch(/src\/providers\/models\.json$/);
    expect(getProviderDefaultModel("nvidia")).toBe("z-ai/glm-5.1");
    expect(getProviderModelIds("nvidia")).toContain("microsoft/phi-4-mini-instruct");
    expect(getProviderModelIds("openai")).toEqual(expect.arrayContaining([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.4",
    ]));
    expect(getProviderDefaultModel("xai")).toBe("grok-4.5");
    expect(getProviderModelIds("xai")).toEqual(expect.arrayContaining([
      "grok-4.5",
      "grok-4.5-latest",
      "grok-4.3",
      "grok-4.20-reasoning",
    ]));
  });

  it("keeps runtime defaults separate from user-facing defaults when needed", async () => {
    const { getProviderDefaultModel, getProviderRuntimeDefaultModel } = await importCatalog();

    expect(getProviderDefaultModel("mlx")).toBe("mlx-community/Llama-3.2-3B-Instruct-4bit");
    expect(getProviderRuntimeDefaultModel("mlx")).toBe("mlx-model");
  });

  it("keeps bundled catalog entries for every built-in provider", async () => {
    const { getProviderDefaultModel, getProviderModelIds } = await importCatalog();
    const providers = [
      "openrouter",
      "ollama",
      "llamacpp",
      "openai",
      "mlx",
      "llmgateway",
      "azure",
      "zai",
      "sakana",
      "vertexai",
      "xai",
      "cerebras",
      "nvidia",
      "deepseek",
      "bedrock",
    ] as const;

    for (const provider of providers) {
      expect(getProviderDefaultModel(provider), provider).not.toBe("");
      expect(getProviderModelIds(provider).length, provider).toBeGreaterThan(0);
    }
  });

  it("merges AUTOHAND_MODELS_CATALOG overrides ahead of bundled models", async () => {
    const dir = mkdtempSync(join(tmpdir(), "autohand-models-"));
    const overridePath = join(dir, "models.json");
    writeFileSync(
      overridePath,
      JSON.stringify({
        providers: {
          nvidia: {
            defaultModel: "nvidia/new-catalog-model",
            models: [
              { id: "nvidia/new-catalog-model", displayName: "New Catalog Model" },
              "microsoft/phi-4-mini-instruct",
            ],
          },
        },
      }),
    );

    process.env.AUTOHAND_MODELS_CATALOG = overridePath;

    try {
      const {
        getProviderDefaultModel,
        getProviderModelIds,
        getProviderModelOptions,
      } = await importCatalog();

      expect(getProviderDefaultModel("nvidia")).toBe("nvidia/new-catalog-model");
      expect(getProviderModelIds("nvidia")[0]).toBe("nvidia/new-catalog-model");
      expect(getProviderModelIds("nvidia")).toContain("z-ai/glm-5.1");
      expect(getProviderModelOptions("nvidia")[0]).toEqual({
        id: "nvidia/new-catalog-model",
        displayName: "New Catalog Model",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses ~/.autohand/models.json as the default override path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "autohand-home-"));
    process.env.AUTOHAND_HOME = dir;

    try {
      const { getUserModelCatalogPath } = await importCatalog();

      expect(getUserModelCatalogPath()).toBe(join(dir, "models.json"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("overlays a cached Pi-compatible catalog without replacing the user override", async () => {
    const dir = mkdtempSync(join(tmpdir(), "autohand-remote-models-"));
    process.env.AUTOHAND_HOME = dir;
    const remotePath = join(dir, "model-catalog", "models.json");
    mkdirSync(join(dir, "model-catalog"), { recursive: true });
    writeFileSync(remotePath, JSON.stringify({
      nvidia: {
        "nvidia/remote-model": {
          id: "nvidia/remote-model",
          name: "Remote Model",
          api: "openai-completions",
          provider: "nvidia",
          baseUrl: "https://integrate.api.nvidia.com/v1",
          reasoning: true,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 262144,
          maxTokens: 32768,
        },
      },
    }));
    writeFileSync(join(dir, "models.json"), JSON.stringify({
      providers: {
        nvidia: {
          defaultModel: "nvidia/local-model",
          models: ["nvidia/local-model"],
        },
      },
    }));

    try {
      const {
        getProviderDefaultModel,
        getProviderModelOptions,
        getRemoteModelCatalogPath,
      } = await importCatalog();

      expect(getRemoteModelCatalogPath()).toBe(remotePath);
      expect(getProviderDefaultModel("nvidia")).toBe("nvidia/local-model");
      expect(getProviderModelOptions("nvidia")).toEqual(expect.arrayContaining([
        { id: "nvidia/local-model" },
        {
          id: "nvidia/remote-model",
          displayName: "Remote Model",
          contextWindow: 262144,
          reasoningEffort: "high",
        },
      ]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
