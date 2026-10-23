import { afterEach, describe, expect, it, vi } from 'vitest';
import { compactSessionContext } from '../../src/core/context/sessionCompaction.js';
import type { LLMMessage } from '../../src/types.js';

const history: LLMMessage[] = [
  { role: 'system', content: 'Private system prompt must not be sent.' },
  { role: 'user', content: 'Implement cancellation in retry.ts' },
  { role: 'assistant', content: 'Learnt that an aborted retry can race the result.' },
  { role: 'tool', name: 'write_file', content: 'Changed retry.ts to check cancellation first.' },
  { role: 'assistant', content: 'Final answer: cancellation works; 8 tests pass.' },
];
const settings = { plan: 'cloud' as const, authMode: 'api-key' as const, apiKey: 'test-key', baseUrl: 'https://inference.test/v1' };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('session compaction through Weka decisions', () => {
  it('uses one typed Weka API call and retains the selected facts plus the request and answer', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe('weka');
      expect(body.messages).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('Private system prompt');
      return Response.json({ model: 'weka', answers: Object.fromEntries(Object.keys(body.questions).map(key => [key, { type: 'noul', noul: 0.95 }])) });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await compactSessionContext({ history, settings });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('https://inference.test/v1/decisions', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer test-key' }), signal: expect.any(AbortSignal),
    }));
    expect(result.source).toBe('weka');
    for (const phrase of ['Implement cancellation', 'Learnt that', 'Changed retry.ts', '8 tests pass']) expect(result.summary).toContain(phrase);
    expect(result.summary.length).toBeLessThanOrEqual(10_000);
  });
  it('bounds request and handoff size for very long sessions and excludes image payloads', async () => {
    const longHistory: LLMMessage[] = [...history, { role: 'user', content: 'Screenshot: data:image/png;base64,QUJDREVGRw==' }, ...Array.from({ length: 10_000 }, () => ({ role: 'tool' as const, name: 'read_file', content: 'x'.repeat(5_000) }))];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(String(init.body).length).toBeLessThan(60_000);
      expect(String(init.body)).not.toContain('QUJDREVGRw==');
      return Response.json({ answers: {} });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await compactSessionContext({ history: longHistory, settings });
    expect(result.summary.length).toBeLessThanOrEqual(10_000);
    expect(result.summary).toContain('Implement cancellation');
    expect(result.summary).toContain('8 tests pass');
    expect(result.summary).not.toContain('QUJDREVGRw==');
    expect(result.source).toBe('local');
  });
  it.each([401, 429, 503])('discards unread HTTP %i bodies and preserves a local handoff', async status => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, body: { cancel } }));
    const result = await compactSessionContext({ history, settings });
    expect(cancel).toHaveBeenCalledOnce();
    expect(result.source).toBe('local');
    expect(result.summary).toContain('Changed retry.ts');
  });
  it('falls back on a bounded deadline without leaving timers', async () => {
    vi.useFakeTimers();
    const baseline = vi.getTimerCount();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Deadline', 'TimeoutError')), ms);
      return controller.signal;
    });
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    })));
    const task = compactSessionContext({ history, settings });
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await task).source).toBe('local');
    expect(vi.getTimerCount()).toBe(baseline);
  });
  it('propagates user cancellation instead of replacing context with a fallback', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => { controller.abort(); throw controller.signal.reason; }));
    await expect(compactSessionContext({ history, settings, signal: controller.signal })).rejects.toThrow();
  });
  it('does not call a cloud service without configured hosted credentials', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await compactSessionContext({ history });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.source).toBe('local');
    expect(result.summary).toContain('Learnt that');
  });

  it('retains the earlier handoff across repeated clears and subsequent user turns', async () => {
    const first = await compactSessionContext({ history });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return Response.json({ answers: Object.fromEntries(Object.keys(body.questions).map(key => [key, { type: 'noul', noul: 0 }])) });
    }));
    const second = await compactSessionContext({ history: [
      { role: 'system', content: first.summary },
      { role: 'user', content: 'Now check the timeout edge case.' },
      { role: 'assistant', content: 'Timeout edge case verified.' },
    ], settings });
    expect(second.summary).toContain('Implement cancellation');
    expect(second.summary).toContain('aborted retry can race');
    expect(second.summary).toContain('Timeout edge case verified');
  });
});
