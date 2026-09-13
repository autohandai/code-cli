import { afterEach, describe, expect, it, vi } from 'vitest';
import { LLMGatewayClient } from '../../src/providers/LLMGatewayClient.js';
import { AUTOHAND_AI_DEFAULT_BASE_URL } from '../../src/providers/AutohandAIProvider.js';

const encoder = new TextEncoder();
const event = (data: unknown) => `data: ${JSON.stringify(data)}\r\n\r\n`;
const client = () => new LLMGatewayClient({ apiKey: 'fixture', model: 'moa' }, { maxRetries: 2, retryDelay: 1 });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('cloud inference streaming', () => {
  it('targets inference directly by default', () => {
    expect(AUTOHAND_AI_DEFAULT_BASE_URL).toBe('https://inference.autohand.ai/v1');
  });
  it('accepts an explicitly buffered JSON response when gateway inspection prevents SSE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'buffered', choices: [{ message: { content: 'Inspected answer' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    }), { headers: { 'content-type': 'application/json' } })));
    const onDelta = vi.fn();
    const result = await client().complete({ messages: [], stream: true, onDelta });
    expect(result.content).toBe('Inspected answer');
    expect(onDelta).not.toHaveBeenCalled();
  });
  it('delivers first content before EOF and assembles fragmented UTF-8, tools, and final usage', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    const onDelta = vi.fn();
    const done = client().complete({ messages: [], stream: true, onDelta });
    controller.enqueue(encoder.encode(event({ id: 'stream-1', created: 123, choices: [{ delta: { content: 'Hello' } }] })));
    await vi.waitFor(() => expect(onDelta).toHaveBeenCalledWith({ type: 'content', text: 'Hello' }));
    const remainder = event({ choices: [{ delta: { content: ' 🌏' } }] })
      + event({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{"pa' } }] } }] })
      + event({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.ts"}' } }] }, finish_reason: 'tool_calls' }] })
      + event({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } })
      + 'data:[DONE]\n\n';
    for (const byte of encoder.encode(remainder)) controller.enqueue(new Uint8Array([byte]));
    // [DONE] must complete even when the HTTP transport does not immediately close.
    const result = await done;
    expect(result).toMatchObject({ id: 'stream-1', created: 123, content: 'Hello 🌏', finishReason: 'tool_calls',
      toolCalls: [{ id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }],
      usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 } });
  });
  it('does not retry a stream after visible content or return a truncated answer as success', async () => {
    const fetch = vi.fn().mockImplementation(() => new Response(new ReadableStream({
      start(c) { c.enqueue(encoder.encode(event({ choices: [{ delta: { content: 'partial' } }] }))); c.close(); },
    })));
    vi.stubGlobal('fetch', fetch);
    await expect(client().complete({ messages: [], stream: true, onDelta: vi.fn() })).rejects.toThrow(/incomplete|ended/i);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('cancels a stalled stream on user abort', async () => {
    const abort = new AbortController();
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }))));
    const done = client().complete({ messages: [], stream: true, signal: abort.signal });
    abort.abort();
    await expect(done).rejects.toThrow(/abort/i);
    expect(cancel).toHaveBeenCalled();
  });
});
