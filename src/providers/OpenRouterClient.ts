/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  LLMRequest,
  LLMResponse,
  LLMToolCall,
  LLMUsage,
  OpenRouterSettings,
  NetworkSettings,
  FunctionDefinition,
  LLMMessage,
} from "../types.js";
import { ApiError, classifyApiError } from "./errors.js";
import { modelSupportsImages } from "./modelCapabilities.js";

/**
 * Sanitize messages for API consumption.
 * Only includes fields expected by OpenAI-compatible APIs:
 * - role, content (always)
 * - tool_call_id (for tool messages)
 * - tool_calls (for assistant messages)
 * - name (for function messages, optional)
 * Excludes internal fields like priority, metadata.
 */
function messageContainsImageContent(messages: LLMMessage[]): boolean {
  return messages.some((msg) =>
    Array.isArray(msg.content) &&
    msg.content.some(
      (part) =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "image_url"
    )
  );
}

function getTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter(
      (part): part is { type: string; text?: string } =>
        typeof part === "object" && part !== null && "type" in part
    )
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("\n");
}

function sanitizeMessages(
  messages: LLMMessage[],
  allowImageInputs: boolean
): Record<string, unknown>[] {
  return messages.map((msg) => {
    const sanitized: Record<string, unknown> = {
      role: msg.role,
      content:
        allowImageInputs || !Array.isArray(msg.content)
          ? msg.content
          : getTextContent(msg.content),
    };

    // Add tool_call_id for tool response messages
    if (msg.role === "tool" && msg.tool_call_id) {
      sanitized.tool_call_id = msg.tool_call_id;
    }

    // Add tool_calls for assistant messages that invoked tools
    if (msg.role === "assistant" && msg.tool_calls?.length) {
      sanitized.tool_calls = msg.tool_calls;
    }

    // Add name for function/tool context (optional, some providers use it)
    if (msg.name) {
      sanitized.name = msg.name;
    }

    return sanitized;
  });
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MAX_RETRIES = 3;
const MAX_ALLOWED_RETRIES = 5;
const DEFAULT_RETRY_DELAY = 1000;
const DEFAULT_TIMEOUT = 30000;

// FRIENDLY_ERRORS removed — now centralized in ./errors.ts (FRIENDLY_MESSAGES)

export class OpenRouterClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private defaultModel: string;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly timeout: number;

  constructor(settings: OpenRouterSettings, networkSettings?: NetworkSettings) {
    this.apiKey = settings.apiKey ?? "";
    this.baseUrl = settings.baseUrl ?? DEFAULT_BASE_URL;
    this.defaultModel = settings.model;

    // Network settings with sensible defaults and max limits
    const configuredRetries =
      networkSettings?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.maxRetries = Math.min(
      Math.max(0, configuredRetries),
      MAX_ALLOWED_RETRIES
    );
    this.retryDelay = networkSettings?.retryDelay ?? DEFAULT_RETRY_DELAY;
    this.timeout = networkSettings?.timeout ?? DEFAULT_TIMEOUT;
  }

  setDefaultModel(model: string): void {
    this.defaultModel = model;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const selectedModel = request.model ?? this.defaultModel;
    const allowImageInputs = messageContainsImageContent(request.messages)
      ? await modelSupportsImages(selectedModel)
      : false;

    const payload: Record<string, unknown> = {
      model: selectedModel,
      messages: sanitizeMessages(request.messages, allowImageInputs),
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 16000, // Increased from 1000 to allow large file generation
      stream: request.stream ?? false,
    };

    // Add function calling support if tools are provided
    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools.map((tool: FunctionDefinition) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters ?? { type: "object", properties: {} },
        },
      }));

      // Set tool_choice based on request
      if (request.toolChoice) {
        payload.tool_choice = request.toolChoice;
      }
    }

    // Add thinking/reasoning level support for compatible models
    const model = selectedModel.toLowerCase();
    if (request.thinkingLevel && request.thinkingLevel !== 'normal') {
      // OpenAI o1/o3 models use reasoning_effort
      if (model.includes('o1') || model.includes('o3')) {
        if (request.thinkingLevel === 'extended') {
          payload.reasoning_effort = 'high';
        } else if (request.thinkingLevel === 'none') {
          payload.reasoning_effort = 'low';
        }
      }
      // Anthropic Claude models with extended thinking support
      // OpenRouter passes provider-specific options via the provider field
      if (model.includes('claude') && request.thinkingLevel === 'extended') {
        payload.provider = {
          anthropic: {
            thinking: {
              type: 'enabled',
              budget_tokens: 10000
            }
          }
        };
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "HTTP-Referer": "https://autohand.dev",
      "X-OpenRouter-Title": "Autohand Code CLI",
      "X-OpenRouter-Categories": "cli-agent",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    // Validate payload size before sending
    const payloadJson = JSON.stringify(payload);
    const payloadSizeBytes = payloadJson.length;
    const maxPayloadSize = 5 * 1024 * 1024; // 5MB safety limit

    if (payloadSizeBytes > maxPayloadSize) {
      const sizeMB = (payloadSizeBytes / (1024 * 1024)).toFixed(2);
      throw new ApiError(
        `Request payload too large (${sizeMB}MB). ` +
          `This usually happens when the conversation history grows too long. ` +
          `Try using /undo to remove recent turns or /new to start fresh.`,
        'context_overflow',
        400,
        true,
      );
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.makeRequest(
          payload,
          headers,
          request.signal,
          payloadJson
        );
        return response;
      } catch (error) {
        lastError = error as Error;

        // Don't retry if user cancelled or if it's a non-retryable error
        if (this.isNonRetryableError(error as Error)) {
          throw error;
        }

        // If we have more attempts left, wait before retrying
        if (attempt < this.maxRetries) {
          const retryAfterMs = error instanceof ApiError ? error.retryAfterMs : undefined;
          const delay = Math.max(
            this.retryDelay * Math.pow(2, attempt),
            retryAfterMs ?? 0
          );
          await this.sleep(delay);
        }
      }
    }

    // All retries exhausted
    throw (
      lastError ??
      new ApiError("Failed to communicate with the AI service. Please try again.", 'network_error', 0, true)
    );
  }

  private async makeRequest(
    payload: object,
    headers: Record<string, string>,
    signal?: AbortSignal,
    preSerializedBody?: string
  ): Promise<LLMResponse> {
    let response: Response;

    try {
      // Create timeout controller
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(
        () => timeoutController.abort(),
        this.timeout
      );

      // Combine user signal with timeout
      const combinedSignal = signal
        ? this.combineSignals(signal, timeoutController.signal)
        : timeoutController.signal;

      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: preSerializedBody ?? JSON.stringify(payload),
          signal: combinedSignal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      const err = error as Error;

      // User cancelled
      if (err.name === "AbortError" && signal?.aborted) {
        throw new ApiError("Request cancelled.", 'cancelled', 0, false);
      }

      // Timeout
      if (err.name === "AbortError") {
        throw new ApiError(
          "Request timed out. The AI service may be experiencing high load.",
          'timeout', 0, true,
        );
      }

      // Network error - friendly message
      throw new ApiError(
        "Unable to connect to the AI service. Please check your internet connection.",
        'network_error', 0, true,
      );
    }

    if (!response.ok) {
      throw await this.buildApiError(response);
    }

    const json = (await response.json()) as any;
    const message = json?.choices?.[0]?.message;
    const text = message?.content ?? "";
    const finishReason = json?.choices?.[0]?.finish_reason;

    // Parse tool calls if present
    let toolCalls: LLMToolCall[] | undefined;
    if (message?.tool_calls && Array.isArray(message.tool_calls)) {
      toolCalls = message.tool_calls.map((tc: any) => {
        const rawArgs = tc.function?.arguments;
        return {
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.function?.name ?? "",
            arguments: rawArgs ?? "{}",
          },
        };
      });
    }

    // Parse token usage if present
    let usage: LLMUsage | undefined;
    if (json?.usage) {
      usage = {
        promptTokens: json.usage.prompt_tokens ?? 0,
        completionTokens: json.usage.completion_tokens ?? 0,
        totalTokens: json.usage.total_tokens ?? 0,
      };
    }

    return {
      id: json.id ?? "autohand-local",
      created: json.created ?? Date.now(),
      content: text,
      toolCalls,
      finishReason: finishReason as LLMResponse["finishReason"],
      usage,
      raw: json,
    };
  }

  private async buildApiError(response: Response): Promise<ApiError> {
    const status = response.status;

    // Try to get the actual error message from the response
    let errorDetail = "";
    try {
      const body = (await response.json()) as any;
      errorDetail = body?.error?.message || body?.error || body?.message || "";
      if (typeof errorDetail === "object") {
        errorDetail = JSON.stringify(errorDetail);
      }
    } catch {
      // Fallback to raw text if JSON parsing fails
      try {
        errorDetail = await response.text();
      } catch {
        // Ignore
      }
    }

    return classifyApiError(status, errorDetail, response.headers);
  }

  private isNonRetryableError(error: Error): boolean {
    // OpenRouterClient always throws ApiError from makeRequest/buildApiError,
    // so the only path here is the ApiError branch. The string-matching fallback
    // was dead code and has been removed.
    if (error instanceof ApiError) {
      return !error.retryable;
    }
    // Defensive: delegate to the centralized classifier for unexpected errors
    const classified = classifyApiError(0, error.message);
    return !classified.retryable;
  }

  private combineSignals(
    signal1: AbortSignal,
    signal2: AbortSignal
  ): AbortSignal {
    const controller = new AbortController();

    const abort = () => controller.abort();
    signal1.addEventListener("abort", abort, { once: true });
    signal2.addEventListener("abort", abort, { once: true });

    if (signal1.aborted || signal2.aborted) {
      controller.abort();
    }

    return controller.signal;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
