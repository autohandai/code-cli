/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FunctionDefinition, LLMMessage } from "../../src/types.js";

const { mockRuntimeSend, mockModelSend, mockFromIni } = vi.hoisted(() => ({
  mockRuntimeSend: vi.fn(),
  mockModelSend: vi.fn(),
  mockFromIni: vi.fn((options: { profile?: string }) => ({
    credentialProvider: "fromIni",
    profile: options.profile,
  })),
}));

vi.mock("@aws-sdk/client-bedrock-runtime", () => {
  class BedrockRuntimeClient {
    config: Record<string, unknown>;

    constructor(config: Record<string, unknown>) {
      this.config = config;
    }

    send(command: { input: unknown }) {
      return mockRuntimeSend(command);
    }
  }

  class ConverseCommand {
    input: unknown;

    constructor(input: unknown) {
      this.input = input;
    }
  }

  return { BedrockRuntimeClient, ConverseCommand };
});

vi.mock("@aws-sdk/client-bedrock", () => {
  class BedrockClient {
    config: Record<string, unknown>;

    constructor(config: Record<string, unknown>) {
      this.config = config;
    }

    send(command: { input: unknown }) {
      return mockModelSend(command);
    }
  }

  class ListFoundationModelsCommand {
    input: unknown;

    constructor(input: unknown) {
      this.input = input;
    }
  }

  return { BedrockClient, ListFoundationModelsCommand };
});

vi.mock("@aws-sdk/credential-providers", () => ({
  fromIni: mockFromIni,
}));

describe("BedrockProvider", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockRuntimeSend.mockReset();
    mockModelSend.mockReset();
    mockFromIni.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("maps Autohand messages, tools, and tool results to Bedrock Converse", async () => {
    mockRuntimeSend.mockResolvedValueOnce({
      output: {
        message: {
          role: "assistant",
          content: [
            { text: "I need to inspect a file." },
            {
              toolUse: {
                toolUseId: "tooluse_1",
                name: "read_file",
                input: { path: "src/index.ts" },
              },
            },
          ],
        },
      },
      stopReason: "tool_use",
      usage: {
        inputTokens: 20,
        outputTokens: 8,
        totalTokens: 28,
      },
    });

    const { BedrockProvider } = await import("../../src/providers/BedrockProvider.js");
    const provider = new BedrockProvider({
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      region: "us-west-2",
      apiMode: "converse",
      authMode: "aws-credentials",
      profile: "enterprise-prod",
    });

    const tools: FunctionDefinition[] = [
      {
        name: "read_file",
        description: "Read a file",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to read" },
          },
          required: ["path"],
        },
      },
    ];

    const messages: LLMMessage[] = [
      { role: "system", content: "Follow repo instructions." },
      { role: "user", content: "Open the entrypoint" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "tooluse_previous",
            type: "function",
            function: {
              name: "read_file",
              arguments: JSON.stringify({ path: "README.md" }),
            },
          },
        ],
      },
      {
        role: "tool",
        content: "README contents",
        tool_call_id: "tooluse_previous",
      },
    ];

    const response = await provider.complete({
      messages,
      tools,
      toolChoice: "auto",
      maxTokens: 512,
      temperature: 0.2,
    });

    expect(mockFromIni).toHaveBeenCalledWith({ profile: "enterprise-prod" });
    expect(mockRuntimeSend).toHaveBeenCalledTimes(1);
    const command = mockRuntimeSend.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(command.input).toMatchObject({
      modelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      system: [{ text: "Follow repo instructions." }],
      inferenceConfig: {
        maxTokens: 512,
        temperature: 0.2,
      },
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: "read_file",
              description: "Read a file",
              inputSchema: {
                json: tools[0].parameters,
              },
            },
          },
        ],
      },
    });
    expect(command.input.messages).toEqual([
      { role: "user", content: [{ text: "Open the entrypoint" }] },
      {
        role: "assistant",
        content: [
          {
            toolUse: {
              toolUseId: "tooluse_previous",
              name: "read_file",
              input: { path: "README.md" },
            },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            toolResult: {
              toolUseId: "tooluse_previous",
              content: [{ text: "README contents" }],
            },
          },
        ],
      },
    ]);
    expect(response).toMatchObject({
      content: "I need to inspect a file.",
      finishReason: "tool_calls",
      usage: {
        promptTokens: 20,
        completionTokens: 8,
        totalTokens: 28,
      },
      toolCalls: [
        {
          id: "tooluse_1",
          type: "function",
          function: {
            name: "read_file",
            arguments: JSON.stringify({ path: "src/index.ts" }),
          },
        },
      ],
    });
  });

  it("sends OpenAI-compatible chat requests to the Bedrock endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "bedrock-chat-response",
          created: 123,
          choices: [
            {
              message: {
                content: "hello from chat",
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "search",
                      arguments: "{\"query\":\"bedrock\"}",
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 7,
            total_tokens: 12,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const { BedrockProvider, getBedrockOpenAIEndpoint } = await import(
      "../../src/providers/BedrockProvider.js"
    );
    const provider = new BedrockProvider({
      model: "openai.gpt-oss-120b-1:0",
      region: "us-east-1",
      apiMode: "openai-chat",
      authMode: "bedrock-api-key",
      apiKey: "bedrock-api-key",
    });

    const response = await provider.complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          name: "search",
          description: "Search",
          parameters: { type: "object", properties: {}, required: [] },
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `${getBedrockOpenAIEndpoint("openai-chat", "us-east-1")}/chat/completions`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer bedrock-api-key",
          "Content-Type": "application/json",
        }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as {
      model: string;
      messages: unknown[];
      tools: unknown[];
    };
    expect(body.model).toBe("openai.gpt-oss-120b-1:0");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(body.tools).toHaveLength(1);
    expect(response.toolCalls?.[0].function.name).toBe("search");
  });

  it("sends OpenAI-compatible Responses requests to the Bedrock endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "bedrock-responses-response",
          created_at: 123,
          output_text: "done",
          output: [
            {
              type: "function_call",
              call_id: "call_resp_1",
              name: "write_file",
              arguments: "{\"path\":\"a.txt\",\"content\":\"hi\"}",
            },
          ],
          usage: {
            input_tokens: 4,
            output_tokens: 6,
            total_tokens: 10,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const { BedrockProvider, getBedrockOpenAIEndpoint } = await import(
      "../../src/providers/BedrockProvider.js"
    );
    const provider = new BedrockProvider({
      model: "openai.gpt-oss-120b-1:0",
      region: "us-east-1",
      apiMode: "openai-responses",
      authMode: "bedrock-api-key",
      apiKey: "bedrock-api-key",
    });

    const response = await provider.complete({
      messages: [{ role: "user", content: "write a file" }],
      tools: [
        {
          name: "write_file",
          description: "Write a file",
          parameters: { type: "object", properties: {}, required: [] },
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `${getBedrockOpenAIEndpoint("openai-responses", "us-east-1")}/responses`,
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as {
      model: string;
      input: unknown[];
      tools: unknown[];
    };
    expect(body.model).toBe("openai.gpt-oss-120b-1:0");
    expect(body.input).toEqual([
      {
        role: "user",
        content: [{ type: "input_text", text: "write a file" }],
      },
    ]);
    expect(body.tools).toEqual([
      {
        type: "function",
        name: "write_file",
        description: "Write a file",
        parameters: { type: "object", properties: {}, required: [] },
      },
    ]);
    expect(response.toolCalls?.[0].id).toBe("call_resp_1");
    expect(response.usage).toEqual({
      promptTokens: 4,
      completionTokens: 6,
      totalTokens: 10,
    });
  });

  it("turns Bedrock access and throttling failures into friendly errors", async () => {
    mockRuntimeSend.mockRejectedValueOnce(
      Object.assign(new Error("You do not have access to the model."), {
        name: "AccessDeniedException",
        "$metadata": { httpStatusCode: 403 },
      }),
    );

    const { BedrockProvider } = await import("../../src/providers/BedrockProvider.js");
    const provider = new BedrockProvider({
      model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      region: "us-east-1",
    });

    await expect(provider.complete({ messages: [{ role: "user", content: "hi" }] }))
      .rejects.toMatchObject({
        code: "access_denied",
      });
  });
});
