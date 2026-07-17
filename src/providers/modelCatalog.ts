/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuiltInProviderName, ReasoningEffort } from "../types.js";
import {
  getRemoteModelCatalogPath,
  getUserModelCatalogPath,
} from "./modelCatalogPaths.js";

export { getRemoteModelCatalogPath, getUserModelCatalogPath } from "./modelCatalogPaths.js";

export interface ModelCatalogEntry {
  id: string;
  displayName?: string;
  contextWindow?: number;
  reasoningEffort?: ReasoningEffort;
}

interface ProviderModelCatalog {
  defaultModel?: string;
  runtimeDefaultModel?: string;
  models: ModelCatalogEntry[];
}

interface ModelCatalog {
  providers: Partial<Record<BuiltInProviderName, ProviderModelCatalog>>;
}

const PROVIDERS: readonly BuiltInProviderName[] = [
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
];

const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBuiltInProviderName(value: string): value is BuiltInProviderName {
  return PROVIDERS.includes(value as BuiltInProviderName);
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort | undefined {
  return typeof value === "string" && REASONING_EFFORTS.includes(value as ReasoningEffort)
    ? (value as ReasoningEffort)
    : undefined;
}

function normalizeModelEntry(value: unknown): ModelCatalogEntry | undefined {
  if (typeof value === "string") {
    const id = value.trim();
    return id ? { id } : undefined;
  }

  if (!isRecord(value) || typeof value.id !== "string") {
    return undefined;
  }

  const id = value.id.trim();
  if (!id) {
    return undefined;
  }

  const entry: ModelCatalogEntry = { id };
  if (typeof value.displayName === "string" && value.displayName.trim()) {
    entry.displayName = value.displayName.trim();
  }
  if (typeof value.contextWindow === "number" && Number.isFinite(value.contextWindow)) {
    entry.contextWindow = value.contextWindow;
  }
  const reasoningEffort = normalizeReasoningEffort(value.reasoningEffort);
  if (reasoningEffort) {
    entry.reasoningEffort = reasoningEffort;
  }
  return entry;
}

function normalizeProviderCatalog(value: unknown): ProviderModelCatalog | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const models = Array.isArray(value.models)
    ? value.models
        .map(normalizeModelEntry)
        .filter((entry): entry is ModelCatalogEntry => Boolean(entry))
    : [];

  const catalog: ProviderModelCatalog = { models };
  if (typeof value.defaultModel === "string" && value.defaultModel.trim()) {
    catalog.defaultModel = value.defaultModel.trim();
  }
  if (typeof value.runtimeDefaultModel === "string" && value.runtimeDefaultModel.trim()) {
    catalog.runtimeDefaultModel = value.runtimeDefaultModel.trim();
  }
  return catalog;
}

function normalizePiProviderCatalog(value: unknown): ProviderModelCatalog | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const models = Object.values(value)
    .map((entry) => {
      const normalized = normalizeModelEntry(entry);
      if (!normalized || !isRecord(entry)) {
        return normalized;
      }
      if (!normalized.displayName && typeof entry.name === "string" && entry.name.trim()) {
        normalized.displayName = entry.name.trim();
      }
      if (!normalized.reasoningEffort && entry.reasoning === true) {
        normalized.reasoningEffort = "high";
      }
      return normalized;
    })
    .filter((entry): entry is ModelCatalogEntry => Boolean(entry));

  return models.length > 0 ? { models } : undefined;
}

function normalizeCatalog(value: unknown): ModelCatalog {
  const catalog: ModelCatalog = { providers: {} };
  if (!isRecord(value)) {
    return catalog;
  }

  const providers = isRecord(value.providers) ? value.providers : value;

  for (const [provider, providerValue] of Object.entries(providers)) {
    if (!isBuiltInProviderName(provider)) {
      continue;
    }

    const normalized = isRecord(providerValue) && Array.isArray(providerValue.models)
      ? normalizeProviderCatalog(providerValue)
      : normalizePiProviderCatalog(providerValue);
    if (normalized) {
      catalog.providers[provider] = normalized;
    }
  }

  return catalog;
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map((candidate) => resolve(candidate)))];
}

function getBundledCatalogCandidates(): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return uniquePaths([
    join(moduleDir, "models.json"),
    join(moduleDir, "providers", "models.json"),
    join(moduleDir, "..", "providers", "models.json"),
    join(moduleDir, "..", "src", "providers", "models.json"),
    join(process.cwd(), "src", "providers", "models.json"),
    join(process.cwd(), "dist", "providers", "models.json"),
  ]);
}

export function getBundledModelCatalogPath(): string {
  return getBundledCatalogCandidates().find((candidate) => existsSync(candidate))
    ?? getBundledCatalogCandidates()[0];
}

function readCatalogFile(filePath: string): ModelCatalog {
  if (!existsSync(filePath)) {
    return { providers: {} };
  }

  try {
    return normalizeCatalog(JSON.parse(readFileSync(filePath, "utf8")) as unknown);
  } catch {
    return { providers: {} };
  }
}

export function mergeModelOptions(
  primary: readonly ModelCatalogEntry[],
  fallback: readonly ModelCatalogEntry[],
): ModelCatalogEntry[] {
  const seen = new Set<string>();
  const merged: ModelCatalogEntry[] = [];

  for (const entry of [...primary, ...fallback]) {
    if (seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    merged.push({ ...entry });
  }

  return merged;
}

export function mergeModelIds(primary: readonly string[], fallback: readonly string[]): string[] {
  const normalizedPrimary = primary.map((id) => ({ id }));
  const normalizedFallback = fallback.map((id) => ({ id }));
  return mergeModelOptions(normalizedPrimary, normalizedFallback).map((entry) => entry.id);
}

function mergeCatalogs(base: ModelCatalog, override: ModelCatalog): ModelCatalog {
  const merged: ModelCatalog = { providers: {} };

  for (const provider of PROVIDERS) {
    const baseProvider = base.providers[provider];
    const overrideProvider = override.providers[provider];
    if (!baseProvider && !overrideProvider) {
      continue;
    }

    merged.providers[provider] = {
      defaultModel: overrideProvider?.defaultModel ?? baseProvider?.defaultModel,
      runtimeDefaultModel: overrideProvider?.runtimeDefaultModel ?? baseProvider?.runtimeDefaultModel,
      models: mergeModelOptions(overrideProvider?.models ?? [], baseProvider?.models ?? []),
    };
  }

  return merged;
}

export function loadModelCatalog(): ModelCatalog {
  const bundled = readCatalogFile(getBundledModelCatalogPath());
  const remote = readCatalogFile(getRemoteModelCatalogPath());
  const override = readCatalogFile(getUserModelCatalogPath());
  return mergeCatalogs(mergeCatalogs(bundled, remote), override);
}

export function getProviderModelOptions(provider: BuiltInProviderName): ModelCatalogEntry[] {
  return loadModelCatalog().providers[provider]?.models.map((entry) => ({ ...entry })) ?? [];
}

export function getProviderModelIds(provider: BuiltInProviderName): string[] {
  return getProviderModelOptions(provider).map((entry) => entry.id);
}

export function getProviderDefaultModel(
  provider: BuiltInProviderName,
  fallback?: string,
): string {
  const catalog = loadModelCatalog().providers[provider];
  return catalog?.defaultModel ?? catalog?.models[0]?.id ?? fallback ?? "";
}

export function getProviderRuntimeDefaultModel(
  provider: BuiltInProviderName,
  fallback?: string,
): string {
  const catalog = loadModelCatalog().providers[provider];
  return catalog?.runtimeDefaultModel
    ?? catalog?.defaultModel
    ?? catalog?.models[0]?.id
    ?? fallback
    ?? "";
}

export function getAllCatalogModelOptions(): ModelCatalogEntry[] {
  return mergeModelOptions(
    PROVIDERS.flatMap((provider) => getProviderModelOptions(provider)),
    [],
  );
}
