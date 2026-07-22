/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };
const CATALOG_URL = "https://code.autohand.ai/cli/models.json";

function piCatalog(modelId = "nvidia/new-model") {
  return {
    nvidia: {
      [modelId]: {
        id: modelId,
        name: "New Model",
        api: "openai-completions",
        provider: "nvidia",
        baseUrl: "https://integrate.api.nvidia.com/v1",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 131072,
        maxTokens: 32768,
      },
    },
  };
}

async function importUpdater() {
  vi.resetModules();
  return import("../../src/providers/modelCatalogUpdater.js");
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("model catalog updater", () => {
  it("downloads, validates, and atomically persists a Pi-compatible catalog", async () => {
    const home = await mkdtemp(join(tmpdir(), "autohand-model-refresh-"));
    process.env.AUTOHAND_HOME = home;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(piCatalog()), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        etag: '"revision-one"',
        "x-autohand-model-revision": "sha256-revision-one",
      },
    }));

    try {
      const {
        getModelCatalogMetadataPath,
        getRemoteModelCatalogPath,
        refreshModelCatalog,
      } = await importUpdater();
      const result = await refreshModelCatalog({
        catalogUrl: CATALOG_URL,
        fetchImpl,
        force: true,
        now: () => 1_000,
      });

      expect(result).toMatchObject({
        status: "updated",
        checkedAt: 1_000,
        providerCount: 1,
        modelCount: 1,
        revision: "sha256-revision-one",
      });
      expect(JSON.parse(await readFile(getRemoteModelCatalogPath(), "utf8"))).toEqual(piCatalog());
      expect(JSON.parse(await readFile(getModelCatalogMetadataPath(), "utf8"))).toMatchObject({
        schemaVersion: 1,
        url: CATALOG_URL,
        checkedAt: 1_000,
        lastAttemptAt: 1_000,
        etag: '"revision-one"',
        revision: "sha256-revision-one",
        providerCount: 1,
        modelCount: 1,
      });
      expect(fetchImpl).toHaveBeenCalledWith(CATALOG_URL, expect.objectContaining({
        headers: expect.objectContaining({ accept: "application/json" }),
        signal: expect.any(AbortSignal),
      }));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("uses the four-hour TTL without making a network request", async () => {
    const home = await mkdtemp(join(tmpdir(), "autohand-model-fresh-"));
    process.env.AUTOHAND_HOME = home;
    const catalogDir = join(home, "model-catalog");
    await mkdir(catalogDir, { recursive: true });
    await writeFile(join(catalogDir, "models.json"), JSON.stringify(piCatalog()));
    await writeFile(join(catalogDir, "metadata.json"), JSON.stringify({
      schemaVersion: 1,
      url: CATALOG_URL,
      checkedAt: 10_000,
      lastAttemptAt: 10_000,
      etag: '"current"',
      providerCount: 1,
      modelCount: 1,
    }));
    const fetchImpl = vi.fn();

    try {
      const { refreshModelCatalog } = await importUpdater();
      const result = await refreshModelCatalog({
        catalogUrl: CATALOG_URL,
        fetchImpl,
        now: () => 10_000 + (4 * 60 * 60 * 1_000) - 1,
      });

      expect(result.status).toBe("fresh");
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("performs a conditional check and preserves the cache on 304", async () => {
    const home = await mkdtemp(join(tmpdir(), "autohand-model-not-modified-"));
    process.env.AUTOHAND_HOME = home;
    const catalogDir = join(home, "model-catalog");
    await mkdir(catalogDir, { recursive: true });
    await writeFile(join(catalogDir, "models.json"), JSON.stringify(piCatalog()));
    await writeFile(join(catalogDir, "metadata.json"), JSON.stringify({
      schemaVersion: 1,
      url: CATALOG_URL,
      checkedAt: 1_000,
      lastAttemptAt: 1_000,
      etag: '"current"',
      providerCount: 1,
      modelCount: 1,
    }));
    const fetchImpl = vi.fn(async () => new Response(null, { status: 304 }));

    try {
      const { getModelCatalogMetadataPath, refreshModelCatalog } = await importUpdater();
      const result = await refreshModelCatalog({
        catalogUrl: CATALOG_URL,
        fetchImpl,
        now: () => 20_000_000,
      });

      expect(result.status).toBe("not-modified");
      expect(fetchImpl).toHaveBeenCalledWith(CATALOG_URL, expect.objectContaining({
        headers: expect.objectContaining({ "if-none-match": '"current"' }),
      }));
      expect(JSON.parse(await readFile(getModelCatalogMetadataPath(), "utf8"))).toMatchObject({
        checkedAt: 20_000_000,
        lastAttemptAt: 20_000_000,
        etag: '"current"',
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("does not make a request in offline mode", async () => {
    const home = await mkdtemp(join(tmpdir(), "autohand-model-offline-"));
    process.env.AUTOHAND_HOME = home;
    const fetchImpl = vi.fn();

    try {
      const { refreshModelCatalog } = await importUpdater();
      const result = await refreshModelCatalog({
        catalogUrl: CATALOG_URL,
        fetchImpl,
        force: true,
        offline: true,
      });

      expect(result.status).toBe("offline");
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("keeps the last valid cache when a refresh is malformed", async () => {
    const home = await mkdtemp(join(tmpdir(), "autohand-model-invalid-"));
    process.env.AUTOHAND_HOME = home;
    const catalogDir = join(home, "model-catalog");
    await mkdir(catalogDir, { recursive: true });
    const existing = JSON.stringify(piCatalog("nvidia/existing"));
    await writeFile(join(catalogDir, "models.json"), existing);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ nvidia: { broken: { name: "Missing ID" } } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    try {
      const { getRemoteModelCatalogPath, refreshModelCatalog } = await importUpdater();

      await expect(refreshModelCatalog({
        catalogUrl: CATALOG_URL,
        fetchImpl,
        force: true,
      })).rejects.toThrow("Invalid model catalog");
      expect(await readFile(getRemoteModelCatalogPath(), "utf8")).toBe(existing);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("does not associate a failed replacement URL with the previous URL freshness", async () => {
    const home = await mkdtemp(join(tmpdir(), "autohand-model-url-change-"));
    process.env.AUTOHAND_HOME = home;
    const catalogDir = join(home, "model-catalog");
    await mkdir(catalogDir, { recursive: true });
    await writeFile(join(catalogDir, "models.json"), JSON.stringify(piCatalog("nvidia/existing")));
    await writeFile(join(catalogDir, "metadata.json"), JSON.stringify({
      schemaVersion: 1,
      url: "https://old.example/models.json",
      checkedAt: 10_000,
      lastAttemptAt: 10_000,
      etag: '"old"',
      providerCount: 1,
      modelCount: 1,
    }));
    const replacementUrl = "https://new.example/models.json";
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }));

    try {
      const { getModelCatalogMetadataPath, refreshModelCatalog } = await importUpdater();

      await expect(refreshModelCatalog({
        catalogUrl: replacementUrl,
        fetchImpl,
        now: () => 20_000,
      })).rejects.toThrow("HTTP 503");
      expect(JSON.parse(await readFile(getModelCatalogMetadataPath(), "utf8"))).toEqual({
        schemaVersion: 1,
        url: replacementUrl,
        lastAttemptAt: 20_000,
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("refreshes when metadata exists but the cached catalog is missing", async () => {
    const home = await mkdtemp(join(tmpdir(), "autohand-model-missing-cache-"));
    process.env.AUTOHAND_HOME = home;
    const catalogDir = join(home, "model-catalog");
    await mkdir(catalogDir, { recursive: true });
    await writeFile(join(catalogDir, "metadata.json"), JSON.stringify({
      schemaVersion: 1,
      url: CATALOG_URL,
      checkedAt: 10_000,
      lastAttemptAt: 10_000,
      etag: '"missing-cache"',
      providerCount: 1,
      modelCount: 1,
    }));
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(piCatalog()), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    try {
      const { refreshModelCatalog } = await importUpdater();
      const result = await refreshModelCatalog({
        catalogUrl: CATALOG_URL,
        fetchImpl,
        now: () => 10_001,
      });

      expect(result.status).toBe("updated");
      expect(fetchImpl).toHaveBeenCalledWith(CATALOG_URL, expect.objectContaining({
        headers: expect.not.objectContaining({ "if-none-match": expect.anything() }),
      }));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
