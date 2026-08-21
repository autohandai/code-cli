/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  LLMRequest,
  LLMResponse,
  LLMToolCall,
  LLMGatewaySettings,
  NetworkSettings,
  FunctionDefinition,
  LLMMessage,
  NvidiaChatTemplateKwargs,
} from "../types.js";
import { ApiError, classifyApiError } from "./errors.js";
import { normalizeLLMUsage } from "./usage.js";

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
  const toolOutputIds = new Set(
    messages
      .filter((msg) => msg.role === "tool" && msg.tool_call_id)
      .map((msg) => msg.tool_call_id as string)
  );
  const matchedToolCallIds = new Set<string>();

  for (const msg of messages) {
    if (msg.role !== "assistant" || !msg.tool_calls?.length) {
      continue;
    }

    for (const toolCall of msg.tool_calls) {
      if (toolOutputIds.has(toolCall.id)) {
        matchedToolCallIds.add(toolCall.id);
      }
    }
  }

  return messages.flatMap((msg) => {
    if (msg.role === "tool" && (!msg.tool_call_id || !matchedToolCallIds.has(msg.tool_call_id))) {
      const label = msg.name ? `: ${msg.name}` : "";
      return [{
        role: "system",
        content: `[Recovered Tool Result${label}]\n${msg.content}`,
      }];
    }

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
      const matchedToolCalls = msg.tool_calls.filter((toolCall) => matchedToolCallIds.has(toolCall.id));
      if (matchedToolCalls.length > 0) {
        sanitized.tool_calls = matchedToolCalls;
      } else if (!msg.content) {
        return [];
      }
    }

    // Add name for function/tool context (optional, some providers use it)
    if (msg.name) {
      sanitized.name = msg.name;
    }

    return [sanitized];
  });
}

const DEFAULT_BASE_URL = "https://api.llmgateway.io/v1";
const DEFAULT_MAX_RETRIES = 3;
const MAX_ALLOWED_RETRIES = 5;
const DEFAULT_RETRY_DELAY = 1000;
const DEFAULT_TIMEOUT = 30000;

export interface LLMGatewayCompatibleErrorLabels {
  serviceName: string;
  credentialName: string;
  accountName: string;
}

const DEFAULT_ERROR_LABELS: LLMGatewayCompatibleErrorLabels = {
  serviceName: "LLM Gateway",
  credentialName: "LLM Gateway API key",
  accountName: "LLM Gateway account",
};

/** User-friendly error messages that hide raw provider errors */
function buildFriendlyErrors(labels: LLMGatewayCompatibleErrorLabels): Record<string, string> {
  return {
    invalid_request: "The request was malformed and could not be processed.",
    context_overflow: "The conversation is too long for this model. Try /undo to remove recent turns or /new to start fresh.",
    model_not_found: "The requested model was not found. Use /model to select a different one.",
    auth_failed: `Authentication failed. Please verify your ${labels.credentialName} in ~/.autohand/config.json.`,
    payment_required: `Payment required. Please check your ${labels.accountName} balance or billing settings.`,
    access_denied: `Access denied. Your ${labels.credentialName} may not have permission for this model.`,
    rate_limited: "Rate limit exceeded. Please wait a moment and try again, or choose a different model.",
    server_error: `The ${labels.serviceName} service is temporarily unavailable. Please try again later.`,
    timeout: `The request timed out. The ${labels.serviceName} service may be experiencing high load.`,
  };
}

function coerceErrorDetail(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return "";
}

interface StructuredGatewayError {
  type?: string;
  message?: string;
  scope?: string;
  resetAt?: number;
  upgradeUrl?: string;
}

function structuredGatewayError(value: unknown): StructuredGatewayError | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  const rawError = body.error;
  if (!rawError || typeof rawError !== "object" || Array.isArray(rawError)) return undefined;
  const error = rawError as Record<string, unknown>;
  return {
    ...(typeof error.type === "string" ? { type: error.type } : {}),
    ...(typeof error.message === "string" ? { message: error.message } : {}),
    ...(typeof error.scope === "string" ? { scope: error.scope } : {}),
    ...(typeof error.resetAt === "number"
      && Number.isSafeInteger(error.resetAt)
      && error.resetAt > 0
      ? { resetAt: error.resetAt }
      : {}),
    ...(typeof error.upgradeUrl === "string" ? { upgradeUrl: error.upgradeUrl } : {}),
  };
}

const AUTOHAND_QUOTA_SCOPE_LABELS = {
  window_5h: "5-hour request quota",
  window_24h: "24-hour request quota",
  window_week: "weekly request quota",
} as const;

const AUTOHAND_TOKEN_THROUGHPUT_SCOPE_LABELS = {
  input_tpm: "uncached input-token throughput",
  output_tpm: "output-token throughput",
} as const;

type AutohandQuotaScope = keyof typeof AUTOHAND_QUOTA_SCOPE_LABELS;
type AutohandTokenThroughputScope = keyof typeof AUTOHAND_TOKEN_THROUGHPUT_SCOPE_LABELS;
type AutohandRateLimitScope = AutohandQuotaScope | AutohandTokenThroughputScope | "rpm";

class AutohandRateLimitError extends ApiError {
  readonly scope: AutohandRateLimitScope;

  constructor(
    message: string,
    httpStatus: number,
    retryable: boolean,
    scope: AutohandRateLimitScope,
    retryAfterMs?: number,
    rawDetail?: string,
  ) {
    super(message, "rate_limited", httpStatus, retryable, retryAfterMs, rawDetail);
    this.scope = scope;
  }
}

function isAutohandQuotaScope(value: string | undefined): value is AutohandQuotaScope {
  return value === "window_5h" || value === "window_24h" || value === "window_week";
}

function isAutohandTokenThroughputScope(value: string | undefined): value is AutohandTokenThroughputScope {
  return value === "input_tpm" || value === "output_tpm";
}

function formatResetDistance(resetAtMs: number, nowMs: number): string {
  const minutes = Math.max(1, Math.ceil((resetAtMs - nowMs) / 60_000));
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const remainingMinutes = minutes % 60;
  const parts = [
    ...(days > 0 ? [`${days}d`] : []),
    ...(hours > 0 ? [`${hours}h`] : []),
    ...(remainingMinutes > 0 ? [`${remainingMinutes}m`] : []),
  ];
  return parts.join(" ") || "less than a minute";
}

function formatAutohandQuotaReset(resetAtSeconds: number | undefined): string {
  if (resetAtSeconds === undefined) {
    return "Reset time is temporarily unavailable. Run /usage to refresh your quota.";
  }

  const resetAtMs = resetAtSeconds * 1000;
  const resetAt = new Date(resetAtMs);
  if (!Number.isFinite(resetAt.getTime())) {
    return "Reset time is temporarily unavailable. Run /usage to refresh your quota.";
  }

  const configuredTimeZone = resolveConfiguredTimeZone();
  const formatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(configuredTimeZone ? { timeZone: configuredTimeZone } : {}),
  });
  const timeZone = formatter.resolvedOptions().timeZone || "local time";
  return `Resets ${formatter.format(resetAt)} (${timeZone}) · in ${formatResetDistance(resetAtMs, Date.now())}.`;
}

/**
 * Honors a TZ override explicitly: worker threads inherit the process zone and
 * ignore later TZ changes, so relying on the ICU default would render reset
 * times in the wrong zone. Unusable values fall back to the runtime default.
 */
function resolveConfiguredTimeZone(): string | undefined {
  const configured = process.env.TZ?.trim();
  if (!configured) return undefined;
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: configured }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function buildAutohandQuotaMessage(error: StructuredGatewayError): string {
  const scope = error.scope as AutohandQuotaScope;
  const upgradeUrl = trustedAutohandUpgradeUrl(error.upgradeUrl);
  const upgradeMessage = upgradeUrl
    ? `\nUpgrade your Autohand Code plan for more usage: ${upgradeUrl}`
    : "";
  return `Autohand AI ${AUTOHAND_QUOTA_SCOPE_LABELS[scope]} reached.`
    + `\n${error.message ?? "Your current request quota is exhausted."}`
    + `\n${formatAutohandQuotaReset(error.resetAt)}`
    + upgradeMessage;
}

function buildAutohandTokenThroughputMessage(error: StructuredGatewayError): string {
  const scope = error.scope as AutohandTokenThroughputScope;
  const upgradeUrl = trustedAutohandUpgradeUrl(error.upgradeUrl);
  const upgradeMessage = upgradeUrl
    ? `\nUpgrade your Autohand Code plan for more usage: ${upgradeUrl}`
    : "";
  return `Autohand AI ${AUTOHAND_TOKEN_THROUGHPUT_SCOPE_LABELS[scope]} reached.`
    + `\n${error.message ?? "Your token throughput is exhausted for this minute."}`
    + upgradeMessage;
}

function trustedAutohandUpgradeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "console.autohand.ai"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export class LLMGatewayClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private defaultModel: string;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly timeout: number;
  private readonly errorLabels: LLMGatewayCompatibleErrorLabels;
  private readonly reasoningEffort?: LLMGatewaySettings["reasoningEffort"];

  constructor(
    settings: LLMGatewaySettings,
    networkSettings?: NetworkSettings,
    errorLabels: LLMGatewayCompatibleErrorLabels = DEFAULT_ERROR_LABELS,
  ) {
    this.apiKey = settings.apiKey ?? "";
    this.baseUrl = settings.baseUrl ?? DEFAULT_BASE_URL;
    this.defaultModel = settings.model;
    this.reasoningEffort = settings.reasoningEffort;
    this.errorLabels = errorLabels;

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

      // Set tool_choice based on request
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

        // Don't retry if user cancelled or if it's a non-retryable error
        if (this.isNonRetryableError(error as Error)) {
          throw error;
        }

        // If we have more attempts left, wait before retrying
        if (attempt < this.maxRetries) {
          const delay = lastError instanceof AutohandRateLimitError
            && lastError.scope === "rpm"
            && lastError.retryAfterMs !== undefined
            ? lastError.retryAfterMs
            : this.retryDelay * Math.pow(2, attempt);
          await this.sleep(delay, request.signal);
        }
      }
    }

    // All retries exhausted
    throw (
      lastError ??
      new Error("Failed to communicate with LLM Gateway. Please try again.")
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
    if (this.reasoningEffort) {
      payload.reasoning_effort = this.reasoningEffort;
    }
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
        throw new ApiError("Request cancelled.", "cancelled", 0, false);
      }

      // Timeout
      if (err.name === "AbortError") {
        throw new ApiError(
          `Request timed out. The ${this.errorLabels.serviceName} service may be experiencing high load.`,
          "timeout",
          0,
          true,
        );
      }

      // Network error - friendly message
      throw new ApiError(
        `Unable to connect to ${this.errorLabels.serviceName}. Please check your internet connection.`,
        "network_error",
        0,
        true,
      );
    }

    if (!response.ok) {
      throw await this.buildFriendlyError(response);
    }

    // Handle streaming responses
    if (isStreaming) {
      return this.handleStreamingResponse(response);
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

    const usage = normalizeLLMUsage(json?.usage);

    return {
      id: json.id ?? "llmgateway-response",
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
          // Handle SSE format: "data: {...}"
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

              // Extract regular content
              if (delta.content) {
                fullContent += delta.content;
              }

              // Track finish reason
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
      id: lastChunk?.id ?? `llmgateway-stream-${Date.now()}`,
      created: lastChunk?.created ?? Math.floor(Date.now() / 1000),
      content: finalContent,
      finishReason: finishReason as LLMResponse["finishReason"],
      raw: { content: fullContent, reasoning: fullReasoning, chunks: lastChunk },
    };
  }

  private async buildFriendlyError(response: Response): Promise<ApiError> {
    const status = response.status;

    // Try to get the actual error message from the response
    let errorDetail = "";
    let structuredError: StructuredGatewayError | undefined;
    try {
      const body = await response.json() as unknown;
      structuredError = structuredGatewayError(body);
      const bodyRecord = body && typeof body === "object" && !Array.isArray(body)
        ? body as Record<string, unknown>
        : undefined;
      errorDetail = structuredError?.message
        ?? (coerceErrorDetail(bodyRecord?.error) || coerceErrorDetail(bodyRecord?.message));
    } catch {
      // Fallback to raw text if JSON parsing fails
      try {
        errorDetail = await response.text();
      } catch {
        // Ignore
      }
    }

    if (this.errorLabels.serviceName === "Autohand AI" && structuredError?.type === "model_not_available") {
      const upgradeUrl = trustedAutohandUpgradeUrl(structuredError.upgradeUrl);
      const message = `Access denied. ${structuredError.message ?? "This model is not available on your current plan."}`
        + (upgradeUrl ? `\nPlease upgrade your plan: ${upgradeUrl}` : "");
      return new ApiError(message, "access_denied", status, false, undefined, errorDetail);
    }

    if (this.errorLabels.serviceName === "Autohand AI"
      && structuredError?.type === "rate_limited"
      && isAutohandQuotaScope(structuredError.scope)) {
      return new AutohandRateLimitError(
        buildAutohandQuotaMessage(structuredError),
        status,
        false,
        structuredError.scope,
        undefined,
        errorDetail,
      );
    }

    if (this.errorLabels.serviceName === "Autohand AI"
      && structuredError?.type === "rate_limited"
      && isAutohandTokenThroughputScope(structuredError.scope)) {
      return new AutohandRateLimitError(
        buildAutohandTokenThroughputMessage(structuredError),
        status,
        false,
        structuredError.scope,
        undefined,
        errorDetail,
      );
    }

    if (this.errorLabels.serviceName === "Autohand AI"
      && structuredError?.type === "rate_limited"
      && structuredError.scope === "rpm") {
      const classified = classifyApiError(status, errorDetail, response.headers);
      const friendlyMessage = buildFriendlyErrors(this.errorLabels).rate_limited;
      return new AutohandRateLimitError(
        `${friendlyMessage}\n${structuredError.message ?? errorDetail}`,
        status,
        true,
        "rpm",
        classified.retryAfterMs,
        errorDetail,
      );
    }

    const classified = classifyApiError(status, errorDetail, response.headers);
    const friendlyMessage = buildFriendlyErrors(this.errorLabels)[classified.code];
    if (friendlyMessage) {
      const upgradeUrl = this.errorLabels.serviceName === "Autohand AI"
        ? trustedAutohandUpgradeUrl(structuredError?.upgradeUrl)
        : undefined;
      const upgradeMessage = classified.code === "rate_limited" && upgradeUrl
        ? `\nUpgrade your Autohand Code plan for more usage: ${upgradeUrl}`
        : "";
      const retryable = this.errorLabels.serviceName === "Autohand AI"
        && classified.code === "rate_limited"
        ? false
        : classified.retryable;
      return new ApiError(
        `${errorDetail ? `${friendlyMessage}\n${errorDetail}` : friendlyMessage}${upgradeMessage}`,
        classified.code,
        classified.httpStatus,
        retryable,
        classified.retryAfterMs,
        classified.rawDetail,
      );
    }

    if (status >= 500) {
      return classifyApiError(status, errorDetail, response.headers);
    }

    if (status >= 400) {
      return classifyApiError(status, errorDetail, response.headers);
    }

    return classifyApiError(status, errorDetail, response.headers);
  }

  private isNonRetryableError(error: Error): boolean {
    if (error instanceof ApiError) {
      return !error.retryable;
    }

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

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new ApiError("Request cancelled.", "cancelled", 0, false));
    }

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timeoutId);
        reject(new ApiError("Request cancelled.", "cancelled", 0, false));
      };
      const timeoutId = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}
