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
} from "./types.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MAX_RETRIES = 3;
const MAX_ALLOWED_RETRIES = 5;
const DEFAULT_RETRY_DELAY = 1000;
const DEFAULT_TIMEOUT = 30000;

/** User-friendly error messages that hide raw provider errors */
const FRIENDLY_ERRORS: Record<number, string> = {
  400: "The request was malformed. This often happens when the context is too long. Try /undo to remove recent turns or /new to start fresh.",
  401: "Authentication failed. Please verify your API key in ~/.autohand/config.json.",
  402: "Payment required. Please check your account balance or billing settings.",
  403: "Access denied. Your API key may not have permission for this model.",
  404: "The requested model was not found. Use /model to select a different one.",
  429: "Rate limit exceeded. Please wait a moment and try again, or choose a different model.",
  500: "The AI service encountered an internal error. Please try again later.",
  502: "The AI service is temporarily unavailable. Please try again in a few moments.",
  503: "The AI service is currently overloaded. Please try again later.",
  504: "The request timed out. The AI service may be experiencing high load.",
};

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
    const payload: Record<string, unknown> = {
      model: request.model ?? this.defaultModel,
      messages: request.messages,
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
    const model = (request.model ?? this.defaultModel).toLowerCase();
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
      "HTTP-Referer": "https://github.com/autohandai/code-cli",
      "X-Title": "autohand-code-cli",
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
      throw new Error(
        `Request payload too large (${sizeMB}MB). ` +
          `This usually happens when the conversation history grows too long. ` +
          `Try using /undo to remove recent turns or /new to start fresh.`
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
          const delay = this.retryDelay * Math.pow(2, attempt); // Exponential backoff
          await this.sleep(delay);
        }
      }
    }

    // All retries exhausted
    throw (
      lastError ??
      new Error("Failed to communicate with the AI service. Please try again.")
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
        throw new Error("Request cancelled.");
      }

      // Timeout
      if (err.name === "AbortError") {
        throw new Error(
          "Request timed out. The AI service may be experiencing high load."
        );
      }

      // Network error - friendly message
      throw new Error(
        "Unable to connect to the AI service. Please check your internet connection."
      );
    }

    if (!response.ok) {
      throw new Error(await this.buildFriendlyError(response));
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
        // Debug log to see what the API actually returned
        if (!rawArgs || rawArgs === "{}" || rawArgs === "") {
          console.error(
            `[DEBUG] Tool "${
              tc.function?.name
            }" raw arguments from API: "${rawArgs}" (type: ${typeof rawArgs})`
          );
        }
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

  private async buildFriendlyError(response: Response): Promise<string> {
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

    // Return user-friendly message with details when available
    const friendlyMessage = FRIENDLY_ERRORS[status];
    if (friendlyMessage) {
      return errorDetail
        ? `${friendlyMessage}\n${errorDetail}`
        : friendlyMessage;
    }

    // For unknown errors, include status and details
    if (status >= 500) {
      const base =
        "The AI service is temporarily unavailable. Please try again later.";
      return errorDetail ? `${base}\n(${status}: ${errorDetail})` : base;
    }

    if (status >= 400) {
      const base = "The request could not be processed.";
      return errorDetail
        ? `${base} (${status}: ${errorDetail})`
        : `${base} (HTTP ${status}) Please try again or adjust your prompt.`;
    }

    return errorDetail
      ? `An unexpected error occurred: ${errorDetail}`
      : "An unexpected error occurred. Please try again.";
  }

  private isNonRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();

    // Don't retry on user cancellation
    if (message.includes("cancelled") || message.includes("aborted")) {
      return true;
    }

    // Don't retry auth errors
    if (message.includes("authentication") || message.includes("api key")) {
      return true;
    }

    // Don't retry payment/access errors
    if (message.includes("payment") || message.includes("access denied")) {
      return true;
    }

    // Don't retry model not found
    if (message.includes("not found")) {
      return true;
    }

    return false;
  }

  private combineSignals(
    signal1: AbortSignal,
    signal2: AbortSignal
  ): AbortSignal {
    const controller = new AbortController();

    const abort = () => controller.abort();
    signal1.addEventListener("abort", abort);
    signal2.addEventListener("abort", abort);

    if (signal1.aborted || signal2.aborted) {
      controller.abort();
    }

    return controller.signal;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
