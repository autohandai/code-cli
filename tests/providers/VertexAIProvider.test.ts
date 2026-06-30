/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VertexAIProvider, VERTEX_AI_CODING_MODELS } from "../../src/providers/VertexAIProvider.js";
import { ApiError } from "../../src/providers/errors.js";

// Mock gcloud auth utilities
vi.mock("../../src/utils/gcloudAuth.js", () => ({
  getGcloudAccessToken: vi.fn().mockResolvedValue({ token: "", error: "not installed" }),
  clearGcloudTokenCache: vi.fn(),
}));

describe("VertexAIProvider", () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  function createProvider(
    model = "google/gemini-1.5-pro",
    networkSettings?: { maxRetries?: number; retryDelay?: number; timeout?: number }
  ): VertexAIProvider {
    return new VertexAIProvider(
      {
        authToken: "test-token",
        projectId: "test-project",
        endpoint: "aiplatform.googleapis.com",
        region: "us-central1",
        model,
      },
      networkSettings
    );
  }

  describe("listModels", () => {
    it("returns recommended coding models", async () => {
      const provider = createProvider();
      const models = await provider.listModels();
      expect(models).toEqual(VERTEX_AI_CODING_MODELS);
      expect(models).toContain("google/gemini-3.1-pro");
      expect(models).toContain("google/gemini-3.1-flash");
      expect(models).toContain("anthropic/claude-opus-4-7");
      expect(models).toContain("anthropic/claude-opus-4-6");
    });
  });

  describe("error handling", () => {
    it("throws ApiError with auth_failed for 401 responses", async () => {
      const provider = createProvider("google/gemini-1.5-pro", { maxRetries: 0 });
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers(),
        json: async () => ({ error: { message: "token expired or incorrect" } }),
        text: async () => "token expired or incorrect",
      });

      try {
        await provider.complete({ messages: [{ role: "user", content: "hi" }] });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe("auth_failed");
        expect((error as ApiError).httpStatus).toBe(401);
        expect((error as ApiError).retryable).toBe(false);
        expect((error as Error).message).toContain("Google Cloud Vertex AI auth token");
        expect((error as Error).message).not.toContain("LLM Gateway");
        expect((error as Error).message).not.toContain("API key");
      }
    });

    it("throws ApiError with rate_limited for 429 responses", async () => {
      const provider = createProvider("google/gemini-1.5-pro", { maxRetries: 0 });
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ "Retry-After": "30" }),
        json: async () => ({ error: { message: "Too many requests" } }),
        text: async () => "Too many requests",
      });

      try {
        await provider.complete({ messages: [{ role: "user", content: "hi" }] });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe("rate_limited");
        expect((error as ApiError).httpStatus).toBe(429);
        expect((error as ApiError).retryable).toBe(true);
        expect((error as ApiError).retryAfterMs).toBe(30000);
      }
    });

    it("throws ApiError with model_not_found for 404 responses", async () => {
      const provider = createProvider("google/gemini-1.5-pro", { maxRetries: 0 });
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers(),
        json: async () => ({ error: { message: "Model not found" } }),
        text: async () => "Model not found",
      });

      try {
        await provider.complete({ messages: [{ role: "user", content: "hi" }] });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe("model_not_found");
        expect((error as ApiError).httpStatus).toBe(404);
        expect((error as ApiError).retryable).toBe(false);
      }
    });

    it("throws ApiError with context_overflow for 400 payload too large", async () => {
      const provider = createProvider("google/gemini-1.5-pro", { maxRetries: 0 });
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Headers(),
        json: async () => ({ error: { message: "Request payload too large (3.5MB)" } }),
        text: async () => "Request payload too large",
      });

      try {
        await provider.complete({ messages: [{ role: "user", content: "hi" }] });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe("context_overflow");
        expect((error as ApiError).httpStatus).toBe(400);
        expect((error as ApiError).retryable).toBe(false);
      }
    });

    it("throws ApiError with invalid_request for generic 400", async () => {
      const provider = createProvider("google/gemini-1.5-pro", { maxRetries: 0 });
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Headers(),
        json: async () => ({ error: { message: "Malformed request" } }),
        text: async () => "Malformed request",
      });

      try {
        await provider.complete({ messages: [{ role: "user", content: "hi" }] });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe("invalid_request");
        expect((error as ApiError).httpStatus).toBe(400);
        expect((error as ApiError).retryable).toBe(false);
      }
    });

    it("throws ApiError with server_error for 500 responses", async () => {
      const provider = createProvider("google/gemini-1.5-pro", { maxRetries: 0 });
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        json: async () => ({ error: { message: "Internal server error" } }),
        text: async () => "Internal server error",
      });

      try {
        await provider.complete({ messages: [{ role: "user", content: "hi" }] });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe("server_error");
        expect((error as ApiError).httpStatus).toBe(500);
        expect((error as ApiError).retryable).toBe(true);
      }
    });

    it("throws ApiError with timeout for 504 responses", async () => {
      const provider = createProvider("google/gemini-1.5-pro", { maxRetries: 0 });
      mockFetch.mockResolvedValue({
        ok: false,
        status: 504,
        headers: new Headers(),
        json: async () => ({ error: { message: "Gateway timeout" } }),
        text: async () => "Gateway timeout",
      });

      try {
        await provider.complete({ messages: [{ role: "user", content: "hi" }] });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe("timeout");
        expect((error as ApiError).httpStatus).toBe(504);
        expect((error as ApiError).retryable).toBe(true);
      }
    });

    it("throws ApiError with cancelled for user abort", async () => {
      const provider = createProvider("google/gemini-1.5-pro", { maxRetries: 0 });
      const abortController = new AbortController();
      abortController.abort();

      mockFetch.mockImplementation(() => {
        const error = new Error("AbortError");
        error.name = "AbortError";
        return Promise.reject(error);
      });

      try {
        await provider.complete({
          messages: [{ role: "user", content: "hi" }],
          signal: abortController.signal,
        });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe("cancelled");
        expect((error as ApiError).retryable).toBe(false);
      }
    });

    it("throws ApiError with timeout for fetch timeout", async () => {
      const provider = createProvider("google/gemini-1.5-pro", { maxRetries: 0 });
      mockFetch.mockImplementation(() => {
        const error = new Error("AbortError");
        error.name = "AbortError";
        return Promise.reject(error);
      });

      try {
        await provider.complete({ messages: [{ role: "user", content: "hi" }] });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe("timeout");
        expect((error as ApiError).retryable).toBe(true);
      }
    });

    it("throws ApiError with network_error for connection failures", async () => {
      const provider = createProvider("google/gemini-1.5-pro", { maxRetries: 0 });
      mockFetch.mockImplementation(() => {
        const error = new Error("fetch failed: ECONNREFUSED");
        return Promise.reject(error);
      });

      try {
        await provider.complete({ messages: [{ role: "user", content: "hi" }] });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe("network_error");
        expect((error as ApiError).retryable).toBe(true);
      }
    });

    it("does not retry non-retryable errors (401, 403, 404)", async () => {
      const provider = createProvider("google/gemini-1.5-pro", { maxRetries: 2 });
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers(),
        json: async () => ({ error: { message: "Model not found" } }),
        text: async () => "Model not found",
      });

      try {
        await provider.complete({ messages: [{ role: "user", content: "hi" }] });
      } catch {
        // Expected
      }

      // Should only make one request, not retry
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("retries retryable errors (429, 500, timeout)", async () => {
      const provider = createProvider("google/gemini-1.5-pro", {
        maxRetries: 2,
        retryDelay: 10,
      });

      // First two calls fail with 500, third succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          headers: new Headers(),
          json: async () => ({ error: { message: "Internal error" } }),
          text: async () => "Internal error",
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          headers: new Headers(),
          json: async () => ({ error: { message: "Overloaded" } }),
          text: async () => "Overloaded",
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            id: "resp-1",
            choices: [{ message: { content: "Hello" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          text: async () => "",
        });

      const result = await provider.complete({ messages: [{ role: "user", content: "hi" }] });
      expect(result.content).toBe("Hello");
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe("Anthropic model routing", () => {
    it("routes claude-opus-4-7 to native Anthropic endpoint", async () => {
      const provider = createProvider("anthropic/claude-opus-4-7", { maxRetries: 0 });
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: "msg_123",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "Hello from Claude" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        text: async () => "",
      });

      await provider.complete({ messages: [{ role: "user", content: "hi" }] });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("publishers/anthropic/models/claude-opus-4-7:streamRawPredict");
    });

    it("routes gemini models to OpenAI-compatible endpoint", async () => {
      const provider = createProvider("google/gemini-1.5-pro", { maxRetries: 0 });
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          id: "resp-1",
          choices: [{ message: { content: "Hello from Gemini" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        text: async () => "",
      });

      await provider.complete({ messages: [{ role: "user", content: "hi" }] });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain("/chat/completions");
    });
  });
});
