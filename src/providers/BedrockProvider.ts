/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
} from "@aws-sdk/client-bedrock-runtime";
import {
  BedrockClient,
  ListFoundationModelsCommand,
} from "@aws-sdk/client-bedrock";
import { fromIni } from "@aws-sdk/credential-providers";
import type { LLMProvider } from "./LLMProvider.js";
import {
  ApiError,
  classifyApiError,
  type ApiErrorCode,
} from "./errors.js";
import { normalizeLLMUsage } from "./usage.js";
import type {
  BedrockApiMode,
  BedrockAuthMode,
  BedrockSettings,
  FunctionDefinition,
  LLMMessage,
  LLMRequest,
  LLMResponse,
  LLMToolCall,
} from "../types.js";

export const BEDROCK_DEFAULT_REGION = "us-east-1";
export const BEDROCK_DEFAULT_MODEL =
  "anthropic.claude-3-5-sonnet-20241022-v2:0";
export const BEDROCK_MODELS = [
  BEDROCK_DEFAULT_MODEL,
  "anthropic.claude-3-7-sonnet-20250219-v1:0",
  "anthropic.claude-sonnet-4-20250514-v1:0",
  "amazon.nova-pro-v1:0",
  "amazon.nova-lite-v1:0",
  "meta.llama3-1-70b-instruct-v1:0",
  "openai.gpt-oss-120b-1:0",
] as const;

type ConverseRole = "user" | "assistant";
type ConverseContentBlock =
  | { text: string }
  | {
      toolUse: {
        toolUseId: string;
        name: string;
        input: unknown;
      };
    }
  | {
      toolResult: {
        toolUseId: string;
        content: Array<{ text: string }>;
        status?: "success" | "error";
      };
    };

interface ConverseMessage {
  role: ConverseRole;
  content: ConverseContentBlock[];
}

interface ConverseResponse {
  output?: {
    message?: {
      role?: string;
      content?: ConverseContentBlock[];
    };
  };
  stopReason?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

interface BedrockAwsError extends Error {
  "$metadata"?: {
    httpStatusCode?: number;
  };
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIChatResponse {
  id?: string;
  created?: number;
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason?: string;
  }>;
  usage?: unknown;
}

interface OpenAIResponsesFunctionCall {
  type: "function_call";
  id?: string;
  call_id?: string;
  name: string;
  arguments: string;
}

interface OpenAIResponsesResponse {
  id?: string;
  created_at?: number;
  output_text?: string;
  output?: Array<OpenAIResponsesFunctionCall | { type?: string; [key: string]: unknown }>;
  usage?: unknown;
}

export function resolveBedrockRegion(region?: string): string {
  return (
    region?.trim() ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    BEDROCK_DEFAULT_REGION
  );
}

export function getBedrockRuntimeEndpoint(region: string): string {
  return `https://bedrock-runtime.${region}.amazonaws.com`;
}

export function getBedrockOpenAIEndpoint(
  _mode: Extract<BedrockApiMode, "openai-chat" | "openai-responses">,
  region: string,
): string {
  return `${getBedrockRuntimeEndpoint(region)}/openai/v1`;
}

export function resolveBedrockEndpoint(
  mode: BedrockApiMode,
  region: string,
  configuredEndpoint?: string,
): string {
  if (configuredEndpoint?.trim()) {
    return configuredEndpoint.replace(/\/+$/, "");
  }
  if (mode === "converse") {
    return getBedrockRuntimeEndpoint(region);
  }
  return getBedrockOpenAIEndpoint(mode, region);
}

export function resolveBedrockAuthMode(
  mode: BedrockApiMode,
  configured?: BedrockAuthMode,
): BedrockAuthMode {
  if (configured) return configured;
  return mode === "converse" ? "aws-credentials" : "bedrock-api-key";
}

function parseToolArguments(argumentsJson: string): unknown {
  try {
    return JSON.parse(argumentsJson);
  } catch {
    return {};
  }
}

function toTextContent(content: string): ConverseContentBlock[] {
  return content ? [{ text: content }] : [];
}

function toToolUseBlocks(toolCalls: LLMToolCall[]): ConverseContentBlock[] {
  return toolCalls.map((toolCall) => ({
    toolUse: {
      toolUseId: toolCall.id,
      name: toolCall.function.name,
      input: parseToolArguments(toolCall.function.arguments),
    },
  }));
}

function toConverseMessage(message: LLMMessage): ConverseMessage | null {
  if (message.role === "system") {
    return null;
  }

  if (message.role === "tool") {
    return {
      role: "user",
      content: [
        {
          toolResult: {
            toolUseId: message.tool_call_id ?? message.name ?? "tool_result",
            content: [{ text: message.content }],
          },
        },
      ],
    };
  }

  if (message.role === "assistant") {
    const content: ConverseContentBlock[] = [
      ...toTextContent(message.content),
      ...(message.tool_calls?.length ? toToolUseBlocks(message.tool_calls) : []),
    ];
    return {
      role: "assistant",
      content: content.length > 0 ? content : [{ text: "" }],
    };
  }

  return {
    role: "user",
    content: toTextContent(message.content),
  };
}

function toOpenAIMessage(message: LLMMessage): Record<string, unknown> {
  const mapped: Record<string, unknown> = {
    role: message.role,
    content: message.role === "assistant" && message.tool_calls?.length
      ? message.content || null
      : message.content,
  };
  if (message.name) mapped.name = message.name;
  if (message.role === "tool" && message.tool_call_id) {
    mapped.tool_call_id = message.tool_call_id;
  }
  if (message.role === "assistant" && message.tool_calls?.length) {
    mapped.tool_calls = message.tool_calls;
  }
  return mapped;
}

function toResponsesInputItem(message: LLMMessage): Record<string, unknown>[] {
  if (message.role === "tool" && message.tool_call_id) {
    return [
      {
        type: "function_call_output",
        call_id: message.tool_call_id,
        output: message.content,
      },
    ];
  }

  if (message.role === "assistant" && message.tool_calls?.length) {
    return message.tool_calls.map((toolCall) => ({
      type: "function_call",
      call_id: toolCall.id,
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    }));
  }

  if (message.role === "system") {
    return [];
  }

  const contentType = message.role === "assistant" ? "output_text" : "input_text";
  return [
    {
      role: message.role,
      content: [{ type: contentType, text: message.content }],
    },
  ];
}

function toOpenAITools(tools: FunctionDefinition[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? { type: "object", properties: {} },
    },
  }));
}

function toResponsesTools(tools: FunctionDefinition[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters ?? { type: "object", properties: {} },
  }));
}

function toConverseTools(tools: FunctionDefinition[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    toolSpec: {
      name: tool.name,
      description: tool.description,
      inputSchema: {
        json: tool.parameters ?? { type: "object", properties: {} },
      },
    },
  }));
}

function normalizeStopReason(stopReason?: string): LLMResponse["finishReason"] {
  if (stopReason === "tool_use" || stopReason === "tool_calls") {
    return "tool_calls";
  }
  if (stopReason === "max_tokens" || stopReason === "length") {
    return "length";
  }
  if (stopReason === "content_filter") {
    return "content_filter";
  }
  return "stop";
}

function toolCallsFromConverseBlocks(blocks: ConverseContentBlock[]): LLMToolCall[] {
  return blocks
    .filter((block): block is Extract<ConverseContentBlock, { toolUse: unknown }> =>
      "toolUse" in block && Boolean(block.toolUse),
    )
    .map((block) => ({
      id: block.toolUse.toolUseId,
      type: "function",
      function: {
        name: block.toolUse.name,
        arguments: JSON.stringify(block.toolUse.input ?? {}),
      },
    }));
}

function textFromConverseBlocks(blocks: ConverseContentBlock[]): string {
  return blocks
    .filter((block): block is { text: string } => "text" in block)
    .map((block) => block.text)
    .join("");
}

function isBedrockAwsError(error: unknown): error is BedrockAwsError {
  return error instanceof Error;
}

function classifyBedrockError(error: unknown): ApiError {
  if (!isBedrockAwsError(error)) {
    return new ApiError(String(error), "unknown", 0, true);
  }

  if (error.name === "AbortError") {
    return new ApiError("Request cancelled.", "cancelled", 0, false);
  }

  const status = error["$metadata"]?.httpStatusCode ?? 0;
  const message = error.message || error.name;
  const lower = `${error.name} ${message}`.toLowerCase();
  let code: ApiErrorCode | undefined;

  if (
    lower.includes("credential") ||
    lower.includes("signature") ||
    lower.includes("unrecognizedclient") ||
    lower.includes("expiredtoken")
  ) {
    code = "auth_failed";
  } else if (
    lower.includes("accessdenied") ||
    lower.includes("access denied") ||
    lower.includes("not authorized") ||
    lower.includes("model access")
  ) {
    code = "access_denied";
  } else if (
    lower.includes("resourcenotfound") ||
    lower.includes("model not found") ||
    lower.includes("not found") ||
    lower.includes("not available")
  ) {
    code = "model_not_found";
  } else if (
    lower.includes("throttl") ||
    lower.includes("quota") ||
    lower.includes("toomanyrequests")
  ) {
    code = "rate_limited";
  } else if (
    lower.includes("validation") ||
    lower.includes("unsupported") ||
    lower.includes("api mode")
  ) {
    code = "invalid_request";
  } else if (
    lower.includes("network") ||
    lower.includes("enotfound") ||
    lower.includes("econn") ||
    lower.includes("private endpoint")
  ) {
    code = "network_error";
  }

  if (code) {
    const friendly: Record<ApiErrorCode, string> = {
      auth_failed:
        "AWS Bedrock credentials were not found or were rejected. Configure AWS credentials, AWS_PROFILE, instance metadata, or choose Bedrock API key auth.",
      access_denied:
        "AWS Bedrock denied access. Enable model access in the AWS console and verify IAM permissions for this model.",
      model_not_found:
        "The selected Bedrock model is not available in this region. Check the model ID, inference profile, ARN, and region.",
      invalid_request:
        "Bedrock rejected the request. The selected model may not support this API mode or native tool use.",
      rate_limited:
        "AWS Bedrock throttled the request or quota was exceeded. Wait and retry, or request a quota increase.",
      network_error:
        "Unable to reach the AWS Bedrock endpoint. Check region, endpoint, private networking, and proxy settings.",
      timeout:
        "The AWS Bedrock request timed out.",
      cancelled: "Request cancelled.",
      context_overflow:
        "The conversation is too long for this Bedrock model.",
      payment_required:
        "AWS Bedrock billing or account setup is required.",
      server_error:
        "AWS Bedrock encountered a service error. Please try again later.",
      unknown:
        "AWS Bedrock returned an unexpected error.",
    };
    return new ApiError(`${friendly[code]}\n${message}`, code, status, code === "rate_limited" || code === "server_error", undefined, message);
  }

  return classifyApiError(status, message);
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

export class BedrockProvider implements LLMProvider {
  private readonly apiMode: BedrockApiMode;
  private readonly authMode: BedrockAuthMode;
  private readonly region: string;
  private readonly endpoint: string;
  private readonly profile?: string;
  private readonly apiKey?: string;
  private model: string;
  private runtimeClient?: BedrockRuntimeClient;
  private modelClient?: BedrockClient;

  constructor(config: BedrockSettings) {
    this.apiMode = config.apiMode ?? "converse";
    this.authMode = resolveBedrockAuthMode(this.apiMode, config.authMode);
    this.region = resolveBedrockRegion(config.region);
    this.endpoint = resolveBedrockEndpoint(this.apiMode, this.region, config.endpoint);
    this.profile = config.profile;
    this.apiKey = config.apiKey;
    this.model = config.model || BEDROCK_DEFAULT_MODEL;
  }

  getName(): string {
    return "bedrock";
  }

  setModel(model: string): void {
    this.model = model;
  }

  getCapabilities(): { nativeToolCalling: boolean } {
    return { nativeToolCalling: true };
  }

  async listModels(): Promise<string[]> {
    if (this.apiMode !== "converse") {
      return [...BEDROCK_MODELS];
    }

    try {
      const response = await this.getModelClient().send(
        new ListFoundationModelsCommand({}),
      );
      const summaries = response.modelSummaries ?? [];
      const modelIds = summaries
        .map((summary) => summary.modelId)
        .filter((modelId): modelId is string => Boolean(modelId));
      return modelIds.length > 0 ? modelIds : [...BEDROCK_MODELS];
    } catch {
      return [...BEDROCK_MODELS];
    }
  }

  async isAvailable(): Promise<boolean> {
    if (this.authMode === "bedrock-api-key") {
      return Boolean(this.apiKey);
    }
    try {
      await this.listModels();
      return true;
    } catch {
      return false;
    }
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    if (!this.region) {
      throw new ApiError(
        "AWS Bedrock region is missing. Set bedrock.region, AWS_REGION, or AWS_DEFAULT_REGION.",
        "invalid_request",
        0,
        false,
      );
    }

    if (this.apiMode === "converse") {
      return this.completeWithConverse(request);
    }
    return this.completeWithOpenAICompatible(request);
  }

  private getCredentials(): ReturnType<typeof fromIni> | undefined {
    if (this.profile) {
      return fromIni({ profile: this.profile });
    }
    return undefined;
  }

  private getRuntimeClient(): BedrockRuntimeClient {
    if (!this.runtimeClient) {
      this.runtimeClient = new BedrockRuntimeClient({
        region: this.region,
        endpoint: this.endpoint,
        credentials: this.getCredentials(),
      });
    }
    return this.runtimeClient;
  }

  private getModelClient(): BedrockClient {
    if (!this.modelClient) {
      this.modelClient = new BedrockClient({
        region: this.region,
        credentials: this.getCredentials(),
      });
    }
    return this.modelClient;
  }

  private async completeWithConverse(request: LLMRequest): Promise<LLMResponse> {
    if (this.authMode === "bedrock-api-key") {
      throw new ApiError(
        "Bedrock Converse uses AWS credential-chain auth. Choose apiMode openai-chat/openai-responses to use Bedrock API keys.",
        "invalid_request",
        0,
        false,
      );
    }

    const contentMessages = request.messages
      .map(toConverseMessage)
      .filter((message): message is ConverseMessage => message !== null);
    const system = request.messages
      .filter((message) => message.role === "system" && message.content)
      .map((message) => ({ text: message.content }));
    const body: ConverseCommandInput = {
      modelId: request.model ?? this.model,
      messages: contentMessages as unknown as ConverseCommandInput["messages"],
      inferenceConfig: {
        ...(request.maxTokens !== undefined && { maxTokens: request.maxTokens }),
        ...(request.temperature !== undefined && { temperature: request.temperature }),
      },
    };

    if (system.length > 0) {
      body.system = system;
    }

    if (request.tools?.length) {
      body.toolConfig = {
        tools: toConverseTools(request.tools),
        ...(request.toolChoice && request.toolChoice !== "auto"
          ? { toolChoice: this.toConverseToolChoice(request.toolChoice) }
          : {}),
      } as unknown as ConverseCommandInput["toolConfig"];
    }

    try {
      const data = await this.getRuntimeClient().send(
        new ConverseCommand(body),
      ) as ConverseResponse;
      const blocks = data.output?.message?.content ?? [];
      const toolCalls = toolCallsFromConverseBlocks(blocks);
      return {
        id: `bedrock-${Date.now()}`,
        created: Math.floor(Date.now() / 1000),
        content: textFromConverseBlocks(blocks),
        ...(toolCalls.length > 0 && { toolCalls }),
        finishReason: normalizeStopReason(data.stopReason),
        usage: normalizeLLMUsage(data.usage),
        raw: data,
      };
    } catch (error) {
      throw classifyBedrockError(error);
    }
  }

  private toConverseToolChoice(toolChoice: LLMRequest["toolChoice"]): Record<string, unknown> | undefined {
    if (!toolChoice || toolChoice === "auto") return undefined;
    if (toolChoice === "none") return { auto: {} };
    if (toolChoice === "required") return { any: {} };
    return { tool: { name: toolChoice.function.name } };
  }

  private async completeWithOpenAICompatible(request: LLMRequest): Promise<LLMResponse> {
    if (this.authMode !== "bedrock-api-key") {
      throw new ApiError(
        "Bedrock OpenAI-compatible modes require authMode bedrock-api-key and bedrock.apiKey.",
        "auth_failed",
        0,
        false,
      );
    }
    if (!this.apiKey) {
      throw new ApiError(
        "Bedrock API key is missing. Set bedrock.apiKey for OpenAI-compatible Bedrock modes.",
        "auth_failed",
        0,
        false,
      );
    }

    if (this.apiMode === "openai-chat") {
      return this.completeWithOpenAIChat(request);
    }
    return this.completeWithOpenAIResponses(request);
  }

  private async completeWithOpenAIChat(request: LLMRequest): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: request.model ?? this.model,
      messages: request.messages.map(toOpenAIMessage),
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      ...(request.maxTokens !== undefined && { max_tokens: request.maxTokens }),
    };

    if (request.tools?.length) {
      body.tools = toOpenAITools(request.tools);
      if (request.toolChoice) body.tool_choice = request.toolChoice;
    }

    const data = await this.fetchJson<OpenAIChatResponse>("/chat/completions", body, request.signal);
    const choice = data.choices?.[0];
    if (!choice?.message) {
      throw new ApiError(
        "Malformed Bedrock OpenAI chat response: missing choice message.",
        "invalid_request",
        200,
        false,
        undefined,
        JSON.stringify(data),
      );
    }

    return {
      id: data.id ?? `bedrock-chat-${Date.now()}`,
      created: data.created ?? Math.floor(Date.now() / 1000),
      content: choice.message.content ?? "",
      ...(choice.message.tool_calls?.length && { toolCalls: choice.message.tool_calls }),
      finishReason: normalizeStopReason(choice.finish_reason),
      usage: normalizeLLMUsage(data.usage),
      raw: data,
    };
  }

  private async completeWithOpenAIResponses(request: LLMRequest): Promise<LLMResponse> {
    const instructions = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const body: Record<string, unknown> = {
      model: request.model ?? this.model,
      input: request.messages.flatMap(toResponsesInputItem),
      ...(instructions && { instructions }),
      ...(request.maxTokens !== undefined && { max_output_tokens: request.maxTokens }),
    };

    if (request.tools?.length) {
      body.tools = toResponsesTools(request.tools);
      if (request.toolChoice) body.tool_choice = request.toolChoice;
    }

    const data = await this.fetchJson<OpenAIResponsesResponse>("/responses", body, request.signal);
    const functionCalls = (data.output ?? [])
      .filter((item): item is OpenAIResponsesFunctionCall =>
        item.type === "function_call" &&
        typeof item.name === "string" &&
        typeof item.arguments === "string",
      )
      .map((item) => ({
        id: item.call_id ?? item.id ?? `call_${Date.now()}`,
        type: "function" as const,
        function: {
          name: item.name,
          arguments: item.arguments,
        },
      }));

    return {
      id: data.id ?? `bedrock-responses-${Date.now()}`,
      created: data.created_at ?? Math.floor(Date.now() / 1000),
      content: data.output_text ?? "",
      ...(functionCalls.length > 0 && { toolCalls: functionCalls }),
      finishReason: functionCalls.length > 0 ? "tool_calls" : "stop",
      usage: normalizeLLMUsage(data.usage),
      raw: data,
    };
  }

  private async fetchJson<T>(
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.endpoint}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      const err = error as Error;
      if (err.name === "AbortError" && signal?.aborted) {
        throw new ApiError("Request cancelled.", "cancelled", 0, false);
      }
      if (err.name === "AbortError") {
        throw new ApiError("The Bedrock request timed out.", "timeout", 0, true);
      }
      throw new ApiError(
        "Unable to connect to the Bedrock OpenAI-compatible endpoint. Check region, endpoint, private networking, and proxy settings.",
        "network_error",
        0,
        true,
        undefined,
        err.message,
      );
    }

    if (!response.ok) {
      const errorBody = await readErrorBody(response);
      const classified = classifyApiError(response.status, errorBody, response.headers);
      throw new ApiError(
        `AWS Bedrock request failed.\n${classified.message}`,
        classified.code,
        classified.httpStatus,
        classified.retryable,
        classified.retryAfterMs,
        classified.rawDetail,
      );
    }

    try {
      return await response.json() as T;
    } catch (error) {
      throw new ApiError(
        "Malformed Bedrock response: response body was not valid JSON.",
        "invalid_request",
        response.status,
        false,
        undefined,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
