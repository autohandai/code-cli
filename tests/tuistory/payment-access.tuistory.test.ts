import { afterEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { Session } from 'tuistory';
import { sendPaymentTransitionTurn } from '../../src/testing/scenarios/paymentAccessScenario.js';
import { createMockAuthServer, createMockAutohandAINativeSequenceServer, createTempAutohandHome, exitInteractive, launchBuiltAutohand, type MockAuthServer, type MockNativeToolServer, type TuistoryTempState } from './helpers/autohandTuistory.js';
let session: Session | undefined;
let auth: MockAuthServer | undefined;
let server: MockNativeToolServer | undefined;
let state: TuistoryTempState | undefined;
afterEach(async () => { session?.close(); await auth?.close(); await server?.close(); await state?.cleanup(); });
describe('Stripe suspension in an open CLI', () => {
  it('notifies once, changes the composer to Free, and uses Fantail on the next turn without restarting', async () => {
    let blocked = false;
    auth = await createMockAuthServer({ paymentBlocked: () => blocked });
    server = await createMockAutohandAINativeSequenceServer([{ content: 'PAID_TURN_DONE' }, { content: 'FREE_TURN_DONE' }, { content: 'FREE_STILL_WORKS' }]);
    state = await createTempAutohandHome({ config: {
      provider: 'autohandai',
      auth: { token: 'tuistory-account-token', user: { id: 'tuistory-test-user', email: 'tuistory@example.com', name: 'Tuistory Test' } },
      autohandai: { plan: 'cloud', authMode: 'account', accountToken: 'tuistory-account-token', model: 'moa', baseUrl: server.baseUrl, reasoningEffort: 'high' },
      agent: { autoMemory: false }, ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--y'], { autohandHome: state.autohandHome, cwd: state.workspaceRoot, env: { AUTOHAND_AUTH_API_URL: `${auth.baseUrl}/api/auth` } });
    await sendPaymentTransitionTurn(session, 'Say the paid marker', 'PAID_TURN_DONE');
    blocked = true;
    await sendPaymentTransitionTurn(session, 'Continue on the available plan', 'FREE_TURN_DONE');
    await session.waitForText('Free');
    expect(session.readAll()).toContain('Stripe blocked your payment');
    expect(session.readAll()).toContain('Manage billing: https://console.autohand.ai/billing');
    expect(server.requests[0]?.model).toBe('moa');
    expect(server.requests[1]?.model).toBe('fantail');
    const config = JSON.parse(await readFile(state.configPath, 'utf8'));
    expect(config.autohandai.model).toBe('fantail');
    expect(config.autohandai.reasoningEffort).toBeUndefined();
    await sendPaymentTransitionTurn(session, 'Continue once more', 'FREE_STILL_WORKS');
    expect(server.requests[2]?.model).toBe('fantail');
    await exitInteractive(session);
  });
});
