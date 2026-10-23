import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAutohandOrchestrationEnabled, orchestrationThreadLimit, canUseMoaAdvisor, RESEARCH_WORKER_TOOLS } from '../../../src/core/agent/AutohandOrchestration.js';
import { CheckpointAdvisor } from '../../../src/core/agent/CheckpointAdvisor.js';
import { RunBudget } from '../../../src/core/agent/RunBudget.js';
import { LLMGatewayClient } from '../../../src/providers/LLMGatewayClient.js';
import type { LoadedConfig, LLMRequest, LLMResponse } from '../../../src/types.js';

const config: LoadedConfig = { provider: 'autohandai', autohandai: { plan: 'cloud', model: 'moa' } };

describe('Autohand orchestration defaults', () => {
  it('enables cloud orchestration with three workers and respects explicit choices', () => {
    expect(isAutohandOrchestrationEnabled(config)).toBe(true);
    expect(orchestrationThreadLimit(config)).toBe(4);
    expect(orchestrationThreadLimit({ ...config, features: { multi_agent_v2: { enabled: true, max_concurrent_threads_per_session: 2 } } })).toBe(2);
    expect(isAutohandOrchestrationEnabled({ ...config, autohandai: { ...config.autohandai!, orchestration: false } })).toBe(false);
    expect(isAutohandOrchestrationEnabled({ ...config, provider: 'openai' })).toBe(false);
    expect(isAutohandOrchestrationEnabled({ ...config, autohandai: { plan: 'local', model: 'local' } })).toBe(false);
  });
  it('does not send free or unverified Fantail accounts to Moa', () => {
    expect(canUseMoaAdvisor(config, 'free')).toBe(false);
    expect(canUseMoaAdvisor(config, 'pro')).toBe(true);
    expect(canUseMoaAdvisor(config, undefined)).toBe(true);
    expect(canUseMoaAdvisor({ ...config, autohandai: { plan: 'cloud', model: 'fantail' } }, undefined)).toBe(false);
  });
  it('limits workers to inspection tools without shell, delegation, writes or code execution', () => {
    expect(RESEARCH_WORKER_TOOLS.has('read_file')).toBe(true);
    expect(RESEARCH_WORKER_TOOLS.has('fetch_url')).toBe(true);
    for (const tool of ['run_command', 'custom_command', 'write_file', 'code_mode', 'delegate_task', 'mcp__anything', 'git_add']) {
      expect(RESEARCH_WORKER_TOOLS.has(tool)).toBe(false);
    }
  });
});

describe('Moa review deadlines through the gateway', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function reviewAfter(delays: number[], cancelAt?: number) {
    vi.useFakeTimers();
    const timerBaseline = vi.getTimerCount();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Deadline expired', 'TimeoutError')), milliseconds);
      return controller.signal;
    });
    const parent = new AbortController();
    if (cancelAt !== undefined) setTimeout(() => parent.abort(), cancelAt);
    const fetchMock = vi.fn<typeof fetch>(async (_url, options) => {
      const signal = options?.signal;
      if (!signal) throw new Error('Expected the review request signal');
      const index = fetchMock.mock.calls.length - 1;
      return new Promise<Response>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          reject(signal.reason);
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', abort);
          const recovering = index < delays.length - 1;
          resolve(Response.json({ id: 'checkpoint-fixture', choices: [{ message: {
            content: recovering ? '' : '{"verdict":"approved","feedback":"Evidence verified."}',
          }, finish_reason: recovering ? 'length' : 'stop' }] }));
        }, delays[index]);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new LLMGatewayClient({ apiKey: 'fixture', model: 'moa' }, { maxRetries: 0 });
    const advisor = new CheckpointAdvisor({ provider, recordUsage: () => {} });
    const pending = advisor.review('completion', { history: [], context: 'diff', signal: parent.signal })
      .then(value => ({ kind: 'review' as const, value }), (error: unknown) => ({ kind: 'error' as const, error }));
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(vi.getTimerCount()).toBe(timerBaseline);
    return { result, requests: fetchMock.mock.calls.length, parentAborted: parent.signal.aborted };
  }

  it('allows a valid thinking review to finish after ninety seconds', async () => {
    const { result, requests, parentAborted } = await reviewAfter([100_000]);
    expect(result).toEqual({ kind: 'review', value: { verdict: 'approved', feedback: 'Evidence verified.' } });
    expect(requests).toBe(1);
    expect(parentAborted).toBe(false);
  });

  it('gives the output recovery request its own generation budget', async () => {
    const { result, requests } = await reviewAfter([240_000, 120_000]);
    expect(result).toEqual({ kind: 'review', value: { verdict: 'approved', feedback: 'Evidence verified.' } });
    expect(requests).toBe(2);
  });

  it('identifies an expired review deadline even when the gateway reports cancellation', async () => {
    const { result, parentAborted } = await reviewAfter([600_000]);
    expect(result).toMatchObject({ kind: 'review', value: { verdict: 'unavailable',
      feedback: expect.stringMatching(/timed out.*stage=deadline/i) } });
    expect(parentAborted).toBe(false);
  });

  it('propagates a genuine user abort without retrying the review', async () => {
    const { result, requests, parentAborted } = await reviewAfter([100_000], 25_000);
    expect(result.kind).toBe('error');
    expect(parentAborted).toBe(true);
    expect(requests).toBe(1);
  });
});

function harness(responses: LLMResponse[] = [{ content: '{"verdict":"approved","feedback":"Contracts checked."}', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }]) {
  const complete = vi.fn(async (_request: LLMRequest) => responses.shift()!);
  const budget = new RunBudget({ maxRequests: 4 });
  const recordUsage = vi.fn();
  const advisor = new CheckpointAdvisor({ provider: { complete }, budget, recordUsage });
  return { advisor, complete, budget, recordUsage };
}

describe('Moa checkpoint advisor', () => {
  it('reports safe response metadata without retaining malformed review text', async () => {
    const { advisor } = harness([{ id: 'review-request-42', content: 'PRIVATE_REVIEW_TEXT', finishReason: 'stop' }]);
    const result = await advisor.review('completion', { history: [], context: 'diff', signal: new AbortController().signal });
    expect(result.verdict).toBe('unavailable');
    expect(result.feedback).toContain('stage=content-json');
    expect(result.feedback).toContain('contentChars=19');
    expect(result.feedback).toContain('finishReason=stop');
    expect(result.feedback).toContain('responseId=review-request-42');
    expect(result.feedback).not.toContain('PRIVATE_REVIEW_TEXT');
  });
  it('distinguishes provider JSON failures from malformed model verdicts without exposing error bodies', async () => {
    const advisor = new CheckpointAdvisor({ provider: { complete: vi.fn(async () => { throw new SyntaxError('PRIVATE_HTTP_BODY'); }) }, recordUsage: () => {} });
    const result = await advisor.review('completion', { history: [], context: 'diff', signal: new AbortController().signal });
    expect(result.feedback).toContain('stage=provider');
    expect(result.feedback).toContain('SyntaxError');
    expect(result.feedback).not.toContain('PRIVATE_HTTP_BODY');
  });
  it('does not approve a response returned after the review deadline', async () => {
    const deadline = new AbortController();
    vi.useFakeTimers();
    const timerBaseline = vi.getTimerCount();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    try {
      const advisor = new CheckpointAdvisor({ provider: { complete: async () => {
        deadline.abort(new DOMException('Review deadline expired', 'TimeoutError'));
        return { content: '{"verdict":"approved","feedback":"Late approval"}' };
      } }, recordUsage: () => {} });
      expect((await advisor.review('completion', { history: [], context: 'diff', signal: new AbortController().signal })).verdict).toBe('unavailable');
      expect(vi.getTimerCount()).toBe(timerBaseline);
    } finally { timeout.mockRestore(); vi.useRealTimers(); }
  });
  it.each([
    { content: '', finishReason: 'length' as const },
    { content: '```json\n```', finishReason: 'stop' as const },
    { content: '{"verdict":"approved"', finishReason: 'length' as const },
  ])('recovers an empty or truncated review before rejecting the checkpoint: %j', async first => {
    const usage = { promptTokens: 10, completionTokens: 4000, totalTokens: 4010 };
    const { advisor, complete, budget, recordUsage } = harness([
      { ...first, usage },
      { content: '{"verdict":"approved","feedback":"Evidence verified."}', finishReason: 'stop', usage },
    ]);
    expect(await advisor.review('commit', { history: [], context: 'complete proposed diff', signal: new AbortController().signal }))
      .toEqual({ verdict: 'approved', feedback: 'Evidence verified.' });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]?.[0].maxTokens).toBeGreaterThan(complete.mock.calls[0]?.[0].maxTokens ?? 0);
    expect(budget.status()).toMatchObject({ requests: 2, tokens: 8020 });
    expect(recordUsage).toHaveBeenCalledTimes(2);
  });
  it('reads full supplied history and diff without tools and accounts for its request', async () => {
    const { advisor, complete, budget, recordUsage } = harness();
    const history = [{ role: 'user' as const, content: 'Preserve auth invariant.' }];
    const signal = new AbortController().signal;
    expect(await advisor.review('completion', { history, context: 'diff --git a/auth.ts b/auth.ts', signal })).toEqual({ verdict: 'approved', feedback: 'Contracts checked.' });
    const request = complete.mock.calls[0]?.[0];
    expect(request).toMatchObject({ model: 'moa', maxTokens: 8000 });
    expect(request?.tools).toBeUndefined();
    expect(JSON.stringify(request?.messages)).toContain('Preserve auth invariant.');
    expect(JSON.stringify(request?.messages)).toContain('diff --git');
    expect(budget.status()).toMatchObject({ requests: 1, tokens: 15 });
    expect(recordUsage).toHaveBeenCalledOnce();
  });
  it('reports output exhaustion clearly after one recovery attempt without parsing partial approval', async () => {
    const { advisor, complete } = harness([
      { content: '{"verdict":"approved","feedback":"looks good"}', finishReason: 'length' },
      { content: '', finishReason: 'length' },
    ]);
    const review = await advisor.review('commit', { history: [], context: 'diff', signal: new AbortController().signal });
    expect(review).toMatchObject({ verdict: 'unavailable', feedback: expect.stringContaining('Moa exhausted its output budget before returning a complete checkpoint verdict.') });
    expect(complete).toHaveBeenCalledTimes(2);
  });
  it('does not exceed the request budget to recover an empty verdict', async () => {
    const complete = vi.fn(async () => ({ content: '', finishReason: 'length' as const }));
    const budget = new RunBudget({ maxRequests: 1 });
    const advisor = new CheckpointAdvisor({ provider: { complete }, budget, recordUsage: () => {} });
    await expect(advisor.review('commit', { history: [], context: 'diff', signal: new AbortController().signal })).rejects.toThrow('budget exhausted');
    expect(complete).toHaveBeenCalledOnce();
  });
  it('propagates cancellation after an empty verdict without issuing a recovery request', async () => {
    const controller = new AbortController();
    const complete = vi.fn(async () => { controller.abort(); return { content: '', finishReason: 'length' as const }; });
    const advisor = new CheckpointAdvisor({ provider: { complete }, recordUsage: () => {} });
    await expect(advisor.review('commit', { history: [], context: 'diff', signal: controller.signal })).rejects.toThrow();
    expect(complete).toHaveBeenCalledOnce();
  });
  it('consults only after the same failed test or compiler command repeats', () => {
    const { advisor } = harness();
    const call = { tool: 'run_command', args: { command: 'bun test auth.test.ts' } };
    const failure = { tool: 'run_command', success: false, output: 'Expected token but got undefined' };
    expect(advisor.observeFailure(call, failure)).toBe(false);
    expect(advisor.observeFailure({ ...call, args: { command: 'bun test other.test.ts' } }, failure)).toBe(false);
    expect(advisor.observeFailure(call, failure)).toBe(true);
    expect(advisor.observeFailure(call, failure)).toBe(false);
    expect(advisor.observeFailure({ tool: 'read_file', args: { path: 'a' } }, { ...failure, tool: 'read_file' })).toBe(false);
  });
  it('clears the repeated failure count after a successful retry', () => {
    const { advisor } = harness();
    const call = { tool: 'run_command', args: { command: 'bun run typecheck' } };
    const result = { tool: 'run_command', success: false, output: 'TS2322 wrong type' };
    advisor.observeFailure(call, result);
    advisor.observeFailure(call, { ...result, success: true });
    expect(advisor.observeFailure(call, result)).toBe(false);
    expect(advisor.observeFailure(call, result)).toBe(true);
  });
  it('recognizes repeated compiler errors despite test-run timing changes', () => {
    const { advisor } = harness();
    const call = { tool: 'shell', args: { command: 'bun', args: ['run', 'typecheck'] } };
    expect(advisor.observeFailure(call, { tool: 'shell', success: false, output: 'Start at 12:03:40\nTS2322 incompatible type\nDuration 3.4s' })).toBe(false);
    expect(advisor.observeFailure(call, { tool: 'shell', success: false, output: 'Start at 12:03:49\nTS2322 incompatible type\nDuration 5.1s' })).toBe(true);
  });
  it.each(['not json', '{"verdict":"approved"}', '{"verdict":"unknown","feedback":"ok"}'])('never treats malformed output as approval: %s', async content => {
    const { advisor } = harness([{ content }]);
    expect((await advisor.review('plan', { history: [], context: 'plan', signal: new AbortController().signal })).verdict).toBe('unavailable');
  });
  it('propagates cancellation and budget exhaustion without issuing a request', async () => {
    const { advisor, complete, budget } = harness();
    const controller = new AbortController(); controller.abort();
    await expect(advisor.review('plan', { history: [], context: '', signal: controller.signal })).rejects.toThrow();
    for (let i = 0; i < 4; i++) budget.recordRequest();
    await expect(advisor.review('plan', { history: [], context: '', signal: new AbortController().signal })).rejects.toThrow('budget exhausted');
    expect(complete).not.toHaveBeenCalled();
  });
});
