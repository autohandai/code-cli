/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError as AnthropicAPIError,
  APIUserAbortError,
} from "@anthropic-ai/sdk";
import type {
  Message,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/messages";
import type {
  AnthropicSettings,
  LLMRequest,
  LLMResponse,
  LLMToolCall,
  NetworkSettings,
  ProviderReasoningBlock,
} from "../types.js";
import type { LLMProvider, LLMProviderCapabilities } from "./LLMProvider.js";
import {
  REASONING_BLOCK_TYPES,
  toAnthropicMessages,
  toAnthropicTools,
  toAnthropicToolChoice,
} from "./anthropicMessages.js";
import {
  anthropicModelAcceptsDisabledThinking,
  anthropicModelHasAlwaysOnThinking,
  anthropicModelSupportsAdaptiveThinking,
  anthropicModelSupportsTemperature,
  normalizeAnthropicModelKey,
  resolveAnthropicEffort,
  type AnthropicEffort,
} from "./anthropicModels.js";
import { ApiError, classifyApiError, type ApiErrorCode } from "./errors.js";
import { getProviderModelIds } from "./modelCatalog.js";
import { normalizeLLMUsage } from "./usage.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_MAX_TOKENS = 16_000;
const DEFAULT_MAX_RETRIES = 3;
const MAX_ALLOWED_RETRIES = 5;

/**
 * The Anthropic SDK applies `timeout` to the entire request, and a
 * non-streaming Messages call returns nothing until generation finishes. The
 * repo-wide 30s network timeout is a time-to-headers budget for streaming
 * fetch clients, so applying it here would truncate every long turn. Treat the
 * configured value as a floor and never drop below the SDK's own default.
 */
export const ANTHROPIC_MIN_TIMEOUT_MS = 600_000;

export function resolveAnthropicTimeout(networkSettings?: NetworkSettings): number {
  const configured = networkSettings?.timeout;
  return typeof configured === "number" && Number.isFinite(configured)
    ? Math.max(configured, ANTHROPIC_MIN_TIMEOUT_MS)
    : ANTHROPIC_MIN_TIMEOUT_MS;
}

const ANTHROPIC_FRIENDLY_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  auth_failed:
    "Authentication failed. Please verify your Anthropic API key in ~/.autohand/config.json.",
  payment_required:
    "Payment required. Please check your Anthropic account balance or billing settings.",
  access_denied:
    "Access denied. Your Anthropic API key may not have permission for this model.",
  server_error:
    "The Anthropic service encountered an error. Please try again later.",
  network_error:
    "Unable to connect to Anthropic. Please check your internet connection.",
  timeout:
    "The request timed out. The Anthropic service may be experiencing high load.",
};

function withAnthropicMessage(error: ApiError): ApiError {
  const friendlyMessage = ANTHROPIC_FRIENDLY_MESSAGES[error.code];
  if (!friendlyMessage) {
    return error;
  }

  return new ApiError(
    error.rawDetail ? `${friendlyMessage}\n${error.rawDetail}` : friendlyMessage,
    error.code,
    error.httpStatus,
    error.retryable,
    error.retryAfterMs,
    error.rawDetail,
  );
}

function toThinkingConfig(
  modelKey: string,
  request: LLMRequest,
  effort: AnthropicEffort | undefined,
): MessageCreateParamsNonStreaming["thinking"] | undefined {
  if (anthropicModelHasAlwaysOnThinking(modelKey)) {
    return undefined;
  }

  if (request.thinkingLevel === "none") {
    return anthropicModelAcceptsDisabledThinking(modelKey, effort)
      ? { type: "disabled" }
      : undefined;
  }

  if (request.thinkingLevel !== "extended") {
    return undefined;
  }

  if (anthropicModelSupportsAdaptiveThinking(modelKey)) {
    return { type: "adaptive" };
  }

  const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;
  if (maxTokens <= 1_024) {
    return undefined;
  }

  return {
    type: "enabled",
    budget_tokens: Math.min(10_000, Math.max(1_024, maxTokens - 1)),
  };
}

// ── Response translation ───────────────────────────────────────────────────

function toFinishReason(stopReason: Message["stop_reason"]): LLMResponse["finishReason"] {
  if (stopReason === "tool_use") {
    return "tool_calls";
  }
  if (stopReason === "max_tokens" || stopReason === "model_context_window_exceeded") {
    return "length";
  }
  if (stopReason === "refusal") {
    return "content_filter";
  }
  return "stop";
}

/**
 * A refusal returns HTTP 200 with empty content, which the agent loop would
 * otherwise read as a blank turn. Surface the classifier explanation instead.
 */
function toRefusalText(message: Message): string {
  const details = message.stop_details;
  const explanation =
    details && "explanation" in details && typeof details.explanation === "string"
      ? details.explanation
      : undefined;
  const category =
    details && "category" in details && typeof details.category === "string"
      ? details.category
      : undefined;
  return [
    explanation ?? "Anthropic declined this request.",
    category ? `(refusal category: ${category})` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

function getErrorDetail(error: AnthropicAPIError): string {
  const responseBody = error.error;
  if (responseBody && typeof responseBody === "object") {
    const nested = "error" in responseBody ? responseBody.error : undefined;
    if (nested && typeof nested === "object" && "message" in nested && typeof nested.message === "string") {
      return nested.message;
    }
  }
  return error.message;
}

function normalizeAnthropicError(error: unknown): ApiError {
  if (error instanceof APIUserAbortError) {
    return new ApiError("Request cancelled.", "cancelled", 0, false);
  }
  if (error instanceof APIConnectionTimeoutError) {
    return withAnthropicMessage(new ApiError(error.message, "timeout", 0, true, undefined, error.message));
  }
  if (error instanceof APIConnectionError) {
    return withAnthropicMessage(new ApiError(error.message, "network_error", 0, true, undefined, error.message));
  }
  if (error instanceof AnthropicAPIError) {
    const detail = getErrorDetail(error);
    return withAnthropicMessage(classifyApiError(error.status ?? 0, detail, error.headers));
  }

  const detail = error instanceof Error ? error.message : String(error);
  return classifyApiError(0, detail);
}

export class AnthropicProvider implements LLMProvider {
  private readonly client: Anthropic;
  private readonly apiKey: string;
  private readonly reasoningEffort: AnthropicSettings["reasoningEffort"];
  private model: string;

  constructor(settings: AnthropicSettings, networkSettings?: NetworkSettings) {
    this.apiKey = settings.apiKey;
    this.model = settings.model;
    this.reasoningEffort = settings.reasoningEffort;
    const configuredRetries = networkSettings?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.client = new Anthropic({
      apiKey: settings.apiKey,
      baseURL: settings.baseUrl ?? DEFAULT_BASE_URL,
      maxRetries: Math.min(Math.max(0, configuredRetries), MAX_ALLOWED_RETRIES),
      timeout: resolveAnthropicTimeout(networkSettings),
    });
  }

  getName(): string {
    return "anthropic";
  }

  getCapabilities(): LLMProviderCapabilities {
    return { nativeToolCalling: true };
  }

  setModel(model: string): void {
    this.model = model;
  }

  async listModels(): Promise<string[]> {
    return getProviderModelIds("anthropic");
  }

  async isAvailable(): Promise<boolean> {
    return this.apiKey.length > 0;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const selectedModel = request.model ?? this.model;
    const modelKey = normalizeAnthropicModelKey(selectedModel);
    const converted = toAnthropicMessages(request.messages);
    const tools = request.tools?.length ? toAnthropicTools(request.tools) : undefined;
    const effort = resolveAnthropicEffort(modelKey, this.reasoningEffort);
    const thinking = toThinkingConfig(modelKey, request, effort);
    const outputConfig: NonNullable<MessageCreateParamsNonStreaming["output_config"]> = {};
    if (request.outputSchema) {
      outputConfig.format = {
        type: "json_schema",
        schema: request.outputSchema,
      };
    }
    if (effort) {
      outputConfig.effort = effort;
    }
    const hasOutputConfig = Object.keys(outputConfig).length > 0;
    const params: MessageCreateParamsNonStreaming = {
      model: selectedModel,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: converted.messages,
      // Automatically caches the stable prefix (tools + system + prior turns).
      cache_control: { type: "ephemeral" },
      ...(converted.system ? { system: converted.system } : {}),
      ...(tools ? { tools } : {}),
      ...(tools && request.toolChoice ? { tool_choice: toAnthropicToolChoice(request.toolChoice) } : {}),
      ...(request.temperature !== undefined && anthropicModelSupportsTemperature(modelKey)
        ? { temperature: request.temperature }
        : {}),
      ...(thinking ? { thinking } : {}),
      ...(hasOutputConfig ? { output_config: outputConfig } : {}),
    };

    try {
      const message = await this.client.messages.create(params, {
        signal: request.signal,
      });
      const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      const reasoningBlocks = message.content.filter((block) =>
        REASONING_BLOCK_TYPES.has(block.type),
      ) as unknown as ProviderReasoningBlock[];
      const toolCalls: LLMToolCall[] = message.content
        .filter((block) => block.type === "tool_use")
        .map((block) => ({
          id: block.id,
          type: "function" as const,
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        }));
      const promptTokens =
        message.usage.input_tokens +
        (message.usage.cache_creation_input_tokens ?? 0) +
        (message.usage.cache_read_input_tokens ?? 0);
      const usage = normalizeLLMUsage({
        prompt_tokens: promptTokens,
        completion_tokens: message.usage.output_tokens,
        cache_creation_input_tokens: message.usage.cache_creation_input_tokens,
        cache_read_input_tokens: message.usage.cache_read_input_tokens,
      });
      const content =
        message.stop_reason === "refusal" && !text ? toRefusalText(message) : text;

      return {
        id: message.id,
        created: Math.floor(Date.now() / 1_000),
        content,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        finishReason: toFinishReason(message.stop_reason),
        ...(usage ? { usage } : {}),
        ...(reasoningBlocks.length > 0 ? { reasoningBlocks } : {}),
        raw: message,
      };
    } catch (error) {
      throw normalizeAnthropicError(error);
    }
  }
}
