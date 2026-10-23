import { afterEach, describe, expect, it, vi } from 'vitest';
import { LLMGatewayClient } from '../../src/providers/LLMGatewayClient.js';
import { AUTOHAND_AI_DEFAULT_BASE_URL } from '../../src/providers/AutohandAIProvider.js';

const encoder = new TextEncoder();
const event = (data: unknown) => `data: ${JSON.stringify(data)}\r\n\r\n`;
const client = () => new LLMGatewayClient({ apiKey: 'fixture', model: 'moa' }, { maxRetries: 2, retryDelay: 1 });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('cloud inference streaming', () => {
  it.each(['', '{"choices":'])('does not replay accepted malformed HTTP JSON and identifies its transport stage: %j', async body => {
    const fetch = vi.fn().mockImplementation(() => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const cloud = new LLMGatewayClient({ apiKey: 'fixture', model: 'moa' }, { maxRetries: 2, retryDelay: 1 }, {
      serviceName: 'Autohand AI', credentialName: 'Autohand API key', accountName: 'Autohand account',
    });
    await expect(cloud.complete({ messages: [] })).rejects.toMatchObject({ retryable: false,
      message: expect.stringContaining('stage=http-json') });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([false, true])('preserves a safety rejection without retries or completed tool calls (stream=%s)', async (stream) => {
    const error = { type: 'content_blocked', categories: ['S7'], requestId: 'server-request-123', message: "This message was blocked by Autohand's safety check. Rephrase it and try again." };
    const tool = { index: 0, id: 'call-1', type: 'function', function: { name: 'mcp__autohand-computer-use__click', arguments: '{}' } };
    const body = stream
      ? event({ choices: [{ delta: { tool_calls: [tool] }, finish_reason: 'tool_calls' }] }) + event({ error })
      : JSON.stringify({ error });
    const fetch = vi.fn().mockResolvedValue(new Response(body, {
      status: stream ? 200 : 400,
      headers: { 'content-type': stream ? 'text/event-stream' : 'application/json', 'x-autohand-request-id': 'server-request-123' },
    }));
    vi.stubGlobal('fetch', fetch);
    const cloud = new LLMGatewayClient({ apiKey: 'fixture', model: 'fantail' }, { maxRetries: 2, retryDelay: 1 }, {
      serviceName: 'Autohand AI', credentialName: 'Autohand API key', accountName: 'Autohand account',
    });
    const result = cloud.complete({ messages: [{ role: 'user', content: 'Play Felix Rosch in Spotify' }], stream });
    await expect(result).rejects.toMatchObject({
      code: 'content_blocked', retryable: false,
      message: expect.stringContaining('S7'),
    });
    await expect(result).rejects.toThrow('Request ID: server-request-123');
    await expect(result).rejects.not.toThrow(/malformed|network|Check \/usage/);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('retains the tool identity when later stream chunks carry empty or null IDs', async () => {
    const body = event({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-original', function: { name: 'read_file', arguments: '' } }] } }] })
      + event({ choices: [{ delta: { tool_calls: [{ index: 0, id: '', function: { arguments: '' } }] } }] })
      + event({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":"README.md"}' } }] } }] })
      + event({ choices: [{ delta: { tool_calls: [{ index: 0, id: null, function: { arguments: '' } }] }, finish_reason: 'tool_calls' }] })
      + 'data: [DONE]\n\n';
    const fetch = vi.fn().mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetch);
    expect(await client().complete({ messages: [], stream: true })).toMatchObject({
      toolCalls: [{ id: 'call-original', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }],
      finishReason: 'tool_calls',
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([
    { id: undefined, name: 'run_command' },
    { id: 'call-incomplete', name: '' },
  ])('withholds a genuinely incomplete tool header for bounded continuation: %j', async ({ id, name }) => {
    const body = event({ choices: [{ delta: { content: 'Run git status to confirm everything is clean', tool_calls: [
      { index: 0, id, function: { name, arguments: '{"command":"git status --short"}' } },
    ] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 7, completion_tokens: 9, total_tokens: 16 } })
      + 'data: [DONE]\n\n';
    const fetch = vi.fn().mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetch);
    const response = await client().complete({ messages: [], stream: true });
    expect(response).toMatchObject({ content: 'Run git status to confirm everything is clean', finishReason: 'length',
      usage: { promptTokens: 7, completionTokens: 9, totalTokens: 16 } });
    expect(response.toolCalls).toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('withholds the entire tool batch when one header is incomplete', async () => {
    const body = event({ choices: [{ delta: { tool_calls: [
      { index: 0, id: 'valid-read', function: { name: 'read_file', arguments: '{"path":"package.json"}' } },
      { index: 1, function: { name: 'write_file', arguments: '{"path":"must-not-run","contents":"invalid"}' } },
    ] }, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    const response = await client().complete({ messages: [], stream: true });
    expect(response.finishReason).toBe('length');
    expect(response.toolCalls).toBeUndefined();
    const fetch = vi.mocked(globalThis.fetch);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('preserves a content-filter finish while withholding an incomplete header', async () => {
    const body = event({ choices: [{ delta: { content: 'Blocked.', tool_calls: [
      { index: 0, function: { name: 'run_command', arguments: '{}' } },
    ] }, finish_reason: 'content_filter' }] }) + 'data: [DONE]\n\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    const response = await client().complete({ messages: [], stream: true });
    expect(response.finishReason).toBe('content_filter');
    expect(response.toolCalls).toBeUndefined();
  });
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
  it('preserves a stream that ends early for continuation without replaying the accepted request', async () => {
    const fetch = vi.fn().mockImplementation(() => new Response(new ReadableStream({
      start(c) { c.enqueue(encoder.encode(event({ choices: [{ delta: { content: 'partial' } }] }))); c.close(); },
    })));
    vi.stubGlobal('fetch', fetch);
    expect(await client().complete({ messages: [], stream: true, onDelta: vi.fn() }))
      .toMatchObject({ content: 'partial', finishReason: 'length' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('withholds unfinished tools when an accepted stream ends without a terminal event', async () => {
    const fetch = vi.fn().mockImplementation(() => new Response(
      event({ choices: [{ delta: { content: 'I inspected the result and will write the file next.', tool_calls: [
        { index: 0, id: 'call-1', type: 'function', function: { name: 'write_file', arguments: '{"path":"a.ts","content":"part' } },
      ] } }] }), { headers: { 'content-type': 'text/event-stream' } },
    ));
    vi.stubGlobal('fetch', fetch);
    const result = await client().complete({ messages: [], stream: true });
    expect(result.finishReason).toBe('length');
    expect(result.toolCalls).toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('marks an empty accepted EOF as truncation for bounded agent recovery without transport replay', async () => {
    const fetch = vi.fn().mockImplementation(() => new Response(''));
    vi.stubGlobal('fetch', fetch);
    expect(await client().complete({ messages: [], stream: true }))
      .toMatchObject({ content: '', finishReason: 'length' });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('normalizes upstream max-token termination to a truncated response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      event({ choices: [{ delta: { content: 'partial' }, finish_reason: 'max_tokens' }] })
      + 'data: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    )));

    const result = await client().complete({ messages: [], stream: true });

    expect(result).toMatchObject({ content: 'partial', finishReason: 'length' });
  });
  it('reports complete streamed tool calls as tool_calls when the stream ends without a finish reason', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      event({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{"pa' } }] } }] })
      + event({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.ts"}' } }] } }] })
      + 'data: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    )));

    const result = await client().complete({ messages: [], stream: true });

    expect(result).toMatchObject({ finishReason: 'tool_calls',
      toolCalls: [{ id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }] });
  });
  it('treats a done marker without an explicit finish reason as incomplete', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      event({ choices: [{ delta: { content: 'partial' } }] })
      + 'data: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    )));

    const result = await client().complete({ messages: [], stream: true });

    expect(result).toMatchObject({ content: 'partial', finishReason: 'length' });
  });
  it('cancels a stalled stream on user abort', async () => {
    const abort = new AbortController();
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }))));
    const done = client().complete({ messages: [], stream: true, signal: abort.signal });
    abort.abort();
    await expect(done).rejects.toThrow(/abort|cancel/i);
    expect(cancel).toHaveBeenCalled();
  });
});
