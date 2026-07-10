/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    expect(getProviderModelIds("openai")).toContain("gpt-5.4");
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
});
