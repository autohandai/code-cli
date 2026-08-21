/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "../../src/providers/AnthropicProvider.js";
import { ApiError } from "../../src/providers/errors.js";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("AnthropicProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the Messages API for system prompts, tool use, tool results, and usage", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({
      id: "msg_123",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5",
      content: [
        { type: "text", text: "I will inspect it." },
        { type: "tool_use", id: "toolu_123", name: "read_file", input: { path: "package.json" } },
      ],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: {
        input_tokens: 30,
        output_tokens: 12,
        cache_creation_input_tokens: 8,
        cache_read_input_tokens: 10,
      },
    }));
    const provider = new AnthropicProvider({
      apiKey: "test-anthropic-key",
      model: "claude-sonnet-5",
    });

    const response = await provider.complete({
      messages: [
        { role: "system", content: "You are a coding agent." },
        { role: "user", content: "Inspect package.json" },
        {
          role: "assistant",
          content: "I need the file.",
          tool_calls: [{
            id: "toolu_previous",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"README.md"}' },
          }],
        },
        {
          role: "tool",
          tool_call_id: "toolu_previous",
          content: "# Autohand",
        },
      ],
      maxTokens: 4096,
      tools: [{
        name: "read_file",
        description: "Read a file",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Repository-relative path" },
          },
          required: ["path"],
        },
      }],
      toolChoice: "auto",
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://api.anthropic.com/v1/messages");
    const request = fetchSpy.mock.calls[0]?.[1];
    const headers = new Headers(request?.headers);
    expect(headers.get("x-api-key")).toBe("test-anthropic-key");
    expect(headers.get("anthropic-version")).toBeTruthy();
    expect(JSON.parse(request?.body as string)).toEqual(expect.objectContaining({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      system: "You are a coding agent.",
      messages: [
        { role: "user", content: "Inspect package.json" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "I need the file." },
            { type: "tool_use", id: "toolu_previous", name: "read_file", input: { path: "README.md" } },
          ],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_previous", content: "# Autohand" }],
        },
      ],
      tools: [{
        name: "read_file",
        description: "Read a file",
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Repository-relative path" },
          },
          required: ["path"],
        },
      }],
      tool_choice: { type: "auto" },
    }));
    expect(response).toEqual(expect.objectContaining({
      id: "msg_123",
      content: "I will inspect it.",
      finishReason: "tool_calls",
      toolCalls: [{
        id: "toolu_123",
        type: "function",
        function: { name: "read_file", arguments: '{"path":"package.json"}' },
      }],
      usage: {
        promptTokens: 48,
        completionTokens: 12,
        totalTokens: 60,
        cacheWriteTokens: 8,
        cacheReadTokens: 10,
      },
    }));
  });

  it("uses the bundled model catalog and updates the request model", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({
      id: "msg_456",
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
      content: [{ type: "text", text: "done" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 4, output_tokens: 1 },
    }));
    const provider = new AnthropicProvider({
      apiKey: "test-anthropic-key",
      model: "claude-sonnet-5",
    });

    expect(await provider.listModels()).toEqual(expect.arrayContaining([
      "claude-sonnet-5",
      "claude-opus-5",
      "claude-fable-5",
    ]));

    provider.setModel("claude-opus-5");
    await provider.complete({ messages: [{ role: "user", content: "hello" }] });

    const request = fetchSpy.mock.calls[0]?.[1];
    expect(JSON.parse(request?.body as string).model).toBe("claude-opus-5");
  });

  it("uses adaptive thinking and omits unsupported temperature for current Claude models", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({
      id: "msg_789",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5",
      content: [{ type: "text", text: "done" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 4, output_tokens: 1 },
    }));
    const provider = new AnthropicProvider({
      apiKey: "test-anthropic-key",
      model: "claude-sonnet-5",
      reasoningEffort: "high",
    });

    await provider.complete({
      messages: [{ role: "user", content: "hello" }],
      temperature: 0.1,
      thinkingLevel: "extended",
      outputSchema: {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
      },
    });

    const request = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    expect(request).not.toHaveProperty("temperature");
    expect(request.thinking).toEqual({ type: "adaptive" });
    expect(request.output_config).toEqual({
      effort: "high",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { answer: { type: "string" } },
          required: ["answer"],
        },
      },
    });
  });

  it("does not send an invalid extended-thinking budget when the output limit is too small", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({
      id: "msg_small_budget",
      type: "message",
      role: "assistant",
      model: "claude-opus-4-1",
      content: [{ type: "text", text: "done" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 4, output_tokens: 1 },
    }));
    const provider = new AnthropicProvider({
      apiKey: "test-anthropic-key",
      model: "claude-opus-4-1",
    });

    await provider.complete({
      messages: [{ role: "user", content: "hello" }],
      maxTokens: 1_024,
      thinkingLevel: "extended",
    });

    const request = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    expect(request.max_tokens).toBe(1_024);
    expect(request).not.toHaveProperty("thinking");
  });

  it("maps Anthropic authentication failures to the shared API error contract", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({
      type: "error",
      error: { type: "authentication_error", message: "invalid x-api-key" },
      request_id: "req_123",
    }, { status: 401 }));
    const provider = new AnthropicProvider({
      apiKey: "invalid-key",
      model: "claude-sonnet-5",
    }, { maxRetries: 0 });

    await expect(provider.complete({
      messages: [{ role: "user", content: "hello" }],
    })).rejects.toMatchObject({
      code: "auth_failed",
      retryable: false,
    } satisfies Partial<ApiError>);
  });
});

describe("AnthropicProvider request shaping", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockMessage(overrides: Record<string, unknown> = {}): Response {
    return jsonResponse({
      id: "msg_shape",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 4, output_tokens: 1 },
      ...overrides,
    });
  }

  async function captureRequestBody(
    settings: { apiKey: string; model: string; reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh" },
    request: Parameters<AnthropicProvider["complete"]>[0],
    responseOverrides?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockMessage(responseOverrides));
    const provider = new AnthropicProvider(settings);
    await provider.complete(request);
    // The spy is shared across calls within a test, so read the latest request.
    return JSON.parse(fetchSpy.mock.calls.at(-1)?.[1]?.body as string) as Record<string, unknown>;
  }

  it("never emits empty content blocks for blank turns or blank tool results", async () => {
    const body = await captureRequestBody(
      { apiKey: "k", model: "claude-sonnet-5" },
      {
        messages: [
          { role: "user", content: "first" },
          { role: "assistant", content: "" },
          {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "toolu_1",
              type: "function",
              function: { name: "run", arguments: "{}" },
            }],
          },
          { role: "tool", tool_call_id: "toolu_1", content: "" },
          { role: "user", content: "second" },
        ],
      },
    );

    expect(body.messages).toEqual([
      { role: "user", content: "first" },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_1", name: "run", input: {} }],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: "(no output)" },
          { type: "text", text: "second" },
        ],
      },
    ]);
  });

  it("keeps only the leading system prompt in `system` and replays later notes in-place", async () => {
    const body = await captureRequestBody(
      { apiKey: "k", model: "claude-sonnet-5" },
      {
        messages: [
          { role: "system", content: "You are a coding agent." },
          { role: "user", content: "question" },
          { role: "assistant", content: "answer" },
          { role: "system", content: "[Tool Result Integrity] recovery note" },
          { role: "user", content: "follow up" },
        ],
      },
    );

    expect(body.system).toBe("You are a coding agent.");
    expect(body.messages).toEqual([
      { role: "user", content: "question" },
      { role: "assistant", content: "answer" },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "<system-reminder>\n[Tool Result Integrity] recovery note\n</system-reminder>",
          },
          { type: "text", text: "follow up" },
        ],
      },
    ]);
  });

  it("drops leading assistant turns so the first message is always a user turn", async () => {
    const body = await captureRequestBody(
      { apiKey: "k", model: "claude-sonnet-5" },
      {
        messages: [
          { role: "system", content: "prompt" },
          { role: "assistant", content: "orphaned turn" },
          { role: "user", content: "question" },
        ],
      },
    );

    expect(body.messages).toEqual([{ role: "user", content: "question" }]);
  });

  it("omits the thinking parameter entirely on always-on thinking models", async () => {
    const body = await captureRequestBody(
      { apiKey: "k", model: "claude-fable-5" },
      { messages: [{ role: "user", content: "hi" }], thinkingLevel: "none" },
    );

    expect(body).not.toHaveProperty("thinking");
  });

  it("omits disabled thinking on Claude Opus 5 above high effort", async () => {
    const disabled = await captureRequestBody(
      { apiKey: "k", model: "claude-opus-5", reasoningEffort: "high" },
      { messages: [{ role: "user", content: "hi" }], thinkingLevel: "none" },
    );
    expect(disabled.thinking).toEqual({ type: "disabled" });

    const omitted = await captureRequestBody(
      { apiKey: "k", model: "claude-opus-5", reasoningEffort: "xhigh" },
      { messages: [{ role: "user", content: "hi" }], thinkingLevel: "none" },
    );
    expect(omitted).not.toHaveProperty("thinking");
  });

  it("only sends output effort to models that accept it", async () => {
    const unsupported = await captureRequestBody(
      { apiKey: "k", model: "claude-haiku-4-5", reasoningEffort: "high" },
      { messages: [{ role: "user", content: "hi" }] },
    );
    expect(unsupported).not.toHaveProperty("output_config");

    const clamped = await captureRequestBody(
      { apiKey: "k", model: "claude-opus-4-5", reasoningEffort: "xhigh" },
      { messages: [{ role: "user", content: "hi" }] },
    );
    expect(clamped.output_config).toEqual({ effort: "high" });

    const passthrough = await captureRequestBody(
      { apiKey: "k", model: "claude-opus-4-8", reasoningEffort: "xhigh" },
      { messages: [{ role: "user", content: "hi" }] },
    );
    expect(passthrough.output_config).toEqual({ effort: "xhigh" });
  });

  it("keeps temperature for Claude 4.6 and drops it for models that reject sampling", async () => {
    const sampled = await captureRequestBody(
      { apiKey: "k", model: "claude-sonnet-4-6" },
      { messages: [{ role: "user", content: "hi" }], temperature: 0.2 },
    );
    expect(sampled.temperature).toBe(0.2);

    const dotted = await captureRequestBody(
      { apiKey: "k", model: "claude-opus-4.8" },
      { messages: [{ role: "user", content: "hi" }], temperature: 0.2 },
    );
    expect(dotted).not.toHaveProperty("temperature");
  });

  it("enables Anthropic prompt caching for the stable request prefix", async () => {
    const body = await captureRequestBody(
      { apiKey: "k", model: "claude-sonnet-5" },
      { messages: [{ role: "user", content: "hi" }] },
    );

    expect(body.cache_control).toEqual({ type: "ephemeral" });
  });

  it("returns provider reasoning blocks and replays them verbatim on the next turn", async () => {
    const thinkingBlock = { type: "thinking", thinking: "", signature: "sig-1" };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockMessage({
      content: [
        thinkingBlock,
        { type: "text", text: "checking" },
        { type: "tool_use", id: "toolu_9", name: "run", input: {} },
      ],
      stop_reason: "tool_use",
    }));
    const provider = new AnthropicProvider({ apiKey: "k", model: "claude-sonnet-5" });

    const first = await provider.complete({ messages: [{ role: "user", content: "hi" }] });
    expect(first.reasoningBlocks).toEqual([thinkingBlock]);

    fetchSpy.mockResolvedValueOnce(mockMessage());
    await provider.complete({
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "checking",
          reasoningBlocks: first.reasoningBlocks,
          tool_calls: [{
            id: "toolu_9",
            type: "function",
            function: { name: "run", arguments: "{}" },
          }],
        },
        { role: "tool", tool_call_id: "toolu_9", content: "done" },
      ],
    });

    const replay = JSON.parse(fetchSpy.mock.calls[1]?.[1]?.body as string) as {
      messages: { role: string; content: unknown }[];
    };
    expect(replay.messages[1]).toEqual({
      role: "assistant",
      content: [
        thinkingBlock,
        { type: "text", text: "checking" },
        { type: "tool_use", id: "toolu_9", name: "run", input: {} },
      ],
    });
  });

  it("captures redacted thinking blocks so legacy extended thinking replays intact", async () => {
    const redacted = { type: "redacted_thinking", data: "opaque-payload" };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockMessage({
      content: [redacted, { type: "text", text: "ok" }],
    }));
    const provider = new AnthropicProvider({ apiKey: "k", model: "claude-opus-4-1" });

    const response = await provider.complete({ messages: [{ role: "user", content: "hi" }] });

    expect(response.reasoningBlocks).toEqual([redacted]);
  });

  it("surfaces the refusal explanation instead of returning an empty turn", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockMessage({
      content: [],
      stop_reason: "refusal",
      stop_details: {
        type: "refusal",
        category: "cyber",
        explanation: "This request was declined by a safety classifier.",
      },
    }));
    const provider = new AnthropicProvider({ apiKey: "k", model: "claude-sonnet-5" });

    const response = await provider.complete({ messages: [{ role: "user", content: "hi" }] });

    expect(response.finishReason).toBe("content_filter");
    expect(response.content).toContain("This request was declined by a safety classifier.");
  });
});

describe("resolveAnthropicTimeout", () => {
  it("never lets a header-oriented network timeout truncate a generation", async () => {
    const { resolveAnthropicTimeout, ANTHROPIC_MIN_TIMEOUT_MS } = await import(
      "../../src/providers/AnthropicProvider.js"
    );

    expect(resolveAnthropicTimeout(undefined)).toBe(ANTHROPIC_MIN_TIMEOUT_MS);
    expect(resolveAnthropicTimeout({ timeout: 30_000 })).toBe(ANTHROPIC_MIN_TIMEOUT_MS);
    expect(resolveAnthropicTimeout({ timeout: 1_800_000 })).toBe(1_800_000);
  });
});
