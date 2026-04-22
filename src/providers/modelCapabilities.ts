/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OpenRouter model capability information
 */
export interface OpenRouterModelCapability {
  id: string;
  canonical_slug?: string;
  name: string;
  description?: string;
  input_modalities?: string[];
  output_modalities?: string[];
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
    tokenizer?: string;
    instruct_type?: string;
  };
  pricing?: Record<string, unknown>;
  context_length?: number;
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
    is_moderated?: boolean;
  };
}

/**
 * Cached model capabilities from OpenRouter
 */
interface ModelCapabilitiesCache {
  models: OpenRouterModelCapability[];
  fetchedAt: number;
}

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

let cache: ModelCapabilitiesCache | null = null;

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase();
}

function getCachedModels(): OpenRouterModelCapability[] | null {
  if (!cache) {
    return null;
  }

  if (Date.now() - cache.fetchedAt >= CACHE_TTL_MS) {
    return null;
  }

  return cache.models;
}

function findModelCapability(
  models: OpenRouterModelCapability[],
  model: string,
): OpenRouterModelCapability | undefined {
  const normalizedModel = normalizeModelId(model);

  const exactMatch = models.find((candidate) => {
    const candidateIds = [
      candidate.id,
      candidate.canonical_slug,
      candidate.name,
    ]
      .filter((value): value is string => Boolean(value))
      .map(normalizeModelId);

    return candidateIds.includes(normalizedModel);
  });

  if (exactMatch) {
    return exactMatch;
  }

  return models.find((candidate) => {
    const candidateIds = [
      candidate.id,
      candidate.canonical_slug,
      candidate.name,
    ]
      .filter((value): value is string => Boolean(value))
      .map(normalizeModelId);

    return candidateIds.some(
      (candidateId) =>
        candidateId.includes(normalizedModel) ||
        normalizedModel.includes(candidateId),
    );
  });
}

function getInputModalities(
  capability?: OpenRouterModelCapability,
): string[] {
  if (!capability) {
    return [];
  }

  if (Array.isArray(capability.input_modalities)) {
    return capability.input_modalities;
  }

  if (Array.isArray(capability.architecture?.input_modalities)) {
    return capability.architecture.input_modalities;
  }

  return [];
}

async function findCapabilityForModel(
  model: string,
): Promise<OpenRouterModelCapability | undefined> {
  const cachedModels = getCachedModels();
  if (cachedModels) {
    const cachedMatch = findModelCapability(cachedModels, model);
    if (cachedMatch) {
      return cachedMatch;
    }

    const refreshedModels = await fetchOpenRouterModelCapabilities(true);
    return findModelCapability(refreshedModels, model);
  }

  const models = await fetchOpenRouterModelCapabilities();
  return findModelCapability(models, model);
}

/**
 * Fetch model capabilities from OpenRouter API.
 * Returns a list of models with their input/output modalities.
 * Results are cached for 30 minutes to avoid rate limiting.
 */
export async function fetchOpenRouterModelCapabilities(
  forceRefresh = false,
): Promise<OpenRouterModelCapability[]> {
  if (!forceRefresh && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.models;
  }

  try {
    const response = await fetch(OPENROUTER_MODELS_URL, {
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch model capabilities: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const models: OpenRouterModelCapability[] = Array.isArray(data?.data) ? data.data : [];

    cache = {
      models,
      fetchedAt: Date.now(),
    };

    return models;
  } catch (error) {
    // Return cached data even if stale on network failure
    if (cache) {
      return cache.models;
    }
    throw error;
  }
}

/**
 * Check if a specific model supports image input based on OpenRouter capabilities.
 * Falls back to pattern matching if the model isn't in the API response.
 */
export async function modelSupportsImages(model: string): Promise<boolean> {
  const lowerModel = model.toLowerCase();

  try {
    const found = await findCapabilityForModel(model);
    const inputModalities = getInputModalities(found);

    if (inputModalities.length > 0) {
      return inputModalities.includes('image');
    }

    // If found but no modality info, use pattern matching as fallback
    if (found) {
      return quickVisionCheck(found.id.toLowerCase());
    }

    // Model not in OpenRouter list - use pattern matching
    return quickVisionCheck(lowerModel);
  } catch {
    // On API failure, fall back to pattern matching
    return quickVisionCheck(lowerModel);
  }
}

/**
 * Fast pattern-based vision model detection.
 * Covers all major vision-capable models across providers.
 */
function quickVisionCheck(lowerModel: string): boolean {
  // Anthropic Claude (all Claude 3+ models support vision)
  if (
    lowerModel.includes('claude-3') ||
    lowerModel.includes('claude-4') ||
    lowerModel.includes('claude-sonnet-4') ||
    lowerModel.includes('claude-opus-4') ||
    lowerModel.includes('claude-opus-4-7')
  ) {
    return true;
  }

  // OpenAI GPT-4 variants with vision
  if (
    lowerModel.includes('gpt-4o') ||
    lowerModel.includes('gpt-4-turbo') ||
    lowerModel.includes('gpt-4-vision') ||
    lowerModel.includes('gpt-4.5') ||
    lowerModel.includes('chatgpt-4o')
  ) {
    return true;
  }

  // Google Gemini (all recent versions support vision)
  if (
    lowerModel.includes('gemini') &&
    !lowerModel.includes('gemini-pro') // original gemini-pro doesn't, but gemini-1.5+ does
  ) {
    return true;
  }
  if (
    lowerModel.includes('gemini-1.5') ||
    lowerModel.includes('gemini-2.0') ||
    lowerModel.includes('gemini-2.5') ||
    lowerModel.includes('gemini-pro-vision')
  ) {
    return true;
  }

  // Meta Llama 3.2+ (multimodal versions)
  if (lowerModel.includes('llama-3.2') || lowerModel.includes('llama-3.3') || lowerModel.includes('llama-4')) {
    // Only multimodal variants
    if (lowerModel.includes('vision') || lowerModel.includes('multimodal')) {
      return true;
    }
  }

  // Mistral Pixtral (vision-capable)
  if (lowerModel.includes('pixtral')) {
    return true;
  }

  // Qwen VL (vision-language) models
  if (lowerModel.includes('qwen') && lowerModel.includes('vl')) {
    return true;
  }

  // MiniCPM-V models
  if (lowerModel.includes('minicpm') && lowerModel.includes('v')) {
    return true;
  }

  // Cohere Command R+ (some variants support vision)
  if (lowerModel.includes('command-r') && lowerModel.includes('vision')) {
    return true;
  }

  // DeepSeek VL models
  if (lowerModel.includes('deepseek') && lowerModel.includes('vl')) {
    return true;
  }

  // Explicit vision keywords in any model name
  if (
    lowerModel.includes('vision') ||
    lowerModel.includes('vl-') ||
    lowerModel.includes('-vl') ||
    lowerModel.includes('multimodal')
  ) {
    return true;
  }

  return false;
}

/**
 * Get a list of model IDs that support image input from OpenRouter.
 * Useful for building autocomplete suggestions or filtering.
 */
export async function getVisionModelIds(): Promise<string[]> {
  try {
    const models = await fetchOpenRouterModelCapabilities();
    return models
      .filter((m) => getInputModalities(m).includes('image'))
      .map((m) => m.id);
  } catch {
    // Fallback to known vision models
    return [];
  }
}

/**
 * Clear the model capabilities cache.
 * Useful for testing or forcing a fresh fetch.
 */
export function clearModelCapabilitiesCache(): void {
  cache = null;
}
