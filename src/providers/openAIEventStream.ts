/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LLMRequest, LLMResponse, LLMToolCall } from '../types.js';
import { ApiError } from './errors.js';
import { normalizeLLMUsage } from './usage.js';
import { joinReasoning, splitInlineThinking } from './inlineThinking.js';

const MAX_EVENT_CHARS = 1_048_576;
const MAX_RESPONSE_CHARS = 16_777_216;
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
function streamError(message: string): ApiError {
  // Retrying an accepted stream can duplicate displayed text, tool actions, and billing.
  return new ApiError(message, 'network_error', 0, false);
}

export async function readOpenAIEventStream(
  response: Response,
  onDelta: LLMRequest['onDelta'],
  signal: AbortSignal | undefined,
  idleTimeoutMs: number,
): Promise<LLMResponse> {
  const reader = response.body?.getReader();
  if (!reader) throw streamError('No response body for streaming.');
  const decoder = new TextDecoder();
  let buffer = '';
  let eventData = '';
  let content = '';
  let reasoning = '';
  let id = 'llmgateway-stream';
  let created = Math.floor(Date.now() / 1000);
  let finishReason: LLMResponse['finishReason'];
  let usage: LLMResponse['usage'];
  let done = false;
  let responseChars = 0;
  const calls = new Map<number, LLMToolCall>();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();

  const processEvent = () => {
    const text = eventData.trim();
    eventData = '';
    if (!text) return;
    if (text === '[DONE]') { done = true; return; }
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw streamError('Malformed event in inference stream.'); }
    const data = record(value);
    if (!data) throw streamError('Invalid inference stream event.');
    if (data.error || data.errors) throw streamError('The inference provider returned a stream error.');
    if (typeof data.id === 'string') id = data.id;
    if (typeof data.created === 'number') created = data.created;
    usage = normalizeLLMUsage(data.usage) ?? usage;
    const choice = record(Array.isArray(data.choices) ? data.choices[0] : undefined);
    const delta = record(choice?.delta);
    const finish = choice?.finish_reason;
    if (finish === 'stop' || finish === 'tool_calls' || finish === 'length' || finish === 'content_filter') finishReason = finish;
    if (!delta) return;
    const thinking = delta.reasoning ?? delta.reasoning_content;
    for (const [type, piece] of [['reasoning', thinking], ['content', delta.content]] as const) {
      if (typeof piece !== 'string' || !piece) continue;
      responseChars += piece.length;
      if (responseChars > MAX_RESPONSE_CHARS) throw streamError('Inference response exceeded the streaming size limit.');
      if (type === 'content') content += piece; else reasoning += piece;
      onDelta?.({ type, text: piece });
    }
    if (!Array.isArray(delta.tool_calls)) return;
    for (const item of delta.tool_calls) {
      const part = record(item);
      const index = part?.index;
      if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= 128) {
        throw streamError('Invalid streamed tool call index.');
      }
      const call = calls.get(index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
      const fn = record(part?.function);
      if (typeof part?.id === 'string') call.id = part.id;
      if (typeof fn?.name === 'string') call.function.name += fn.name;
      if (typeof fn?.arguments === 'string') {
        responseChars += fn.arguments.length;
        if (responseChars > MAX_RESPONSE_CHARS) throw streamError('Inference response exceeded the streaming size limit.');
        call.function.arguments += fn.arguments;
      }
      calls.set(index, call);
    }
  };
  const processLines = () => {
    while (!done) {
      const newline = /\r\n|\n|\r(?!$)/.exec(buffer);
      if (!newline) break;
      const line = buffer.slice(0, newline.index);
      buffer = buffer.slice(newline.index + newline[0].length);
      if (line === '') processEvent();
      else if (line === 'data' || line.startsWith('data:')) {
        eventData += `${line.slice(5).replace(/^ /, '')}\n`;
      }
      if (eventData.length > MAX_EVENT_CHARS) throw streamError('Inference stream event exceeded the size limit.');
    }
    if (buffer.length + eventData.length > MAX_EVENT_CHARS) throw streamError('Inference stream event exceeded the size limit.');
  };

  try {
    while (!done) {
      signal?.throwIfAborted();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const next = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(streamError('Inference stream stalled before completion.')), idleTimeoutMs);
        }),
      ]).finally(() => { if (timeout) clearTimeout(timeout); });
      signal?.throwIfAborted();
      if (next.done) {
        buffer += decoder.decode() + '\n\n';
        processLines();
        if (!done && !finishReason) throw streamError('Inference stream ended with an incomplete response.');
        break;
      }
      buffer += decoder.decode(next.value, { stream: true });
      processLines();
    }
    const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
    if (toolCalls.some(call => !call.id || !call.function.name)) throw streamError('Incomplete streamed tool call.');
    // Reasoning stays out of `content` so the show-thinking setting, not the
    // transcript, decides whether the user sees it.
    const inline = splitInlineThinking(content);
    return {
      id, created, content: inline.content,
      reasoning: joinReasoning(reasoning, inline.reasoning),
      finishReason: finishReason ?? 'stop', usage,
      ...(toolCalls.length ? { toolCalls } : {}),
      raw: { content, reasoning },
    };
  } catch (error) {
    if (signal?.aborted) throw new ApiError('Request aborted.', 'cancelled', 0, false);
    if (error instanceof ApiError) throw error;
    throw streamError('The inference stream failed before completion.');
  } finally {
    signal?.removeEventListener('abort', abort);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
