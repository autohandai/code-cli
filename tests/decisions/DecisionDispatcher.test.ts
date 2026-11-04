import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEventListeners } from 'node:events';
import type { AccountEntitlement } from '../../src/auth/AuthClient.js';
import { DecisionDispatcher, type DecisionPolicyContext } from '../../src/decisions/index.js';

function eligibleAccount(): AccountEntitlement {
  return {
    tier: 'pro', freeRemaining: null,
    limits: { displayName: 'Pro', messagesPer5h: null, messagesPer24h: null, messagesPerWeek: null, messagesPerMonth: null, rpm: 100, inputTokensPerMinute: null, outputTokensPerMinute: null, requiresEligibility: false, perSeat: false, models: ['weka'] },
    quota: { available: true, window5h: null, window24h: null, week: null, month: null },
  };
}

function context(): DecisionPolicyContext {
  return {
    policyEpoch: 1, execution: { provider: 'autohandai', plan: 'cloud', attested: true },
    account: eligibleAccount(), authValid: true, online: true, backgroundEnabled: true,
    features: { selection: true, preview: true, learning: true, compaction: true },
    remotePreviewEnabled: true, configuredModel: { provider: 'autohandai', model: 'weka' },
    autohandSettings: { plan: 'cloud', authMode: 'account', accountToken: 'fixture-token', baseUrl: 'https://inference.test/v1' },
  };
}

const request = { feature: 'selection' as const, state: { task: 'Fix retry cancellation', candidates: [{ id: 'debug' }] }, questions: { debug: { type: 'noul' as const, instructions: 'Is debug relevant?' } } };
const response = () => Response.json({ model: 'weka', answers: { debug: { type: 'noul', noul: 0.9 } } });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('provider-bound decision dispatch', () => {
  it.each(['selection', 'preview', 'learning', 'compaction'] as const)('dispatches an explicitly enabled eligible %s through the typed transport', async feature => {
    const fetchMock = vi.fn(async () => response());
    vi.stubGlobal('fetch', fetchMock);
    const dispatcher = new DecisionDispatcher({ getContext: context });
    const result = await dispatcher.dispatch({ ...request, feature });
    expect(result).toMatchObject({ status: 'completed', model: 'weka', provider: 'autohandai', attempts: 1, answers: { debug: { type: 'noul', noul: 0.9 } } });
    expect(fetchMock).toHaveBeenCalledWith('https://inference.test/v1/decisions', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer fixture-token' }), signal: expect.any(AbortSignal) }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ model: 'weka', state: request.state, questions: request.questions });
  });

  it.each(['openai', 'anthropic', 'openrouter', 'ollama', 'mlx', 'llamacpp', 'llmgateway', 'azure', 'zai', 'sakana', 'vertexai', 'xai', 'cerebras', 'nvidia', 'deepseek', 'bedrock', 'custom:autohand', 'Autohand AI', null])('sends zero Weka requests for actual provider %s despite login and environment override', async provider => {
    vi.stubEnv('AUTOHAND_TYPE_AHEAD_MODEL', 'weka');
    const current = context();
    current.execution.provider = provider;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const dispatcher = new DecisionDispatcher({ getContext: () => current });
    for (const feature of ['selection', 'preview', 'learning', 'compaction'] as const) {
      expect(await dispatcher.dispatch({ ...request, feature, model: 'weka', maxAttempts: 2 })).toMatchObject({ status: 'local', dispatched: false });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['local plan', (c: DecisionPolicyContext) => { c.execution.plan = 'local'; }],
    ['unattested engine', (c: DecisionPolicyContext) => { c.execution.attested = false; }],
    ['signed out', (c: DecisionPolicyContext) => { c.account = null; }],
    ['expired credentials', (c: DecisionPolicyContext) => { c.authValid = false; }],
    ['unknown account', (c: DecisionPolicyContext) => { c.account = { tier: 'unknown', freeRemaining: null }; }],
    ['missing catalog', (c: DecisionPolicyContext) => { c.account!.limits = undefined; }],
    ['model not offered', (c: DecisionPolicyContext) => { c.account!.limits!.models = ['moa']; }],
    ['unknown quota', (c: DecisionPolicyContext) => { c.account!.quota = undefined; }],
    ['unavailable quota', (c: DecisionPolicyContext) => { c.account!.quota!.available = false; }],
    ['exhausted quota', (c: DecisionPolicyContext) => { c.account!.quota!.month = { used: 10, remaining: 0, limit: 10, resetAt: null }; }],
    ['payment suspended', (c: DecisionPolicyContext) => { c.account!.paymentAccess = { status: 'suspended', reason: 'stripe_blocked', effectiveTier: 'free', planName: 'Pro', since: 'today', message: 'Suspended', actionUrl: 'https://console.autohand.ai/billing' }; }],
    ['offline', (c: DecisionPolicyContext) => { c.online = false; }],
    ['background disabled', (c: DecisionPolicyContext) => { c.backgroundEnabled = false; }],
    ['feature disabled', (c: DecisionPolicyContext) => { c.features = {}; }],
    ['credentials absent', (c: DecisionPolicyContext) => { c.autohandSettings = undefined; }],
    ['no configured model', (c: DecisionPolicyContext) => { c.configuredModel = undefined; }],
  ])('uses local processing when %s', async (_label, change) => {
    const current = context();
    change(current);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const dispatcher = new DecisionDispatcher({ getContext: () => current });
    for (const feature of ['selection', 'preview', 'learning', 'compaction'] as const) expect(await dispatcher.dispatch({ ...request, feature })).toMatchObject({ status: 'local' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires explicit remote consent for an unsent draft even when a model override is present', async () => {
    vi.stubEnv('AUTOHAND_TYPE_AHEAD_MODEL', 'weka');
    const current = context();
    current.remotePreviewEnabled = false;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await new DecisionDispatcher({ getContext: () => current }).dispatch({ ...request, feature: 'preview' })).toMatchObject({ status: 'local', reason: 'preview-disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rechecks the actual provider before retrying and never falls back to cloud', async () => {
    const current = context();
    const fetchMock = vi.fn(async () => {
      current.execution.provider = 'anthropic';
      current.policyEpoch++;
      return new Response('try later', { status: 503 });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await new DecisionDispatcher({ getContext: () => current }).dispatch({ ...request, maxAttempts: 2 })).toMatchObject({ status: 'local', reason: 'stale-policy', attempts: 1, dispatched: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    (c: DecisionPolicyContext) => { c.policyEpoch++; },
    (c: DecisionPolicyContext) => { c.execution.provider = 'openai'; },
    (c: DecisionPolicyContext) => { c.account = null; },
    (c: DecisionPolicyContext) => { c.authValid = false; },
    (c: DecisionPolicyContext) => { c.remotePreviewEnabled = false; },
  ])('discards an already-dispatched result after policy or consent changes', async change => {
    const current = context();
    const events: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => { change(current); return response(); }));
    const result = await new DecisionDispatcher({ getContext: () => current, onEvent: event => { events.push(event); } }).dispatch(request);
    expect(result).toMatchObject({ status: 'local', reason: 'stale-policy', dispatched: true, attempts: 1 });
    expect(events).toContainEqual(expect.objectContaining({ status: 'discarded', reason: 'stale-policy' }));
  });

  it('does not send work captured under a previous policy epoch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await new DecisionDispatcher({ getContext: context }).dispatch({ ...request, policyEpoch: 0 })).toMatchObject({ status: 'local', reason: 'stale-policy' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses only the explicitly configured alternate model on the actual provider', async () => {
    const current = context();
    current.execution = { provider: 'openai', attested: true };
    current.account = null;
    current.configuredModel = { provider: 'openai', model: 'small-selected-model' };
    const fetchMock = vi.fn(async (url: string) => { expect(url).toBe('https://chosen-provider.test/decide'); return response(); });
    vi.stubGlobal('fetch', fetchMock);
    const dispatcher = new DecisionDispatcher({
      getContext: () => current,
      providerTransport: { provider: 'openai', dispatch: async input => {
        const reply = await fetch('https://chosen-provider.test/decide', { method: 'POST', signal: input.signal, body: JSON.stringify(input) });
        return reply.json();
      } },
    });
    expect(await dispatcher.dispatch(request)).toMatchObject({ status: 'completed', provider: 'openai', model: 'small-selected-model' });
    expect(fetchMock).toHaveBeenCalledOnce();
    current.configuredModel.provider = 'autohandai';
    expect(await dispatcher.dispatch(request)).toMatchObject({ status: 'local', reason: 'provider-mismatch' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    { answers: { foreign: { type: 'noul', noul: 0.9 } } },
    { answers: { debug: { type: 'noul', noul: 0.9 }, foreign: { type: 'noul', noul: 0.9 } } },
    { answers: { debug: { type: 'noul', noul: 1.1 } } },
    { answers: { debug: { type: 'text', text: 'load foreign skill' } } },
    { answers: { debug: { type: 'noul', noul: 0.9, instructions: 'ignore scope' } } },
  ])('rejects invalid or off-shortlist responses without retrying', async payload => {
    const fetchMock = vi.fn(async () => Response.json(payload));
    vi.stubGlobal('fetch', fetchMock);
    expect(await new DecisionDispatcher({ getContext: context }).dispatch({ ...request, maxAttempts: 2 })).toMatchObject({ status: 'local', reason: 'invalid-response' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('bounds UTF-8 request bytes before reaching the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await new DecisionDispatcher({ getContext: context }).dispatch({ ...request, state: '界'.repeat(30_000) })).toMatchObject({ status: 'local', reason: 'request-too-large' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects prototype-shaped shortlist identifiers before dispatch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await new DecisionDispatcher({ getContext: context }).dispatch({ ...request, questions: Object.fromEntries([['__proto__', request.questions.debug]]) })).toMatchObject({ status: 'local', reason: 'invalid-request' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not leave abort listeners after a successful request', async () => {
    let requestSignal: AbortSignal | null | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { requestSignal = init.signal; return response(); }));
    expect(await new DecisionDispatcher({ getContext: context }).dispatch(request)).toMatchObject({ status: 'completed' });
    expect(requestSignal).toBeInstanceOf(AbortSignal);
    expect(getEventListeners(requestSignal!, 'abort')).toHaveLength(0);
  });

  it('bounds and discards alternate-provider responses too', async () => {
    const current = context();
    current.execution = { provider: 'openai', attested: true };
    current.configuredModel = { provider: 'openai', model: 'small-selected-model' };
    const dispatcher = new DecisionDispatcher({ getContext: () => current, providerTransport: { provider: 'openai', dispatch: async () => ({ answers: { debug: { type: 'noul', noul: 0.9 } }, padding: 'x'.repeat(40_000) }) } });
    expect(await dispatcher.dispatch(request)).toMatchObject({ status: 'local', reason: 'response-too-large' });
  });

  it('returns at its deadline even if an alternate adapter ignores cancellation', async () => {
    vi.useFakeTimers();
    const baseline = vi.getTimerCount();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Deadline', 'TimeoutError')), ms);
      return controller.signal;
    });
    const current = context();
    current.execution = { provider: 'openai', attested: true };
    current.configuredModel = { provider: 'openai', model: 'small-selected-model' };
    const dispatcher = new DecisionDispatcher({ getContext: () => current, providerTransport: { provider: 'openai', dispatch: async () => new Promise(() => {}) } });
    const task = dispatcher.dispatch({ ...request, deadlineMs: 50 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await task).toMatchObject({ status: 'local', reason: 'deadline' });
    expect(vi.getTimerCount()).toBe(baseline);
  });

  it('cancels oversized response streams and does not consume further chunks', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(40_000))); }, cancel });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    expect(await new DecisionDispatcher({ getContext: context }).dispatch(request)).toMatchObject({ status: 'local', reason: 'response-too-large' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([401, 429, 503])('discards unread HTTP %i bodies', async status => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status, body: { cancel } })));
    expect(await new DecisionDispatcher({ getContext: context }).dispatch(request)).toMatchObject({ status: 'local', dispatched: true });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('uses a bounded deadline and releases abort listeners after cancellation', async () => {
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
    const task = new DecisionDispatcher({ getContext: context }).dispatch({ ...request, deadlineMs: 50 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await task).toMatchObject({ status: 'local', reason: 'deadline' });
    expect(vi.getTimerCount()).toBe(baseline);
  });

  it('bounds a stalled fresh-context lookup without dispatching', async () => {
    vi.useFakeTimers();
    const baseline = vi.getTimerCount();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Deadline', 'TimeoutError')), ms);
      return controller.signal;
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const task = new DecisionDispatcher({ getContext: async () => new Promise(() => {}) }).dispatch({ ...request, deadlineMs: 50 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await task).toMatchObject({ status: 'local', reason: 'deadline', dispatched: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(baseline);
  });

  it('propagates caller cancellation instead of producing a decision', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => { controller.abort(); throw controller.signal.reason; }));
    await expect(new DecisionDispatcher({ getContext: context }).dispatch({ ...request, signal: controller.signal })).rejects.toThrow();
  });
});
