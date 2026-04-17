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
  CerebrasSettings,
  NetworkSettings,
  FunctionDefinition,
  LLMMessage,
} from "../types.js";

/**
 * Sanitize messages for API consumption.
 * Only includes fields expected by OpenAI-compatible APIs:
 * - role, content (always)
 * - tool_call_id (for tool messages)
 * - tool_calls (for assistant messages)
 * - name (for function messages, optional)
 * Excludes internal fields like priority, metadata.
 */
function sanitizeMessages(messages: LLMMessage[]): Record<string, unknown>[] {
  return messages.map((msg) => {
    const sanitized: Record<string, unknown> = {
      role: msg.role,
      content: msg.content,
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

const DEFAULT_BASE_URL = "https://api.cerebras.ai/v1";
const DEFAULT_MAX_RETRIES = 3;
const MAX_ALLOWED_RETRIES = 5;
const DEFAULT_RETRY_DELAY = 1000;
const DEFAULT_TIMEOUT = 30000;

/** User-friendly error messages that hide raw provider errors */
const FRIENDLY_ERRORS: Record<number, string> = {
  400: "The request was malformed. This often happens when the context is too long. Try /undo to remove recent turns or /new to start fresh.",
  401: "Authentication failed. Please verify your Cerebras API key in ~/.autohand/config.json.",
  402: "Payment required. Please check your Cerebras account balance or billing settings.",
  403: "Access denied. Your API key may not have permission for this model.",
  404: "The requested model was not found. Use /model to select a different one.",
  429: "Rate limit exceeded. Please wait a moment and try again, or choose a different model.",
  500: "The Cerebras service encountered an internal error. Please try again later.",
  502: "The Cerebras service is temporarily unavailable. Please try again in a few moments.",
  503: "The Cerebras service is currently overloaded. Please try again later.",
  504: "The request timed out. The service may be experiencing high load.",
};

export class CerebrasClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private defaultModel: string;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly timeout: number;

  constructor(settings: CerebrasSettings, networkSettings?: NetworkSettings) {
    this.apiKey = settings.apiKey;
    this.baseUrl = settings.baseUrl ?? DEFAULT_BASE_URL;
    this.defaultModel = settings.model;
    this.maxRetries = Math.min(
      networkSettings?.maxRetries ?? DEFAULT_MAX_RETRIES,
      MAX_ALLOWED_RETRIES
    );
    this.retryDelay = DEFAULT_RETRY_DELAY;
    this.timeout = networkSettings?.timeout ?? DEFAULT_TIMEOUT;
  }

  setDefaultModel(model: string): void {
    this.defaultModel = model;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const payload: Record<string, unknown> = {
      model: request.model ?? this.defaultModel,
      messages: sanitizeMessages(request.messages),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 20000,
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

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-source": "Autohand Code CLI",
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
      new Error("Failed to communicate with Cerebras API. Please try again.")
    );
  }

  private async makeRequest(
    payload: Record<string, unknown>,
    headers: Record<string, string>,
    signal: AbortSignal | undefined,
    payloadJson: string
  ): Promise<LLMResponse> {
    // Create timeout controller
    const timeoutController = new AbortController();
    const timerId = setTimeout(() => timeoutController.abort(), this.timeout);

    // Combine user signal with timeout if provided
    const combinedSignal = signal
      ? this.combineSignals(signal, timeoutController.signal)
      : timeoutController.signal;

    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: payloadJson,
        signal: combinedSignal,
      });
    } finally {
      clearTimeout(timerId);
    }

    if (!response.ok) {
      throw await this.buildApiError(response, payload);
    }

    // Handle streaming response
    if (payload.stream) {
      return this.handleStreamingResponse(response);
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    let toolCalls: LLMToolCall[] | undefined;
    if (choice?.message?.tool_calls?.length) {
      toolCalls = choice.message.tool_calls.map((tc: { id: string; type: string; function: { name: string; arguments: string } }) => ({
        id: tc.id,
        type: tc.type || "function",
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));
    }

    let usage: LLMUsage | undefined;
    if (data.usage) {
      usage = {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      };
    }

    const finishReason = toolCalls?.length
      ? "tool_calls"
      : choice?.finish_reason === "stop" ||
        choice?.finish_reason === "length" ||
        choice?.finish_reason === "content_filter"
      ? choice.finish_reason
      : "stop";

    return {
      id: data.id || `cerebras-${Date.now()}`,
      created: data.created || Math.floor(Date.now() / 1000),
      content: choice?.message?.content ?? "",
      toolCalls,
      usage,
      finishReason,
      raw: data,
    };
  }

  private async handleStreamingResponse(response: Response): Promise<LLMResponse> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body available for streaming");
    }

    let content = "";
    let finishReason: "stop" | "tool_calls" | "length" | "content_filter" | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              if (delta?.content) {
                content += delta.content;
              }
              if (parsed.choices?.[0]?.finish_reason) {
                finishReason = parsed.choices[0].finish_reason;
              }
            } catch {
              // Ignore malformed SSE data
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      id: `cerebras-${Date.now()}`,
      created: Math.floor(Date.now() / 1000),
      content,
      finishReason: finishReason || "stop",
      raw: { content, finishReason },
    };
  }

  private combineSignals(
    userSignal: AbortSignal,
    timeoutSignal: AbortSignal
  ): AbortSignal {
    const controller = new AbortController();

    const onAbort = () => {
      controller.abort();
    };

    userSignal.addEventListener("abort", onAbort);
    timeoutSignal.addEventListener("abort", onAbort);

    // If already aborted, abort immediately
    if (userSignal.aborted || timeoutSignal.aborted) {
      controller.abort();
    }

    return controller.signal;
  }

  private async buildApiError(
    response: Response,
    _body: Record<string, unknown>
  ): Promise<Error> {
    let errorDetail = "";
    try {
      const errorData = await response.json();
      errorDetail = errorData.error?.message || JSON.stringify(errorData);
    } catch {
      try {
        errorDetail = await response.text();
      } catch {
        errorDetail = `HTTP ${response.status}`;
      }
    }

    const friendlyMessage =
      FRIENDLY_ERRORS[response.status] ||
      `Cerebras API error (${response.status}): ${errorDetail}`;

    return new Error(friendlyMessage);
  }

  private isNonRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    // Don't retry auth errors or client errors (4xx except 429 rate limit)
    return (
      message.includes("authentication failed") ||
      message.includes("access denied") ||
      message.includes("not found") ||
      message.includes("malformed")
    );
  }
}
