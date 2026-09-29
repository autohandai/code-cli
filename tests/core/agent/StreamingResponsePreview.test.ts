import { describe, expect, it, vi } from 'vitest';
import {
  combineDeltaHandlers,
  StreamedOutputRelay,
  StreamingResponsePreview,
} from '../../../src/core/agent/StreamingResponsePreview.js';
import type { AgentOutputEvent } from '../../../src/types.js';

describe('streamed output relay', () => {
  function relay() {
    const events: AgentOutputEvent[] = [];
    return { events, relay: new StreamedOutputRelay((event) => events.push(event)) };
  }

  it('forwards content as message deltas and reasoning as thought deltas, then recognises the final text', () => {
    const { events, relay: sink } = relay();
    sink.onDelta({ type: 'reasoning', text: 'think ' });
    sink.onDelta({ type: 'content', text: '  ' });
    sink.onDelta({ type: 'content', text: 'Hello' });
    sink.onDelta({ type: 'reasoning', text: 'hard' });
    sink.onDelta({ type: 'content', text: ' world' });
    expect(events).toEqual([
      { type: 'thought_delta', thought: 'think ' },
      { type: 'message_delta', content: '  Hello' },
      { type: 'thought_delta', thought: 'hard' },
      { type: 'message_delta', content: ' world' },
    ]);
    expect(sink.hasStreamedContent('Hello world')).toBe(true);
    expect(sink.hasStreamedContent('Hello world!')).toBe(false);
    expect(sink.hasStreamedThought('think hard')).toBe(true);
    expect(sink.hasStreamedThought('other')).toBe(false);
  });

  it.each(['{', '[', '<'])('withholds protocol content starting with %s from message deltas', (prefix) => {
    const { events, relay: sink } = relay();
    sink.onDelta({ type: 'content', text: ' ' });
    sink.onDelta({ type: 'content', text: `${prefix}"finalResponse":` });
    sink.onDelta({ type: 'content', text: '"secret"}' });
    expect(events).toEqual([]);
    expect(sink.hasStreamedContent('secret')).toBe(false);
  });

  it('reports nothing streamed when no content arrived', () => {
    const { relay: sink } = relay();
    expect(sink.hasStreamedContent('')).toBe(false);
    expect(sink.hasStreamedContent('anything')).toBe(false);
  });

  it('does not re-deliver the prefix a retried request streams again', () => {
    const { events, relay: sink } = relay();
    sink.onDelta({ type: 'content', text: 'Hello wo' });
    sink.onRetry({ phase: 'waiting', delayMs: 10, attempt: 1, maxAttempts: 3, reason: 'throughput' });
    sink.onRetry({ phase: 'retrying', attempt: 1, maxAttempts: 3 });
    sink.onDelta({ type: 'content', text: 'Hello' });
    sink.onDelta({ type: 'content', text: ' world' });
    sink.onDelta({ type: 'content', text: '!' });
    expect(events.map((event) => event.content)).toEqual(['Hello wo', 'rld', '!']);
    expect(sink.hasStreamedContent('Hello world!')).toBe(true);
  });

  it('combines delta handlers and yields nothing when none are present', () => {
    const first = vi.fn();
    const second = vi.fn();
    const combined = combineDeltaHandlers(undefined, first, second);
    combined?.({ type: 'content', text: 'x' });
    expect(first).toHaveBeenCalledExactlyOnceWith({ type: 'content', text: 'x' });
    expect(second).toHaveBeenCalledExactlyOnceWith({ type: 'content', text: 'x' });
    expect(combineDeltaHandlers(undefined, undefined)).toBeUndefined();
    expect(combineDeltaHandlers(first)).toBe(first);
  });
});

describe('streaming response preview', () => {
  it('shows the first content immediately, throttles updates, and cancels pending renders', () => {
    vi.useFakeTimers();
    try {
      const render = vi.fn();
      const preview = new StreamingResponsePreview(render);
      preview.onDelta({ type: 'reasoning', text: 'hidden' });
      preview.onDelta({ type: 'content', text: 'Hello' });
      expect(render).toHaveBeenCalledExactlyOnceWith('Hello');
      preview.onDelta({ type: 'content', text: ' world' });
      expect(render).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(80);
      expect(render).toHaveBeenLastCalledWith('Hello world');
      preview.onDelta({ type: 'content', text: '!' });
      preview.dispose();
      vi.runAllTimers();
      expect(render).toHaveBeenLastCalledWith(null);
      preview.onDelta({ type: 'content', text: 'late' });
      expect(render).toHaveBeenLastCalledWith(null);
    } finally { vi.useRealTimers(); }
  });

  it.each(['{', '[', '<'])('does not expose legacy protocol content starting with %s', (prefix) => {
    const render = vi.fn();
    const preview = new StreamingResponsePreview(render);
    preview.onDelta({ type: 'content', text: '  ' });
    preview.onDelta({ type: 'content', text: prefix });
    preview.onDelta({ type: 'content', text: 'toolCalls secret' });
    expect(render).not.toHaveBeenCalled();
    preview.dispose();
  });
});
