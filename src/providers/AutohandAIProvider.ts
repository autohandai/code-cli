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

export interface AutohandAICloudModelDefinition {
  id: string;
  label: string;
  description: string;
  contextWindow: number;
  toolCalls: boolean;
  reasoningEfforts?: readonly ["medium", "high", "xhigh"];
}

export const AUTOHAND_AI_CLOUD_MODEL_DEFINITIONS = [
  {
    id: "fantail",
    label: "Fantail",
    description: "Ultra fast coding model with tool calls and 16k input context",
    contextWindow: AUTOHAND_AI_FANTAIL_CONTEXT_WINDOW,
    toolCalls: true,
  },
  {
    id: "moa",
    label: "Moa (Thinking)",
    description: "Reasoning model with medium/high/xhigh effort and 256k input context",
    contextWindow: AUTOHAND_AI_MOA_CONTEXT_WINDOW,
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

    return this.cloudClient.complete({
      ...request,
      model: request.model ?? this.model,
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
