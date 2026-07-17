#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

const PROVIDER_DEFAULTS = {
  openrouter: { api: "openai-completions", baseUrl: "https://openrouter.ai/api/v1", contextWindow: 131072 },
  ollama: { api: "openai-completions", baseUrl: "http://127.0.0.1:11434/v1", contextWindow: 131072 },
  llamacpp: { api: "openai-completions", baseUrl: "http://127.0.0.1:8080/v1", contextWindow: 131072 },
  openai: { api: "openai-responses", baseUrl: "https://api.openai.com/v1", contextWindow: 400000 },
  mlx: { api: "openai-completions", baseUrl: "http://127.0.0.1:8080/v1", contextWindow: 131072 },
  llmgateway: { api: "openai-completions", baseUrl: "https://api.llmgateway.io/v1", contextWindow: 131072 },
  azure: { api: "azure-openai-responses", baseUrl: "https://management.azure.com", contextWindow: 400000 },
  zai: { api: "openai-completions", baseUrl: "https://api.z.ai/api/paas/v4", contextWindow: 131072 },
  sakana: { api: "openai-completions", baseUrl: "https://api.sakana.ai/v1", contextWindow: 131072 },
  vertexai: { api: "google-vertex", baseUrl: "https://aiplatform.googleapis.com", contextWindow: 1048576 },
  xai: { api: "openai-completions", baseUrl: "https://api.x.ai/v1", contextWindow: 131072 },
  cerebras: { api: "openai-completions", baseUrl: "https://api.cerebras.ai/v1", contextWindow: 131072 },
  nvidia: { api: "openai-completions", baseUrl: "https://integrate.api.nvidia.com/v1", contextWindow: 131072 },
  deepseek: { api: "openai-completions", baseUrl: "https://api.deepseek.com/v1", contextWindow: 131072 },
  bedrock: { api: "bedrock-converse-stream", baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com", contextWindow: 200000 },
};

const DEFAULT_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,255}$/u;

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new Error(`Invalid argument near ${flag ?? "end of input"}`);
    }
    options[flag.slice(2)] = value;
  }
  if (!options.catalog) throw new Error("--catalog is required");
  if (!options.output) throw new Error("--output is required");
  return options;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modelSource(value) {
  if (typeof value === "string") return { id: value };
  if (isRecord(value) && typeof value.id === "string") return value;
  throw new Error("Each catalog model must be a string or object with an id");
}

function finitePositive(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function validInput(value) {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => entry === "text" || entry === "image")
    ? value
    : ["text"];
}

function validCost(value) {
  if (!isRecord(value)) return { ...DEFAULT_COST };
  const cost = {};
  for (const key of Object.keys(DEFAULT_COST)) {
    const amount = value[key];
    cost[key] = typeof amount === "number" && Number.isFinite(amount) && amount >= 0 ? amount : 0;
  }
  return cost;
}

function buildModel(providerId, value) {
  const source = modelSource(value);
  const id = source.id.trim();
  if (!MODEL_ID_PATTERN.test(id)) {
    throw new Error(`Invalid model id for ${providerId}: ${id}`);
  }
  const defaults = PROVIDER_DEFAULTS[providerId];
  return {
    id,
    name: typeof source.displayName === "string" && source.displayName.trim()
      ? source.displayName.trim()
      : typeof source.name === "string" && source.name.trim()
        ? source.name.trim()
        : id,
    api: typeof source.api === "string" && source.api.trim() ? source.api.trim() : defaults.api,
    provider: providerId,
    baseUrl: typeof source.baseUrl === "string" && source.baseUrl.trim() ? source.baseUrl.trim() : defaults.baseUrl,
    reasoning: typeof source.reasoning === "boolean"
      ? source.reasoning
      : typeof source.reasoningEffort === "string" && source.reasoningEffort !== "none",
    input: validInput(source.input),
    cost: validCost(source.cost),
    contextWindow: finitePositive(source.contextWindow, defaults.contextWindow),
    maxTokens: finitePositive(source.maxTokens, 32768),
  };
}

function generateCatalog(source) {
  if (!isRecord(source) || !isRecord(source.providers)) {
    throw new Error("Catalog must contain a providers object");
  }
  const output = {};
  for (const [providerId, provider] of Object.entries(source.providers)) {
    if (!Object.hasOwn(PROVIDER_DEFAULTS, providerId)) {
      throw new Error(`Unsupported provider: ${providerId}`);
    }
    if (!isRecord(provider) || !Array.isArray(provider.models) || provider.models.length === 0) {
      throw new Error(`Provider ${providerId} must contain at least one model`);
    }
    const models = {};
    for (const sourceModel of provider.models) {
      const model = buildModel(providerId, sourceModel);
      if (Object.hasOwn(models, model.id)) {
        throw new Error(`Duplicate model id for ${providerId}: ${model.id}`);
      }
      models[model.id] = model;
    }
    if (typeof provider.defaultModel !== "string" || !Object.hasOwn(models, provider.defaultModel)) {
      throw new Error(`Provider ${providerId} defaultModel must reference a catalog model`);
    }
    output[providerId] = models;
  }
  if (Object.keys(output).length === 0) {
    throw new Error("Catalog must contain at least one provider");
  }
  return output;
}

const options = parseArgs(process.argv.slice(2));
const source = JSON.parse(readFileSync(options.catalog, "utf8"));
const generated = generateCatalog(source);
writeFileSync(options.output, `${JSON.stringify(generated)}\n`);
console.log(JSON.stringify({
  providerCount: Object.keys(generated).length,
  modelCount: Object.values(generated).reduce((total, models) => total + Object.keys(models).length, 0),
}));
