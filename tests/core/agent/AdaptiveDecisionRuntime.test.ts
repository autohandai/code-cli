import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountEntitlement } from '../../../src/auth/AuthClient.js';
import type { LLMProvider } from '../../../src/providers/LLMProvider.js';
import type { AgentRuntime, LLMRequest, LLMResponse, ProviderName } from '../../../src/types.js';
import { createAdaptiveDecisionRuntime } from '../../../src/core/agent/AdaptiveDecisionRuntime.js';
import type { AdaptiveSkillCandidate } from '../../../src/skills/AdaptiveSkillSession.js';

const candidates: AdaptiveSkillCandidate[] = [
  { reference: { authority: 'builtin', packageId: 'debug', revision: 'one' }, name: 'Debug', description: 'Diagnose runtime regressions.', scope: 'builtin', score: 0.6 },
  { reference: { authority: 'project', packageId: 'tests', revision: 'two' }, name: 'Tests', description: 'Write meaningful regression tests.', scope: 'project', score: 0.55 },
];
const instruction = 'Diagnose the retry cancellation race';
const history = [{ role: 'user' as const, content: instruction }, { role: 'assistant' as const, content: 'The cancellation guard is implemented.' }];

function entitlement(): AccountEntitlement {
  return {
    tier: 'pro', freeRemaining: null,
    limits: { displayName: 'Pro', messagesPer5h: null, messagesPer24h: null, messagesPerWeek: null, messagesPerMonth: null, rpm: 100, inputTokensPerMinute: null, outputTokensPerMinute: null, requiresEligibility: false, perSeat: false, models: ['weka'] },
    quota: { available: true, window5h: null, window24h: null, week: null, month: null },
  };
}

function harness(provider: ProviderName = 'autohandai') {
  let activeProvider = provider;
  const runtime: AgentRuntime = {
    workspaceRoot: '/project', options: {}, config: {
      configPath: '/config.json', provider,
      auth: { token: `ahc_${'a'.repeat(43)}` },
      autohandai: { model: 'moa', plan: 'cloud', authMode: 'account' },
      openai: { model: 'coding-model', apiKey: 'chosen-api-key' },
      skills: { decisions: { enabled: true, provider, model: 'weka', selection: true, preview: true, learning: true, compaction: true, remotePreview: true } },
    },
  };
  const complete = vi.fn(async (input: LLMRequest): Promise<LLMResponse> => {
    const payload = JSON.parse(String(input.messages.at(-1)?.content));
    return { id: 'decision', created: 1, raw: {}, content: JSON.stringify({ answers: Object.fromEntries(Object.keys(payload.questions).map((id, index) => [id, { type: 'noul', noul: index === 0 ? 0.95 : 0.1 }])) }) };
  });
  let llm: LLMProvider = { getName: () => 'Autohand AI', complete, listModels: async () => [], isAvailable: async () => true, setModel: vi.fn() };
  const getEntitlement = vi.fn(async () => entitlement());
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const payload = JSON.parse(String(init.body));
    return Response.json({ answers: Object.fromEntries(Object.keys(payload.questions).map((id, index) => [id, { type: 'noul', noul: index === 0 ? 0.95 : 0.1 }])) });
  });
  vi.stubGlobal('fetch', fetchMock);
  const api = createAdaptiveDecisionRuntime({ runtime, getActiveProvider: () => activeProvider, getLLM: () => llm, getEntitlement });
  return { runtime, api, complete, getEntitlement, fetchMock, setProvider: (value: ProviderName) => { activeProvider = value; }, setLLM: (value: LLMProvider) => { llm = value; } };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('production adaptive decision runtime', () => {
  it('performs no entitlement or inference calls under the default configuration', async () => {
    const h = harness();
    h.runtime.config.skills = undefined;
    expect(await h.api.rerankSkills({ instruction, candidates })).toBeNull();
    expect(await h.api.suggestNextAction(history)).toBeNull();
    expect(await h.api.dispatcher.dispatch({ feature: 'compaction', state: {}, questions: { keep: { type: 'noul', instructions: 'Keep?' } } })).toMatchObject({ status: 'local' });
    expect(h.getEntitlement).not.toHaveBeenCalled();
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.complete).not.toHaveBeenCalled();
  });

  it('ranks only the bounded caller shortlist through Weka after explicit eligible opt-in', async () => {
    const h = harness();
    expect(await h.api.rerankSkills({ instruction, candidates })).toEqual(candidates[0].reference);
    expect(h.getEntitlement).toHaveBeenCalledOnce();
    expect(h.fetchMock).toHaveBeenCalledOnce();
    expect(h.complete).not.toHaveBeenCalled();
    const payload = JSON.parse(String(h.fetchMock.mock.calls[0]?.[1].body));
    expect(payload.model).toBe('weka');
    expect(payload.state.candidates).toHaveLength(2);
    expect(Object.keys(payload.questions)).toHaveLength(2);
  });

  it.each(['openai', 'anthropic', 'openrouter', 'ollama', 'mlx', 'custom:private'] as const)('sends zero Weka or entitlement requests under actual provider %s despite stored cloud auth and env override', async provider => {
    const h = harness(provider);
    vi.stubEnv('AUTOHAND_TYPE_AHEAD_MODEL', 'weka');
    await h.api.rerankSkills({ instruction, candidates });
    await h.api.suggestNextAction(history);
    await h.api.dispatcher.dispatch({ feature: 'compaction', state: {}, questions: { keep: { type: 'noul', instructions: 'Keep?' } } });
    expect(h.getEntitlement).not.toHaveBeenCalled();
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.complete).not.toHaveBeenCalled();
  });

  it.each([
    ['offline', (r: AgentRuntime) => { r.options.offline = true; }],
    ['daemon disabled', (r: AgentRuntime) => { r.options.daemon = false; }],
    ['bare mode', (r: AgentRuntime) => { r.options.bare = true; }],
    ['provider background disabled', (r: AgentRuntime) => { r.config.autohandai!.backgroundCalls = false; }],
    ['decisions disabled', (r: AgentRuntime) => { r.config.skills!.decisions!.enabled = false; }],
    ['no enabled features', (r: AgentRuntime) => { r.config.skills!.decisions = { enabled: true, model: 'weka' }; }],
    ['missing model', (r: AgentRuntime) => { r.config.skills!.decisions!.model = undefined; }],
    ['signed out', (r: AgentRuntime) => { r.config.auth = undefined; }],
    ['expired mandatory login', (r: AgentRuntime) => { r.config.auth = { token: 'web-session', expiresAt: '2020-01-01T00:00:00Z' }; }],
    ['invalid mandatory expiry', (r: AgentRuntime) => { r.config.auth = { token: 'web-session', expiresAt: 'not-a-date' }; }],
    ['missing provider credential', (r: AgentRuntime) => { r.config.autohandai!.authMode = 'api-key'; r.config.autohandai!.apiKey = ''; }],
    ['local Autohand plan', (r: AgentRuntime) => { r.config.autohandai!.plan = 'local'; }],
  ])('does no entitlement or decision calls with %s', async (_label, change) => {
    const h = harness();
    change(h.runtime);
    await h.api.rerankSkills({ instruction, candidates });
    await h.api.suggestNextAction(history);
    expect(h.getEntitlement).not.toHaveBeenCalled();
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.complete).not.toHaveBeenCalled();
  });

  it('respects durable credentials despite a legacy web-session expiry', async () => {
    const h = harness();
    h.runtime.config.auth!.expiresAt = '2020-01-01T00:00:00Z';
    expect(await h.api.rerankSkills({ instruction, candidates })).toEqual(candidates[0].reference);
    expect(h.fetchMock).toHaveBeenCalledOnce();
  });

  it('uses the explicit alternate model on the current actual provider with a bounded tool-free JSON request', async () => {
    const h = harness('openai');
    h.runtime.config.skills!.decisions!.model = 'small-decision-model';
    expect(await h.api.rerankSkills({ instruction, candidates })).toEqual(candidates[0].reference);
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.getEntitlement).not.toHaveBeenCalled();
    expect(h.complete).toHaveBeenCalledWith(expect.objectContaining({ model: 'small-decision-model', temperature: 0, maxTokens: expect.any(Number), toolChoice: 'none', signal: expect.any(AbortSignal) }));
    const request = h.complete.mock.calls[0]?.[0];
    expect(request?.tools).toEqual([]);
    expect(request?.maxTokens).toBeLessThanOrEqual(1_024);
    expect(request?.messages).toHaveLength(2);
    expect(h.runtime.config.openai!.model).toBe('coding-model');
  });

  it('never silently falls back from an alternate model to another provider', async () => {
    const h = harness('openai');
    h.runtime.config.skills!.decisions!.provider = 'autohandai';
    h.runtime.config.skills!.decisions!.model = 'small-decision-model';
    expect(await h.api.rerankSkills({ instruction, candidates })).toBeNull();
    expect(h.complete).not.toHaveBeenCalled();
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('requires explicit remote-preview consent and never treats an environment model as opt-in', async () => {
    const h = harness();
    h.runtime.config.skills!.decisions!.remotePreview = false;
    vi.stubEnv('AUTOHAND_TYPE_AHEAD_MODEL', 'weka');
    expect(await h.api.suggestNextAction(history)).toBeNull();
    expect(h.getEntitlement).not.toHaveBeenCalled();
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('accepts an environment-only preview model after explicit eligible cloud preview consent', async () => {
    const h = harness();
    h.runtime.config.skills!.decisions = { enabled: true, preview: true, remotePreview: true };
    vi.stubEnv('AUTOHAND_TYPE_AHEAD_MODEL', 'weka');
    expect(await h.api.suggestNextAction(history)).toBe('Review the recent changes');
    expect(h.getEntitlement).toHaveBeenCalledOnce();
    expect(h.fetchMock).toHaveBeenCalledOnce();
    expect(h.complete).not.toHaveBeenCalled();
    expect(await h.api.rerankSkills({ instruction, candidates })).toBeNull();
  });

  it('does not use an environment-only Weka preview model for an actual noncloud provider', async () => {
    const h = harness('openai');
    h.runtime.config.skills!.decisions = { enabled: true, preview: true, remotePreview: true };
    vi.stubEnv('AUTOHAND_TYPE_AHEAD_MODEL', 'weka');
    expect(await h.api.suggestNextAction(history)).toBeNull();
    expect(h.getEntitlement).not.toHaveBeenCalled();
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.complete).not.toHaveBeenCalled();
  });

  it('selects only fixed safe suggestions and sends bounded redacted user/assistant text', async () => {
    const h = harness();
    const suggestion = await h.api.suggestNextAction([
      { role: 'system', content: 'private system policy' },
      { role: 'tool', name: 'read_file', content: 'private tool output' },
      ...Array.from({ length: 100 }, () => ({ role: 'user' as const, content: `${'界'.repeat(2_000)} apiKey=secret-key data:image/png;base64,QUJDREVGRw==` })),
    ]);
    expect(['Review the recent changes', 'Run the relevant tests', 'Continue with the next implementation step', 'Explain the current result', 'Summarize the remaining work']).toContain(suggestion);
    const body = String(h.fetchMock.mock.calls[0]?.[1].body);
    expect(Buffer.byteLength(body)).toBeLessThan(20_000);
    expect(body).not.toContain('private system policy');
    expect(body).not.toContain('private tool output');
    expect(body).not.toContain('secret-key');
    expect(body).not.toContain('QUJDREVGRw==');
    expect(JSON.parse(body).state.messages).toHaveLength(6);
  });

  it.each([
    ['provider', (h: ReturnType<typeof harness>) => { h.setProvider('openai'); }],
    ['workspace', (h: ReturnType<typeof harness>) => { h.runtime.workspaceRoot = '/other'; }],
    ['account', (h: ReturnType<typeof harness>) => { h.runtime.config.api = { accountId: 'other-account' }; }],
    ['consent', (h: ReturnType<typeof harness>) => { h.runtime.config.skills!.decisions!.remotePreview = false; }],
    ['permission', (h: ReturnType<typeof harness>) => { h.runtime.config.permissions = { mode: 'restricted' }; }],
    ['library scope', (h: ReturnType<typeof harness>) => { h.runtime.config.skills!.excluded = ['private']; }],
    ['main model', (h: ReturnType<typeof harness>) => { h.runtime.options.model = 'changed-main-model'; }],
  ])('updates the synchronous policy epoch and discards results after a %s change', async (_label, change) => {
    const h = harness();
    const before = h.api.getPolicyEpoch();
    let observedEpoch = before;
    h.fetchMock.mockImplementationOnce(async () => {
      change(h);
      observedEpoch = h.api.getPolicyEpoch();
      return Response.json({ answers: { candidate_0: { type: 'noul', noul: 0.95 }, candidate_1: { type: 'noul', noul: 0.1 } } });
    });
    expect(await h.api.rerankSkills({ instruction, candidates })).toBeNull();
    expect(observedEpoch).toBeGreaterThan(before);
    expect(h.getEntitlement).toHaveBeenCalledOnce();
  });

  it('coalesces concurrent entitlement checks and invalidates cache for account and provider changes', async () => {
    const h = harness();
    await Promise.all([h.api.rerankSkills({ instruction, candidates }), h.api.rerankSkills({ instruction, candidates })]);
    expect(h.getEntitlement).toHaveBeenCalledOnce();
    h.runtime.config.api = { accountId: 'new-account' };
    await h.api.rerankSkills({ instruction, candidates });
    expect(h.getEntitlement).toHaveBeenCalledTimes(2);
    h.setProvider('openai'); h.api.getPolicyEpoch();
    h.setProvider('autohandai'); h.api.getPolicyEpoch();
    await h.api.rerankSkills({ instruction, candidates });
    expect(h.getEntitlement).toHaveBeenCalledTimes(3);
  });

  it('expires cached eligibility before the next write without a cache timer', async () => {
    const h = harness();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    expect(await h.api.rerankSkills({ instruction, candidates })).toEqual(candidates[0].reference);
    const before = h.api.getPolicyEpoch();
    clock.mockReturnValue(1_031_000);
    h.getEntitlement.mockResolvedValueOnce(null);
    expect(await h.api.rerankSkills({ instruction, candidates })).toBeNull();
    expect(h.api.getPolicyEpoch()).toBeGreaterThan(before);
    expect(h.getEntitlement).toHaveBeenCalledTimes(2);
    expect(h.fetchMock).toHaveBeenCalledOnce();
  });

  it('uses a replacement current provider object and discards its predecessor result', async () => {
    const h = harness('openai');
    h.runtime.config.skills!.decisions!.model = 'small-decision-model';
    const replacement = vi.fn(async (): Promise<LLMResponse> => ({ id: 'new', created: 1, raw: {}, content: JSON.stringify({ answers: { candidate_0: { type: 'noul', noul: 0.1 }, candidate_1: { type: 'noul', noul: 0.95 } } }) }));
    h.complete.mockImplementationOnce(async () => {
      h.setLLM({ getName: () => 'Autohand AI', complete: replacement, listModels: async () => [], isAvailable: async () => true, setModel: vi.fn() });
      return { id: 'old', created: 1, raw: {}, content: JSON.stringify({ answers: { candidate_0: { type: 'noul', noul: 0.95 }, candidate_1: { type: 'noul', noul: 0.1 } } }) };
    });
    expect(await h.api.rerankSkills({ instruction, candidates })).toBeNull();
    expect(await h.api.rerankSkills({ instruction, candidates })).toEqual(candidates[1].reference);
    expect(replacement).toHaveBeenCalledOnce();
    expect(h.getEntitlement).not.toHaveBeenCalled();
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when fresh server eligibility is unavailable or suspended', async () => {
    const h = harness();
    const suspended = entitlement();
    suspended.quota!.available = false;
    h.getEntitlement.mockResolvedValueOnce(suspended);
    expect(await h.api.rerankSkills({ instruction, candidates })).toBeNull();
    expect(h.fetchMock).not.toHaveBeenCalled();
    h.runtime.config.api = { accountId: 'another' };
    h.getEntitlement.mockRejectedValueOnce(new Error('account unavailable'));
    expect(await h.api.rerankSkills({ instruction, candidates })).toBeNull();
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('never caches an entitlement result obtained under a changed account', async () => {
    const h = harness();
    let resolveEntitlement!: (value: AccountEntitlement | null) => void;
    h.getEntitlement.mockImplementationOnce(() => new Promise(resolve => { resolveEntitlement = resolve; }));
    const work = h.api.rerankSkills({ instruction, candidates });
    await vi.waitFor(() => expect(h.getEntitlement).toHaveBeenCalledOnce());
    h.runtime.config.api = { accountId: 'new-account' };
    h.api.getPolicyEpoch();
    resolveEntitlement(entitlement());
    expect(await work).toBeNull();
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(await h.api.rerankSkills({ instruction, candidates })).toEqual(candidates[0].reference);
    expect(h.getEntitlement).toHaveBeenCalledTimes(2);
  });

  it('rejects off-shortlist IDs and ambiguous ties', async () => {
    const h = harness();
    h.fetchMock.mockResolvedValueOnce(Response.json({ answers: { foreign: { type: 'noul', noul: 1 } } }));
    expect(await h.api.rerankSkills({ instruction, candidates })).toBeNull();
    h.fetchMock.mockResolvedValueOnce(Response.json({ answers: { candidate_0: { type: 'noul', noul: 0.9 }, candidate_1: { type: 'noul', noul: 0.9 } } }));
    expect(await h.api.rerankSkills({ instruction, candidates })).toBeNull();
  });
});
