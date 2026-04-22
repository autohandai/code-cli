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
  VertexAISettings,
  NetworkSettings,
  FunctionDefinition,
  LLMMessage,
} from "../types.js";
import type { LLMProvider } from "./LLMProvider.js";
import { getGcloudAccessToken, clearGcloudTokenCache } from "../utils/gcloudAuth.js";

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

const DEFAULT_ENDPOINT = "aiplatform.googleapis.com";
const DEFAULT_REGION = "global";
const DEFAULT_MAX_RETRIES = 3;
const MAX_ALLOWED_RETRIES = 5;
const DEFAULT_RETRY_DELAY = 1000;
const DEFAULT_TIMEOUT = 30000;

/** Anthropic models that use the native Vertex AI endpoint */
const ANTHROPIC_MODELS = [
  'claude-3-opus',
  'claude-3-sonnet',
  'claude-3-haiku',
  'claude-3-5-sonnet',
  'claude-3-5-haiku',
  'claude-3.5-sonnet',
  'claude-3.5-haiku',
  'claude-4',
  'claude-sonnet-4',
  'claude-opus-4',
  'claude-opus-4-7',
];

/**
 * Check if a model is an Anthropic model
 */
function isAnthropicModel(model: string): boolean {
  const lowerModel = model.toLowerCase();
  return ANTHROPIC_MODELS.some(m => lowerModel.includes(m.toLowerCase()));
}

/**
 * Extract the model ID for Vertex AI native Anthropic endpoint
 * Strips 'anthropic/' prefix if present
 */
function extractAnthropicModelId(model: string): string {
  const lowerModel = model.toLowerCase();
  // Strip 'anthropic/' prefix if present
  if (lowerModel.startsWith('anthropic/')) {
    return model.substring('anthropic/'.length);
  }
  return model;
}

/** User-friendly error messages that hide raw provider errors */
const FRIENDLY_ERRORS: Record<number, string> = {
  400: "The request was malformed. This often happens when the context is too long. Try /undo to remove recent turns or /new to start fresh.",
  401: "Authentication failed. Please verify your Google Cloud auth token. Run 'gcloud auth print-access-token' to get a fresh token.",
  403: "Access denied. Your auth token may not have permission for this model or project.",
  404: "The requested model was not found. Use /model to select a different one.",
  429: "Rate limit exceeded. Please wait a moment and try again, or choose a different model.",
  500: "The Vertex AI service encountered an internal error. Please try again later.",
  502: "The Vertex AI service is temporarily unavailable. Please try again in a few moments.",
  503: "The Vertex AI service is currently overloaded. Please try again later.",
  504: "The request timed out. The service may be experiencing high load.",
};

export class VertexAIProvider implements LLMProvider {
  private authToken: string; // Changed from readonly to allow refresh
  private readonly endpoint: string;
  private readonly region: string;
  private readonly projectId: string;
  private readonly baseUrl: string;
  private defaultModel: string;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly timeout: number;
  private readonly useGcloudRefresh: boolean; // Auto-refresh via gcloud CLI

  constructor(settings: VertexAISettings, networkSettings?: NetworkSettings) {
    this.authToken = settings.authToken;
    this.endpoint = settings.endpoint ?? DEFAULT_ENDPOINT;
    this.region = settings.region ?? DEFAULT_REGION;
    this.projectId = settings.projectId;
    this.defaultModel = settings.model;
    
    // Enable gcloud auto-refresh if the token looks like a gcloud token
    // (gcloud tokens start with "ya29." and are very long)
    this.useGcloudRefresh = this.authToken.startsWith('ya29.') && this.authToken.length > 100;

    // Build the base URL for Vertex AI OpenAI-compatible endpoint
    this.baseUrl = `https://${this.endpoint}/v1/projects/${this.projectId}/locations/${this.region}/endpoints/openapi`;

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

  getName(): string {
    return "vertexai";
  }

  setModel(model: string): void {
    this.defaultModel = model;
  }

  async listModels(): Promise<string[]> {
    // Vertex AI doesn't have a standard models endpoint
    // Return common Vertex AI models
    return [
      "zai-org/glm-5-maas",
      "google/gemini-1.5-pro",
      "google/gemini-1.5-flash",
      "google/gemini-1.0-pro",
      "anthropic/claude-3-5-sonnet",
      "anthropic/claude-3-opus",
      "anthropic/claude-3-haiku",
      "anthropic/claude-opus-4-7",
    ];
  }

  async isAvailable(): Promise<boolean> {
    try {
      const token = await this.getValidToken();
      const response = await fetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get a valid auth token, refreshing from gcloud if needed
   */
  private async getValidToken(): Promise<string> {
    // If gcloud auto-refresh is enabled, always get a fresh token
    if (this.useGcloudRefresh) {
      const result = await getGcloudAccessToken();
      if (result.token) {
        this.authToken = result.token;
        return this.authToken;
      }
      // Fall back to existing token if gcloud fails
    }
    return this.authToken;
  }

  /**
   * Refresh the token after an auth error
   */
  private async refreshToken(): Promise<boolean> {
    if (!this.useGcloudRefresh) {
      return false;
    }

    // Clear the cache and get a fresh token
    clearGcloudTokenCache();
    const result = await getGcloudAccessToken();
    
    if (result.token) {
      this.authToken = result.token;
      return true;
    }
    
    return false;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model ?? this.defaultModel;
    const isAnthropic = isAnthropicModel(model);

    // Build payload based on model type
    let payload: Record<string, unknown>;
    let url: string;

    if (isAnthropic) {
      // Native Anthropic endpoint on Vertex AI
      const modelId = extractAnthropicModelId(model);
      url = `https://${this.endpoint}/v1/projects/${this.projectId}/locations/${this.region}/publishers/anthropic/models/${modelId}:streamRawPredict`;

      payload = {
        anthropic_version: "vertex-2023-10-16",
        messages: sanitizeMessages(request.messages),
        max_tokens: request.maxTokens ?? 16000,
        stream: request.stream ?? false,
      };

      // Add optional parameters
      if (request.temperature !== undefined) {
        payload.temperature = request.temperature;
      }

      // Add function calling support if tools are provided
      if (request.tools && request.tools.length > 0) {
        payload.tools = request.tools.map((tool: FunctionDefinition) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters ?? { type: "object", properties: {} },
        }));
      }
    } else {
      // OpenAI-compatible endpoint
      payload = {
        model: model,
        messages: sanitizeMessages(request.messages),
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 16000,
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

      url = `${this.baseUrl}/chat/completions`;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await this.getValidToken()}`,
    };

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
          url,
          payload,
          headers,
          request.signal,
          payloadJson,
          isAnthropic
        );
        return response;
      } catch (error) {
        lastError = error as Error;

        // Check if this is an auth error and we can refresh the token
        if (this.isAuthError(error as Error) && await this.refreshToken()) {
          // Update headers with new token and retry immediately
          headers.Authorization = `Bearer ${this.authToken}`;
          continue;
        }

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
      new Error("Failed to communicate with Vertex AI. Please try again.")
    );
  }

  private async makeRequest(
    url: string,
    payload: object,
    headers: Record<string, string>,
    signal?: AbortSignal,
    preSerializedBody?: string,
    isAnthropic: boolean = false
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
        response = await fetch(url, {
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
          "Request timed out. The Vertex AI service may be experiencing high load."
        );
      }

      // Network error - friendly message
      throw new Error(
        "Unable to connect to Vertex AI. Please check your internet connection and auth token."
      );
    }

    if (!response.ok) {
      throw new Error(await this.buildFriendlyError(response));
    }

    const json = (await response.json()) as any;

    // Handle Anthropic response format
    if (isAnthropic) {
      return this.parseAnthropicResponse(json);
    }

    // OpenAI-compatible response format
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
      id: json.id ?? "vertexai-response",
      created: json.created ?? Date.now(),
      content: text,
      toolCalls,
      finishReason: finishReason as LLMResponse["finishReason"],
      usage,
      raw: json,
    };
  }

  /**
   * Parse Anthropic API response format
   */
  private parseAnthropicResponse(json: any): LLMResponse {
    // Anthropic response format:
    // { id: "msg_xxx", type: "message", role: "assistant", content: [{ type: "text", text: "..." }], ... }
    const contentBlocks = json?.content ?? [];
    const textBlock = contentBlocks.find((b: any) => b.type === "text");
    const text = textBlock?.text ?? "";

    // Parse tool calls if present (Anthropic format)
    let toolCalls: LLMToolCall[] | undefined;
    const toolUseBlocks = contentBlocks.filter((b: any) => b.type === "tool_use");
    if (toolUseBlocks.length > 0) {
      toolCalls = toolUseBlocks.map((block: any) => ({
        id: block.id,
        type: "function" as const,
        function: {
          name: block.name ?? "",
          arguments: JSON.stringify(block.input ?? {}),
        },
      }));
    }

    // Parse token usage if present
    let usage: LLMUsage | undefined;
    if (json?.usage) {
      usage = {
        promptTokens: json.usage.input_tokens ?? 0,
        completionTokens: json.usage.output_tokens ?? 0,
        totalTokens: (json.usage.input_tokens ?? 0) + (json.usage.output_tokens ?? 0),
      };
    }

    // Map Anthropic stop_reason to finish_reason
    const stopReason = json?.stop_reason;
    let finishReason: LLMResponse["finishReason"];
    if (stopReason === "end_turn" || stopReason === "stop_sequence") {
      finishReason = "stop";
    } else if (stopReason === "tool_use") {
      finishReason = "tool_calls";
    } else if (stopReason === "max_tokens") {
      finishReason = "length";
    }

    return {
      id: json.id ?? "vertexai-anthropic-response",
      created: Date.now(),
      content: text,
      toolCalls,
      finishReason,
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
        "The Vertex AI service is temporarily unavailable. Please try again later.";
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

    // Don't retry on auth errors
    if (message.includes("authentication") || message.includes("auth token")) {
      return true;
    }

    // Don't retry on payment/access errors
    if (message.includes("payment") || message.includes("access denied")) {
      return true;
    }

    // Don't retry model not found
    if (message.includes("not found")) {
      return true;
    }

    return false;
  }

  /**
   * Check if error is an authentication error that can be fixed by refreshing the token
   */
  private isAuthError(error: Error): boolean {
    const message = error.message.toLowerCase();
    
    // Check for 401 Unauthorized or auth-related errors
    if (
      message.includes('401') ||
      message.includes('unauthorized') ||
      message.includes('authentication') ||
      message.includes('auth token') ||
      message.includes('invalid token') ||
      message.includes('token expired')
    ) {
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
