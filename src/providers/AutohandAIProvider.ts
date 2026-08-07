/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { LLMGatewayClient } from "./LLMGatewayClient.js";
import { MLXProvider } from "./MLXProvider.js";
import type {
  AutohandAISettings,
  LLMGatewaySettings,
  LLMRequest,
  LLMResponse,
  NetworkSettings,
} from "../types.js";
import type { LLMProvider } from "./LLMProvider.js";
import { AUTOHAND_AI_LOCAL_CODING_MODEL_FALLBACKS } from "./autohandAILocalSetup.js";

export const AUTOHAND_AI_DEFAULT_BASE_URL = "https://api.autohand.ai/v1";
export const AUTOHAND_AI_FANTAIL_CONTEXT_WINDOW = 16_000;
export const AUTOHAND_AI_MOA_CONTEXT_WINDOW = 1_000_000;
export const AUTOHAND_AI_DEFAULT_CONTEXT_WINDOW = AUTOHAND_AI_FANTAIL_CONTEXT_WINDOW;

// Per-model output ceilings enforced by the inference gateway
// (inference `MODEL_LIMITS.<model>.maxCompletionTokens`). Sending a larger
// `max_tokens` is rejected upstream with a 400 "malformed request", so the
// provider clamps every request to the target model's ceiling. Keep these in
// lockstep with the inference worker.
export const AUTOHAND_AI_FANTAIL_MAX_OUTPUT_TOKENS = 4_096;
export const AUTOHAND_AI_MOA_MAX_OUTPUT_TOKENS = 262_144;
// Requested output when the caller does not specify one; mirrors the shared
// LLMGatewayClient default and is itself clamped to the model ceiling below.
export const AUTOHAND_AI_DEFAULT_MAX_OUTPUT_TOKENS = 16_000;

export interface AutohandAICloudModelDefinition {
  id: string;
  label: string;
  description: string;
  contextWindow: number;
  maxOutputTokens: number;
  toolCalls: boolean;
  reasoningEfforts?: readonly ["medium", "high", "xhigh"];
}

export const AUTOHAND_AI_CLOUD_MODEL_DEFINITIONS = [
  {
    id: "fantail",
    label: "Fantail",
    description: "Ultra fast coding model with tool calls and 16k input context",
    contextWindow: AUTOHAND_AI_FANTAIL_CONTEXT_WINDOW,
    maxOutputTokens: AUTOHAND_AI_FANTAIL_MAX_OUTPUT_TOKENS,
    toolCalls: true,
  },
  {
    id: "moa",
    label: "Moa (Thinking)",
    description: "Reasoning model with medium/high/xhigh effort and 256k input context",
    contextWindow: AUTOHAND_AI_MOA_CONTEXT_WINDOW,
    maxOutputTokens: AUTOHAND_AI_MOA_MAX_OUTPUT_TOKENS,
    toolCalls: true,
    reasoningEfforts: ["medium", "high", "xhigh"],
  },
] as const satisfies readonly AutohandAICloudModelDefinition[];

export const AUTOHAND_AI_CLOUD_MODELS = AUTOHAND_AI_CLOUD_MODEL_DEFINITIONS.map(
  (model) => model.id,
);

export const AUTOHAND_AI_LOCAL_MODELS = [
  ...AUTOHAND_AI_LOCAL_CODING_MODEL_FALLBACKS.map((model) => model.id),
];

export function getAutohandAICloudModelContextWindow(model: string): number {
  return AUTOHAND_AI_CLOUD_MODEL_DEFINITIONS.find((definition) => definition.id === model)
    ?.contextWindow ?? AUTOHAND_AI_DEFAULT_CONTEXT_WINDOW;
}

/**
 * The upstream `max_tokens` ceiling for a cloud model. Unknown models fall back
 * to the shared default so their requests behave exactly as before.
 */
export function getAutohandAICloudModelMaxOutputTokens(model: string): number {
  return AUTOHAND_AI_CLOUD_MODEL_DEFINITIONS.find((definition) => definition.id === model)
    ?.maxOutputTokens ?? AUTOHAND_AI_DEFAULT_MAX_OUTPUT_TOKENS;
}

/**
 * Resolve the `max_tokens` to send for a model: the caller's request (or the
 * shared default when omitted), clamped to the model's upstream ceiling and to
 * a valid integer >= 1 so the inference gateway never rejects it as malformed.
 */
export function resolveAutohandAIMaxTokens(model: string, requested?: number): number {
  const ceiling = getAutohandAICloudModelMaxOutputTokens(model);
  const desired = Number.isFinite(requested) && requested !== undefined
    ? Math.floor(requested)
    : AUTOHAND_AI_DEFAULT_MAX_OUTPUT_TOKENS;
  return Math.max(1, Math.min(desired, ceiling));
}

export class AutohandAIProvider implements LLMProvider {
  private readonly localProvider?: MLXProvider;
  private readonly cloudClient?: LLMGatewayClient;
  private model: string;

  constructor(
    private readonly config: AutohandAISettings,
    networkSettings?: NetworkSettings,
  ) {
    this.model = config.model || "fantail";

    if (config.plan === "local") {
      this.localProvider = new MLXProvider(
        {
          model: config.model || AUTOHAND_AI_LOCAL_MODELS[0],
          baseUrl: config.baseUrl,
          port: config.port,
          contextWindow: config.contextWindow ?? AUTOHAND_AI_MOA_CONTEXT_WINDOW,
        },
        networkSettings,
      );
      return;
    }

    const authToken = this.resolveCloudToken(config);
    const effectiveConfig: LLMGatewaySettings = {
      apiKey: authToken,
      baseUrl: config.baseUrl ?? AUTOHAND_AI_DEFAULT_BASE_URL,
      model: this.model,
      contextWindow: config.contextWindow ?? getAutohandAICloudModelContextWindow(this.model),
    };
    this.cloudClient = new LLMGatewayClient(effectiveConfig, networkSettings, {
      serviceName: "Autohand AI",
      credentialName: "Autohand AI API key",
      accountName: "Autohand AI account",
    });
  }

  getName(): string {
    return "autohandai";
  }

  setModel(model: string): void {
    this.model = model;
    this.localProvider?.setModel(model);
    this.cloudClient?.setDefaultModel(model);
  }

  async listModels(): Promise<string[]> {
    if (this.config.plan === "local") {
      return [...AUTOHAND_AI_LOCAL_MODELS];
    }
    return [...AUTOHAND_AI_CLOUD_MODELS];
  }

  async isAvailable(): Promise<boolean> {
    if (this.localProvider) {
      return this.localProvider.isAvailable();
    }
    return Boolean(this.resolveCloudToken(this.config));
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    if (this.localProvider) {
      return this.localProvider.complete({
        ...request,
        model: request.model ?? this.model,
        temperature: request.temperature ?? 0.1,
      });
    }

    if (this.config.plan !== "local" && !this.resolveCloudToken(this.config)) {
      throw new Error(
        "Autohand AI API key is required for API-key Cloud usage. Run /model to configure Autohand AI or set AUTOHAND_AI_API_KEY.",
      );
    }

    if (!this.cloudClient) {
      throw new Error("Autohand AI provider is not configured.");
    }

    const targetModel = request.model ?? this.model;
    return this.cloudClient.complete({
      ...request,
      model: targetModel,
      maxTokens: resolveAutohandAIMaxTokens(targetModel, request.maxTokens),
      temperature: request.temperature ?? 0.1,
      ...(this.model === "moa" && this.config.reasoningEffort
        ? {
            chatTemplateKwargs: {
              ...request.chatTemplateKwargs,
              reasoning_effort: this.config.reasoningEffort === "low" || this.config.reasoningEffort === "none"
                ? "medium"
                : this.config.reasoningEffort,
            },
          }
        : {}),
    });
  }

  private resolveCloudToken(config: AutohandAISettings): string {
    if (config.authMode === "account") {
      return config.accountToken ?? "";
    }
    return config.apiKey ?? "";
  }
}
