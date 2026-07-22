/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  getModelCatalogMetadataPath,
  getRemoteModelCatalogPath,
} from "./modelCatalogPaths.js";

export { getModelCatalogMetadataPath, getRemoteModelCatalogPath } from "./modelCatalogPaths.js";

export const DEFAULT_MODEL_CATALOG_URL = "https://code.autohand.ai/cli/models.json";
export const MODEL_CATALOG_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1_000;
export const MODEL_CATALOG_RETRY_INTERVAL_MS = 15 * 60 * 1_000;

const MODEL_CATALOG_SCHEMA_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_CATALOG_BYTES = 5 * 1024 * 1024;
const SAFE_PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const BUILT_IN_PROVIDERS = new Set([
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
]);

interface ModelCatalogMetadata {
  schemaVersion: 1;
  url: string;
  checkedAt?: number;
  lastAttemptAt: number;
  etag?: string;
  revision?: string;
  providerCount?: number;
  modelCount?: number;
}

export type ModelCatalogRefreshStatus =
  | "updated"
  | "not-modified"
  | "fresh"
  | "backoff"
  | "offline";

export interface ModelCatalogRefreshResult {
  status: ModelCatalogRefreshStatus;
  path: string;
  checkedAt?: number;
  providerCount?: number;
  modelCount?: number;
  revision?: string;
}

export interface RefreshModelCatalogOptions {
  catalogUrl?: string;
  fetchImpl?: typeof fetch;
  force?: boolean;
  offline?: boolean;
  now?: () => number;
  signal?: AbortSignal;
  timeoutMs?: number;
  userAgent?: string;
}

interface CatalogCounts {
  providerCount: number;
  modelCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validateCost(value: unknown): boolean {
  return isRecord(value)
    && isFiniteNonNegative(value.input)
    && isFiniteNonNegative(value.output)
    && isFiniteNonNegative(value.cacheRead)
    && isFiniteNonNegative(value.cacheWrite);
}

function validateModel(providerId: string, modelId: string, value: unknown): boolean {
  return isRecord(value)
    && value.id === modelId
    && value.provider === providerId
    && typeof value.name === "string"
    && value.name.trim().length > 0
    && typeof value.api === "string"
    && value.api.trim().length > 0
    && typeof value.baseUrl === "string"
    && value.baseUrl.trim().length > 0
    && typeof value.reasoning === "boolean"
    && Array.isArray(value.input)
    && value.input.length > 0
    && value.input.every((input) => input === "text" || input === "image")
    && validateCost(value.cost)
    && isFinitePositive(value.contextWindow)
    && isFinitePositive(value.maxTokens);
}

export function validatePiModelCatalog(value: unknown): CatalogCounts {
  if (!isRecord(value)) {
    throw new Error("Invalid model catalog: expected a provider object");
  }

  let providerCount = 0;
  let modelCount = 0;
  let knownProviderCount = 0;

  for (const [providerId, providerValue] of Object.entries(value)) {
    if (UNSAFE_KEYS.has(providerId) || !SAFE_PROVIDER_ID.test(providerId) || !isRecord(providerValue)) {
      throw new Error(`Invalid model catalog provider: ${providerId}`);
    }
    const models = Object.entries(providerValue);
    if (models.length === 0) {
      throw new Error(`Invalid model catalog: provider ${providerId} has no models`);
    }
    providerCount += 1;
    if (BUILT_IN_PROVIDERS.has(providerId)) {
      knownProviderCount += 1;
    }

    for (const [modelId, model] of models) {
      if (UNSAFE_KEYS.has(modelId) || !validateModel(providerId, modelId, model)) {
        throw new Error(`Invalid model catalog entry: ${providerId}/${modelId}`);
      }
      modelCount += 1;
    }
  }

  if (providerCount === 0 || modelCount === 0 || knownProviderCount === 0) {
    throw new Error("Invalid model catalog: no supported providers or models");
  }

  return { providerCount, modelCount };
}

function truthyEnvironmentFlag(value: string | undefined): boolean {
  return value !== undefined && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function catalogUrl(options: RefreshModelCatalogOptions): string {
  return options.catalogUrl ?? process.env.AUTOHAND_MODELS_URL ?? DEFAULT_MODEL_CATALOG_URL;
}

async function readMetadata(): Promise<ModelCatalogMetadata | undefined> {
  try {
    const parsed = JSON.parse(await readFile(getModelCatalogMetadataPath(), "utf8")) as unknown;
    if (!isRecord(parsed) || parsed.schemaVersion !== MODEL_CATALOG_SCHEMA_VERSION) {
      return undefined;
    }
    if (typeof parsed.url !== "string" || !isFiniteNonNegative(parsed.lastAttemptAt)) {
      return undefined;
    }
    return parsed as unknown as ModelCatalogMetadata;
  } catch {
    return undefined;
  }
}

async function hasCachedCatalog(): Promise<boolean> {
  try {
    await access(getRemoteModelCatalogPath());
    return true;
  } catch {
    return false;
  }
}

async function writeAtomically(path: string, content: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function toResult(status: ModelCatalogRefreshStatus, metadata?: ModelCatalogMetadata): ModelCatalogRefreshResult {
  return {
    status,
    path: getRemoteModelCatalogPath(),
    checkedAt: metadata?.checkedAt,
    providerCount: metadata?.providerCount,
    modelCount: metadata?.modelCount,
    revision: metadata?.revision,
  };
}

function requestSignal(options: RefreshModelCatalogOptions): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (options.signal?.aborted) {
    abortFromCaller();
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

async function recordAttempt(metadata: ModelCatalogMetadata | undefined, url: string, now: number): Promise<void> {
  const prior = metadata?.url === url ? metadata : undefined;
  await writeAtomically(getModelCatalogMetadataPath(), `${JSON.stringify({
    ...prior,
    schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
    url,
    lastAttemptAt: now,
  }, null, 2)}\n`);
}

export async function refreshModelCatalog(
  options: RefreshModelCatalogOptions = {},
): Promise<ModelCatalogRefreshResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = (options.now ?? Date.now)();
  const url = catalogUrl(options);
  const offline = options.offline ?? truthyEnvironmentFlag(process.env.AUTOHAND_OFFLINE);
  const metadata = await readMetadata();
  const cacheAvailable = await hasCachedCatalog();

  if (offline) {
    return toResult("offline", metadata);
  }
  if (!options.force && cacheAvailable && metadata?.url === url && metadata.checkedAt !== undefined
    && now - metadata.checkedAt < MODEL_CATALOG_REFRESH_INTERVAL_MS) {
    return toResult("fresh", metadata);
  }
  if (!options.force && metadata?.url === url
    && (cacheAvailable || metadata.checkedAt === undefined)
    && now - metadata.lastAttemptAt < MODEL_CATALOG_RETRY_INTERVAL_MS) {
    return toResult("backoff", metadata);
  }

  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": options.userAgent ?? "autohand/model-catalog",
  };
  if (cacheAvailable && metadata?.url === url && metadata.etag) {
    headers["if-none-match"] = metadata.etag;
  }

  const { signal, cleanup } = requestSignal(options);
  try {
    const response = await fetchImpl(url, { headers, signal });
    if (response.status === 304) {
      if (!cacheAvailable || !metadata?.checkedAt) {
        throw new Error("Model catalog returned 304 without a local cache");
      }
      const nextMetadata: ModelCatalogMetadata = {
        ...metadata,
        checkedAt: now,
        lastAttemptAt: now,
      };
      await writeAtomically(getModelCatalogMetadataPath(), `${JSON.stringify(nextMetadata, null, 2)}\n`);
      return toResult("not-modified", nextMetadata);
    }
    if (!response.ok) {
      throw new Error(`Model catalog request failed with HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (contentType && !contentType.includes("application/json")) {
      throw new Error(`Model catalog returned unsupported content type: ${contentType}`);
    }
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_CATALOG_BYTES) {
      throw new Error(`Model catalog exceeds ${MAX_CATALOG_BYTES} bytes`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_CATALOG_BYTES) {
      throw new Error(`Model catalog exceeds ${MAX_CATALOG_BYTES} bytes`);
    }
    const text = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(text) as unknown;
    const counts = validatePiModelCatalog(parsed);
    const revision = response.headers.get("x-autohand-model-revision")
      ?? `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
    const nextMetadata: ModelCatalogMetadata = {
      schemaVersion: MODEL_CATALOG_SCHEMA_VERSION,
      url,
      checkedAt: now,
      lastAttemptAt: now,
      etag: response.headers.get("etag") ?? undefined,
      revision,
      ...counts,
    };

    await writeAtomically(getRemoteModelCatalogPath(), `${JSON.stringify(parsed)}\n`);
    await writeAtomically(getModelCatalogMetadataPath(), `${JSON.stringify(nextMetadata, null, 2)}\n`);
    return toResult("updated", nextMetadata);
  } catch (error) {
    await recordAttempt(metadata, url, now);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Model catalog refresh timed out or was cancelled", { cause: error });
    }
    if (error instanceof SyntaxError) {
      throw new Error("Invalid model catalog JSON", { cause: error });
    }
    throw error;
  } finally {
    cleanup();
  }
}

export async function refreshModelCatalogOnStartup(
  options: Omit<RefreshModelCatalogOptions, "force"> = {},
): Promise<ModelCatalogRefreshResult | undefined> {
  try {
    return await refreshModelCatalog({ ...options, force: false });
  } catch {
    return undefined;
  }
}
