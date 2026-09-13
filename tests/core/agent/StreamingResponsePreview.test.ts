import { describe, expect, it, vi } from 'vitest';
import { StreamingResponsePreview } from '../../../src/core/agent/StreamingResponsePreview.js';

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
