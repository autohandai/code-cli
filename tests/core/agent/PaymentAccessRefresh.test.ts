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
  it('preserves third-party and local provider selections and the last plan during outages', async () => {
    const host = agent(); host.activeProvider = 'openai'; host.runtime.config.provider = 'openai';
    const fetch = vi.spyOn(getAuthClient(), 'fetchEntitlement').mockResolvedValue({ tier: 'free', freeRemaining: 20, paymentAccess });
    await host.refreshAccountPlan();
    expect(host.providerConfigManager.applyModelChangeRemote).not.toHaveBeenCalled();
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
    expect(fetch).toHaveBeenCalledWith('ahk_team_fixture');
    expect(host.accountPlan.tier).toBe('free');
  });
});
