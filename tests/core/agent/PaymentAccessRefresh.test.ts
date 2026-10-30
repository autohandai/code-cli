import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutohandAgent } from '../../../src/core/agent.js';
import { getAuthClient } from '../../../src/auth/index.js';

const paymentAccess = { status: 'suspended', reason: 'stripe_blocked', effectiveTier: 'free', planName: 'Autohand Code Pro', since: '2026-09-08T00:00:00Z', message: 'Stripe blocked your payment. Your paid plan is suspended and your account is now on Free.', actionUrl: 'https://console.autohand.ai/billing?account=personal_1' } as const;
function agent() {
  return Object.assign(Object.create(AutohandAgent.prototype), {
    activeProvider: 'autohandai', isInstructionActive: false,
    runtime: { config: { auth: { token: 'fixture' }, provider: 'autohandai', autohandai: { plan: 'cloud', model: 'moa', reasoningEffort: 'high' } }, options: { model: 'moa' } },
    accountPlan: { tier: 'pro', label: 'Pro', interval: 'month' },
    syncProviderModelStatusLine: vi.fn(), emitOutput: vi.fn(), notifyUser: vi.fn(),
    providerConfigManager: { applyModelChangeRemote: vi.fn().mockResolvedValue({ status: 'applied', model: 'fantail', provider: 'autohandai' }) },
  });
}
afterEach(() => vi.restoreAllMocks());
describe('live payment access refresh', () => {
  it.each(['custom:tatch', 'openai', 'openrouter', 'ollama', 'autohandai'])('does not apply cloud account restrictions to %s outside Autohand Cloud', async (provider) => {
    const fetch = vi.spyOn(getAuthClient(), 'fetchEntitlement').mockResolvedValue({ tier: 'free', freeRemaining: 0, paymentAccess });
    const host = agent();
    host.activeProvider = provider;
    host.runtime.config.provider = provider;
    if (provider === 'autohandai') host.runtime.config.autohandai.plan = 'local';
    await host.refreshAccountPlan();
    expect(fetch).not.toHaveBeenCalled();
    expect(host.emitOutput).not.toHaveBeenCalled();
    expect(host.providerConfigManager.applyModelChangeRemote).not.toHaveBeenCalled();
    expect(host.accountPlan).toBeNull();
  });
  it('automatically selects Fantail, displays Free and emits a single recovery notice', async () => {
    vi.spyOn(getAuthClient(), 'fetchEntitlement').mockResolvedValue({ tier: 'free', freeRemaining: 20, paymentAccess });
    const host = agent();
    await host.refreshAccountPlan();
    expect(host.accountPlan.tier).toBe('free');
    expect(host.providerConfigManager.applyModelChangeRemote).toHaveBeenCalledWith('autohandai', 'fantail');
    expect(host.emitOutput).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Stripe blocked your payment') }));
    await host.refreshAccountPlan();
    expect(host.emitOutput).toHaveBeenCalledTimes(1);
    expect(host.runtime.config.autohandai.reasoningEffort).toBeUndefined();
  });
  it('preserves the last cloud plan during outages', async () => {
    const host = agent();
    const fetch = vi.spyOn(getAuthClient(), 'fetchEntitlement').mockResolvedValue({ tier: 'free', freeRemaining: 20, paymentAccess });
    await host.refreshAccountPlan();
    fetch.mockResolvedValue(null);
    await host.refreshAccountPlan();
    expect(host.accountPlan.tier).toBe('free');
  });
  it('defers provider replacement during an active turn', async () => {
    vi.spyOn(getAuthClient(), 'fetchEntitlement').mockResolvedValue({ tier: 'free', freeRemaining: 20, paymentAccess });
    const host = agent(); host.isInstructionActive = true;
    await host.refreshAccountPlan();
    expect(host.providerConfigManager.applyModelChangeRemote).not.toHaveBeenCalled();
  });
  it('reads the account selected by the active provider API key', async () => {
    const fetch = vi.spyOn(getAuthClient(), 'fetchEntitlement').mockResolvedValue({ tier: 'free', freeRemaining: 20, paymentAccess });
    const host = agent();
    host.runtime.config.autohandai.apiKey = 'ahk_team_fixture';
    await host.refreshAccountPlan();
    expect(fetch).toHaveBeenCalledWith('ahk_team_fixture', undefined);
    expect(host.accountPlan.tier).toBe('free');
  });
});

describe('prompt admission with a slow or failing entitlement check', () => {
  function admittedAgent() {
    return Object.assign(agent(), {
      shouldExit: false,
      peerRuntime: undefined,
      runInstructionWithPeerActivity: vi.fn().mockResolvedValue(true),
    });
  }

  it('admits repeated Tatch turns with an exhausted Autohand account without consulting its quota', async () => {
    const fetch = vi.spyOn(getAuthClient(), 'fetchEntitlement').mockResolvedValue({ tier: 'free', freeRemaining: 0, paymentAccess });
    const host = admittedAgent();
    host.activeProvider = 'custom:tatch';
    host.runtime.config.provider = 'custom:tatch';
    host.accountPlan = { tier: 'free', label: 'Free', interval: null };
    await expect(host.executeAdmittedInstruction('first')).resolves.toBe(true);
    await expect(host.executeAdmittedInstruction('second')).resolves.toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(host.runInstructionWithPeerActivity).toHaveBeenCalledTimes(2);
    expect(host.providerConfigManager.applyModelChangeRemote).not.toHaveBeenCalled();
  });

  it('discards a cloud entitlement response after switching to Tatch', async () => {
    let resolve!: (value: { tier: string; freeRemaining: number; paymentAccess: typeof paymentAccess }) => void;
    vi.spyOn(getAuthClient(), 'fetchEntitlement').mockReturnValue(new Promise(done => { resolve = done; }));
    const host = admittedAgent();
    const pending = host.refreshAccountPlan();
    host.activeProvider = 'custom:tatch';
    host.runtime.config.provider = 'custom:tatch';
    await host.refreshAccountPlan();
    resolve({ tier: 'free', freeRemaining: 0, paymentAccess });
    await pending;
    expect(host.accountPlan).toBeNull();
    expect(host.emitOutput).not.toHaveBeenCalled();
    expect(host.providerConfigManager.applyModelChangeRemote).not.toHaveBeenCalled();
  });

  it('runs the instruction on the cached plan while /auth/me is still pending, then adopts the fresh plan', async () => {
    let resolveEntitlement!: (value: { tier: string; freeRemaining: number | null }) => void;
    const fetch = vi.spyOn(getAuthClient(), 'fetchEntitlement')
      .mockReturnValue(new Promise((resolve) => { resolveEntitlement = resolve; }));
    const host = admittedAgent();

    await expect(host.executeAdmittedInstruction('hello')).resolves.toBe(true);
    expect(host.runInstructionWithPeerActivity).toHaveBeenCalledWith('hello', undefined);
    expect(host.accountPlan.tier).toBe('pro');
    expect(fetch).toHaveBeenCalledTimes(1);

    const refresh = host.accountPlanRefresh;
    expect(refresh).toBeDefined();
    resolveEntitlement({ tier: 'free', freeRemaining: 20 });
    await refresh;
    expect(host.accountPlan.tier).toBe('free');
  });

  it('keeps the prompt on the last known plan when /auth/me fails', async () => {
    vi.spyOn(getAuthClient(), 'fetchEntitlement').mockRejectedValue(new Error('timeout'));
    const host = admittedAgent();
    await expect(host.executeAdmittedInstruction('hello')).resolves.toBe(true);
    await host.accountPlanRefresh;
    expect(host.accountPlan.tier).toBe('pro');
    expect(host.runInstructionWithPeerActivity).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight refresh between back-to-back prompts', async () => {
    const fetch = vi.spyOn(getAuthClient(), 'fetchEntitlement').mockReturnValue(new Promise(() => {}));
    const host = admittedAgent();
    await host.executeAdmittedInstruction('first');
    await host.executeAdmittedInstruction('second');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(host.runInstructionWithPeerActivity).toHaveBeenCalledTimes(2);
  });

  it('aligns the cloud model with the last known free tier before the turn starts', async () => {
    vi.spyOn(getAuthClient(), 'fetchEntitlement').mockReturnValue(new Promise(() => {}));
    const host = admittedAgent();
    host.accountPlan = { tier: 'free', label: 'Free', interval: null };
    await host.executeAdmittedInstruction('hello');
    expect(host.providerConfigManager.applyModelChangeRemote).toHaveBeenCalledWith('autohandai', 'fantail');
    expect(host.providerConfigManager.applyModelChangeRemote.mock.invocationCallOrder[0])
      .toBeLessThan(host.runInstructionWithPeerActivity.mock.invocationCallOrder[0]);
  });
});
