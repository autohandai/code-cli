/** @license Apache-2.0 */
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { seedUsageReport, usageViewport, openUsageReport } from '../../src/testing/scenarios/usageReportScenario.js';
import { sendPaymentTransitionTurn } from '../../src/testing/scenarios/paymentAccessScenario.js';
import { createTempAutohandHome, createMockAuthServer, createMockAutohandAINativeSequenceServer, launchBuiltAutohand, exitInteractive, type TuistoryTempState, type MockAuthServer, type MockNativeToolServer } from './helpers/autohandTuistory.js';
let session: Session | undefined;
let state: TuistoryTempState | undefined;
let auth: MockAuthServer | undefined;
let provider: MockNativeToolServer | undefined;
afterEach(async () => { session?.close(); await auth?.close(); await provider?.close(); await state?.cleanup(); session = undefined; state = undefined; auth = undefined; provider = undefined; });

describe('interactive usage reports', () => {
  it('navigates reports, selects sessions, resizes, refreshes, and restores the composer', async () => {
    auth = await createMockAuthServer();
    state = await createTempAutohandHome({ config: {
      provider: 'autohandai',
      autohandai: { plan: 'cloud', authMode: 'account', model: 'fantail' },
      features: { cliUsageV2: true },
      auth: { token: 'tuistory-account-token', user: { id: 'tuistory-test-user', email: 'tuistory@example.com', name: 'Tuistory Test' } },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    await seedUsageReport(state.autohandHome, state.workspaceRoot);
    session = await launchBuiltAutohand(['--config', state.configPath, '--path', state.workspaceRoot], {
      cwd: state.workspaceRoot, autohandHome: state.autohandHome, cols: 100, rows: 30,
      env: { AUTOHAND_AUTH_API_URL: `${auth.baseUrl}/api/auth` },
    });
    await openUsageReport(session);
    await session.waitForText('Autohand Code Pro');
    expect(usageViewport(session)).toContain('120K recorded tokens');
    const snapshot = await readFile(new URL('../../src/testing/snapshots/usage-report.txt', import.meta.url), 'utf8');
    for (const line of snapshot.trimEnd().split('\n')) expect(usageViewport(session)).toContain(line);
    await session.press('2'); await session.waitForText('Session tokens');
    await session.press('left');
    expect(usageViewport(session)).toContain('Esc back');
    await session.press('tab'); await session.waitForText('Messages · all roles');
    await session.press('4'); await session.waitForText('Recorded extension capability uses');
    await session.press('pagedown'); await session.waitForText('release-review');
    await session.press('5'); await session.waitForText('Recorded skill activations');
    await session.press('6'); await session.waitForText('Dashboard fixture');
    await session.press('enter'); await session.waitForText('Session: usage-fixture');
    await session.press('enter'); expect(usageViewport(session)).toContain('Session: usage-fixture');
    await session.press('esc'); await session.waitForText('sorted by recorded tokens');
    await session.press('7'); await session.waitForText('Trace monitoring is not enabled');
    await session.resize({ cols: 60, rows: 20 });
    await session.text();
    expect(usageViewport(session)).toContain('Esc back');
    await session.press('r'); await session.waitForText('30d');
    await session.press('p'); await session.waitForText('All local projects');
    await session.press('R'); await session.waitForText('Trace monitoring is not enabled');
    await session.press('?'); await session.waitForText('Keyboard controls');
    await session.press('esc'); await session.waitForText('Traces · local');
    await session.press('esc'); await session.waitForText('❯');
    await session.type('draft after usage'); await session.waitForText('❯ draft after usage');
    for (let index = 0; index < 'draft after usage'.length; index++) await session.press('backspace');
    await openUsageReport(session);
    await session.press(['ctrl', 'c']); await session.waitForText('❯');
    await exitInteractive(session);
  }, 90_000);

  it('runs Tatch turns and shows external usage while the Autohand paid account is suspended', async () => {
    auth = await createMockAuthServer({ paymentBlocked: () => true });
    provider = await createMockAutohandAINativeSequenceServer([{ content: 'TATCH_FIRST_DONE' }, { content: 'TATCH_SECOND_DONE' }]);
    state = await createTempAutohandHome({ config: {
      provider: 'custom:tatch',
      customProviders: { tatch: { id: 'tatch', displayName: 'Tatch', apiFormat: 'openai-compatible', baseUrl: provider.baseUrl, apiKey: 'tatch-fixture', model: 'tatch-model' } },
      autohandai: { plan: 'cloud', authMode: 'account', model: 'moa' },
      auth: { token: 'tuistory-account-token', user: { id: 'tuistory-test-user', email: 'tuistory@example.com', name: 'Tuistory Test' } },
      features: { cliUsageV2: true }, agent: { autoMemory: false },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    session = await launchBuiltAutohand(['--config', state.configPath, '--path', state.workspaceRoot, '--y'], {
      cwd: state.workspaceRoot, autohandHome: state.autohandHome, cols: 100, rows: 30,
      env: { AUTOHAND_AUTH_API_URL: `${auth.baseUrl}/api/auth` },
    });
    await sendPaymentTransitionTurn(session, 'Say the first marker', 'TATCH_FIRST_DONE');
    await sendPaymentTransitionTurn(session, 'Say the second marker', 'TATCH_SECOND_DONE');
    expect(provider.requests.map(request => request.model)).toEqual(['tatch-model', 'tatch-model']);
    expect(session.readAll()).not.toContain('Stripe blocked your payment');
    await openUsageReport(session);
    await session.waitForText('No Autohand rate limits or quotas apply to this provider.');
    expect(usageViewport(session)).not.toContain('Account quota');
    expect(usageViewport(session)).not.toContain('requests/min');
    await session.press('esc');
    await exitInteractive(session);
  }, 90_000);
});
