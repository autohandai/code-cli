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
  NvidiaAISettings,
  NetworkSettings,
  FunctionDefinition,
  NvidiaChatTemplateKwargs,
} from "../types.js";

/**
 * Sanitize messages for API consumption.
 * Only includes fields expected by OpenAI-compatible APIs.
 */
function sanitizeMessages(messages: Array<{ role: string; content: string; name?: string; tool_call_id?: string; tool_calls?: LLMToolCall[] }>): Record<string, unknown>[] {
  return messages.map((msg) => {
    const sanitized: Record<string, unknown> = {
      role: msg.role,
      content: msg.content,
    };

    if (msg.role === "tool" && msg.tool_call_id) {
      sanitized.tool_call_id = msg.tool_call_id;
    }

    if (msg.role === "assistant" && msg.tool_calls?.length) {
      sanitized.tool_calls = msg.tool_calls;
    }

    if (msg.name) {
      sanitized.name = msg.name;
    }

    return sanitized;
  });
}

const NVIDIA_DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MAX_RETRIES = 3;
const MAX_ALLOWED_RETRIES = 5;
const DEFAULT_RETRY_DELAY = 1000;
const DEFAULT_TIMEOUT = 30000;

/** User-friendly error messages for NVIDIA API */
const FRIENDLY_ERRORS: Record<number, string> = {
  400: "The request was malformed. This often happens when the context is too long. Try /undo to remove recent turns or /new to start fresh.",
  401: "Authentication failed. Please verify your NVIDIA API key in ~/.autohand/config.json.",
  402: "Payment required. Please check your NVIDIA account balance or billing settings.",
  403: "Access denied. Your API key may not have permission for this model.",
  404: "The requested model was not found. Use /model to select a different one.",
  429: "Rate limit exceeded. Please wait a moment and try again, or choose a different model.",
  500: "The NVIDIA service encountered an internal error. Please try again later.",
  502: "The NVIDIA service is temporarily unavailable. Please try again in a few moments.",
  503: "The NVIDIA service is currently overloaded. Please try again later.",
  504: "The request timed out. The service may be experiencing high load.",
};

export class NVIDIAClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private defaultModel: string;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly timeout: number;

  constructor(settings: NvidiaAISettings, networkSettings?: NetworkSettings) {
    this.apiKey = settings.apiKey ?? "";
    this.baseUrl = settings.baseUrl ?? NVIDIA_DEFAULT_BASE_URL;
    this.defaultModel = settings.model;

    const configuredRetries = networkSettings?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.maxRetries = Math.min(Math.max(0, configuredRetries), MAX_ALLOWED_RETRIES);
    this.retryDelay = networkSettings?.retryDelay ?? DEFAULT_RETRY_DELAY;
    this.timeout = networkSettings?.timeout ?? DEFAULT_TIMEOUT;
  }

  setDefaultModel(model: string): void {
    this.defaultModel = model;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const payload = this.buildPayload(request);

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

      if (request.toolChoice) {
        payload.tool_choice = request.toolChoice;
      }
    }

    // Add chat_template_kwargs for NVIDIA reasoning models
    if (request.chatTemplateKwargs) {
      payload.extra_body = {
        chat_template_kwargs: this.buildChatTemplateKwargs(request.chatTemplateKwargs),
      };
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
          payloadJson,
          request.stream ?? false
        );
        return response;
      } catch (error) {
        lastError = error as Error;

        if (this.isNonRetryableError(error as Error)) {
          throw error;
        }

        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt);
          await this.sleep(delay);
        }
      }
    }

    throw (
      lastError ??
      new Error("Failed to communicate with NVIDIA API. Please try again.")
    );
  }

  private buildPayload(request: LLMRequest): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      model: request.model ?? this.defaultModel,
      messages: sanitizeMessages(request.messages),
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 16000,
      stream: request.stream ?? false,
    };
    return payload;
  }

  private buildChatTemplateKwargs(kwargs: NvidiaChatTemplateKwargs): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (kwargs.thinking !== undefined) result.thinking = kwargs.thinking;
    if (kwargs.enable_thinking !== undefined) result.enable_thinking = kwargs.enable_thinking;
    if (kwargs.reasoning_effort !== undefined) result.reasoning_effort = kwargs.reasoning_effort;
    if (kwargs.clear_thinking !== undefined) result.clear_thinking = kwargs.clear_thinking;
    return result;
  }

  private async makeRequest(
    payload: object,
    headers: Record<string, string>,
    signal?: AbortSignal,
    preSerializedBody?: string,
    isStreaming: boolean = false
  ): Promise<LLMResponse> {
    let response: Response;

    try {
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), this.timeout);

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

      if (err.name === "AbortError" && signal?.aborted) {
        throw new Error("Request cancelled.");
      }

      if (err.name === "AbortError") {
        throw new Error("Request timed out. The NVIDIA service may be experiencing high load.");
      }

      throw new Error("Unable to connect to NVIDIA API. Please check your internet connection.");
    }

    if (!response.ok) {
      throw new Error(await this.buildFriendlyError(response));
    }

    if (isStreaming) {
      return this.handleStreamingResponse(response);
    }

    const json = (await response.json()) as any;
    const message = json?.choices?.[0]?.message;
    const text = message?.content ?? "";
    const finishReason = json?.choices?.[0]?.finish_reason;

    let toolCalls: LLMToolCall[] | undefined;
    if (message?.tool_calls && Array.isArray(message.tool_calls)) {
      toolCalls = message.tool_calls.map((tc: any) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.function?.name ?? "",
          arguments: tc.function?.arguments ?? "{}",
        },
      }));
    }

    let usage: LLMUsage | undefined;
    if (json?.usage) {
      usage = {
        promptTokens: json.usage.prompt_tokens ?? 0,
        completionTokens: json.usage.completion_tokens ?? 0,
        totalTokens: json.usage.total_tokens ?? 0,
      };
    }

    return {
      id: json.id ?? "nvidia-response",
      created: json.created ?? Date.now(),
      content: text,
      toolCalls,
      finishReason: finishReason as LLMResponse["finishReason"],
      usage,
      raw: json,
    };
  }

  private async handleStreamingResponse(response: Response): Promise<LLMResponse> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body for streaming");
    }

    const decoder = new TextDecoder();
    let fullContent = "";
    let fullReasoning = "";
    let lastChunk: any = null;
    let finishReason: string = "stop";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter(line => line.trim());

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6).trim();
            if (dataStr === "[DONE]") continue;

            try {
              const data = JSON.parse(dataStr);
              lastChunk = data;

              const delta = data.choices?.[0]?.delta;
              if (!delta) continue;

              // Extract reasoning content (DeepSeek uses 'reasoning', Z.ai uses 'reasoning_content')
              const reasoning = delta.reasoning || delta.reasoning_content;
              if (reasoning) {
                fullReasoning += reasoning;
              }

              if (delta.content) {
                fullContent += delta.content;
              }

              if (data.choices?.[0]?.finish_reason) {
                finishReason = data.choices[0].finish_reason;
              }
            } catch {
              // Skip invalid JSON lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Combine reasoning and content if reasoning exists
    const finalContent = fullReasoning
      ? `<thinking>${fullReasoning}</thinking>\n\n${fullContent}`
      : fullContent;

    return {
      id: lastChunk?.id ?? `nvidia-stream-${Date.now()}`,
      created: lastChunk?.created ?? Math.floor(Date.now() / 1000),
      content: finalContent,
      finishReason: finishReason as LLMResponse["finishReason"],
      raw: { content: fullContent, reasoning: fullReasoning, chunks: lastChunk },
    };
  }

  private async buildFriendlyError(response: Response): Promise<string> {
    const status = response.status;

    let errorDetail = "";
    try {
      const body = (await response.json()) as any;
      errorDetail = body?.error?.message || body?.error || body?.message || "";
      if (typeof errorDetail === "object") {
        errorDetail = JSON.stringify(errorDetail);
      }
    } catch {
      try {
        errorDetail = await response.text();
      } catch {
        // Ignore
      }
    }

    const friendlyMessage = FRIENDLY_ERRORS[status];
    if (friendlyMessage) {
      return errorDetail ? `${friendlyMessage}\n${errorDetail}` : friendlyMessage;
    }

    if (status >= 500) {
      const base = "The NVIDIA service is temporarily unavailable. Please try again later.";
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

    if (message.includes("cancelled") || message.includes("aborted")) {
      return true;
    }

    if (message.includes("authentication") || message.includes("api key")) {
      return true;
    }

    if (message.includes("payment") || message.includes("access denied")) {
      return true;
    }

    if (message.includes("not found")) {
      return true;
    }

    return false;
  }

  private combineSignals(signal1: AbortSignal, signal2: AbortSignal): AbortSignal {
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
