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
  AzureAuthMethod,
  NetworkSettings,
  FunctionDefinition,
  LLMMessage,
} from "../types.js";
import { AzureTokenManager } from "./azure/tokenManager.js";

/**
 * Constructor options for AzureClient.
 * Accepts the same shape as AzureSettings, but requires authMethod explicitly.
 */
export interface AzureClientOptions {
  model: string;
  resourceName?: string;
  deploymentName?: string;
  baseUrl?: string;
  apiVersion?: string;
  apiKey?: string;
  authMethod: AzureAuthMethod;
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
}

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

const DEFAULT_API_VERSION = "2024-10-21";
const DEFAULT_MAX_RETRIES = 3;
const MAX_ALLOWED_RETRIES = 5;
const DEFAULT_RETRY_DELAY = 1000;
const DEFAULT_TIMEOUT = 30000;

/** User-friendly error messages referencing Azure */
const FRIENDLY_ERRORS: Record<number, string> = {
  400: "The request was malformed. This often happens when the context is too long. Try /undo to remove recent turns or /new to start fresh.",
  401: "Authentication failed. Please verify your Azure API key or credentials in ~/.autohand/config.json.",
  402: "Payment required. Please check your Azure subscription and billing settings.",
  403: "Access denied. Your credentials may not have permission for this Azure deployment.",
  404: "The Azure deployment was not found. Verify your resourceName and deploymentName in ~/.autohand/config.json.",
  429: "Rate limit exceeded. Please wait a moment and try again, or adjust your Azure deployment capacity.",
  500: "Azure OpenAI encountered an internal error. Please try again later.",
  502: "Azure OpenAI is temporarily unavailable. Please try again in a few moments.",
  503: "Azure OpenAI is currently overloaded. Please try again later.",
  504: "The request timed out. Azure OpenAI may be experiencing high load.",
};

export class AzureClient {
  private readonly tokenManager: AzureTokenManager;
  private readonly options: AzureClientOptions;
  private defaultModel: string;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly timeout: number;

  constructor(options: AzureClientOptions, networkSettings?: NetworkSettings) {
    this.options = options;
    this.tokenManager = new AzureTokenManager();
    this.defaultModel = options.model;

    const configuredRetries =
      networkSettings?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.maxRetries = Math.min(
      Math.max(0, configuredRetries),
      MAX_ALLOWED_RETRIES,
    );
    this.retryDelay = networkSettings?.retryDelay ?? DEFAULT_RETRY_DELAY;
    this.timeout = networkSettings?.timeout ?? DEFAULT_TIMEOUT;
  }

  setDefaultModel(model: string): void {
    this.defaultModel = model;
  }

  /**
   * Build the full Azure OpenAI endpoint URL.
   *
   * If baseUrl is provided:
   *   {baseUrl}/chat/completions?api-version={apiVersion}
   *
   * If resourceName is a full URL (starts with https://):
   *   {origin}/openai/deployments/{deploymentName}/chat/completions?api-version={apiVersion}
   *   Supports all Azure endpoint domains:
   *     - *.openai.azure.com (Azure OpenAI)
   *     - *.services.ai.azure.com (Microsoft Foundry)
   *     - *.cognitiveservices.azure.com (Azure AI Services)
   *
   * Otherwise, from resourceName + deploymentName:
   *   https://{resourceName}.openai.azure.com/openai/deployments/{deploymentName}/chat/completions?api-version={apiVersion}
   */
  private buildEndpointUrl(): string {
    const apiVersion = this.options.apiVersion ?? DEFAULT_API_VERSION;

    if (this.options.baseUrl) {
      return `${this.options.baseUrl}/chat/completions?api-version=${apiVersion}`;
    }

    const { resourceName, deploymentName } = this.options;
    if (!resourceName || !deploymentName) {
      throw new Error(
        "Azure OpenAI requires either baseUrl or both resourceName and deploymentName in ~/.autohand/config.json.",
      );
    }

    // If resourceName is a full URL, extract just the origin (protocol + host)
    if (resourceName.startsWith("http://") || resourceName.startsWith("https://")) {
      try {
        const parsed = new URL(resourceName);
        return `${parsed.origin}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
      } catch {
        // Fall through to default construction if URL parsing fails
      }
    }

    return `https://${resourceName}.openai.azure.com/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const payload: Record<string, unknown> = {
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

      if (request.toolChoice) {
        payload.tool_choice = request.toolChoice;
      }
    }

    // Get auth headers from token manager
    const authHeaders = await this.tokenManager.getAuthHeaders({
      authMethod: this.options.authMethod,
      apiKey: this.options.apiKey,
      tenantId: this.options.tenantId,
      clientId: this.options.clientId,
      clientSecret: this.options.clientSecret,
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...authHeaders,
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
          `Try using /undo to remove recent turns or /new to start fresh.`,
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
          const delay = this.retryDelay * Math.pow(2, attempt);
          await this.sleep(delay);
        }
      }
    }

    throw (
      lastError ??
      new Error(
        "Failed to communicate with Azure OpenAI. Please try again.",
      )
    );
  }

  private async makeRequest(
    payload: object,
    headers: Record<string, string>,
    signal?: AbortSignal,
    preSerializedBody?: string,
  ): Promise<LLMResponse> {
    let response: Response;
    const url = this.buildEndpointUrl();

    try {
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(
        () => timeoutController.abort(),
        this.timeout,
      );

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

      if (err.name === "AbortError" && signal?.aborted) {
        throw new Error("Request cancelled.");
      }

      if (err.name === "AbortError") {
        throw new Error(
          "Request timed out. Azure OpenAI may be experiencing high load.",
        );
      }

      throw new Error(
        "Unable to connect to Azure OpenAI. Please check your internet connection and Azure configuration.",
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
      id: json.id ?? "autohand-azure",
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

    let errorDetail = "";
    try {
      const body = (await response.json()) as any;
      errorDetail =
        body?.error?.message || body?.error || body?.message || "";
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
      return errorDetail
        ? `${friendlyMessage}\n${errorDetail}`
        : friendlyMessage;
    }

    if (status >= 500) {
      const base =
        "Azure OpenAI is temporarily unavailable. Please try again later.";
      return errorDetail ? `${base}\n(${status}: ${errorDetail})` : base;
    }

    if (status >= 400) {
      const base = "The request could not be processed by Azure OpenAI.";
      return errorDetail
        ? `${base} (${status}: ${errorDetail})`
        : `${base} (HTTP ${status}) Please try again or adjust your prompt.`;
    }

    return errorDetail
      ? `An unexpected Azure OpenAI error occurred: ${errorDetail}`
      : "An unexpected Azure OpenAI error occurred. Please try again.";
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

  private combineSignals(
    signal1: AbortSignal,
    signal2: AbortSignal,
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
