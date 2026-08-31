/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import {
  createMockAuthServer,
  createTempAutohandHome,
  exitInteractive,
  launchBuiltAutohand,
  type MockAuthServer,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const tempStates: TuistoryTempState[] = [];
const authServers: MockAuthServer[] = [];

afterEach(async () => {
  await Promise.allSettled(sessions.splice(0).map((session) => exitInteractive(session)));
  await Promise.allSettled(authServers.splice(0).map((server) => server.close()));
  await Promise.allSettled(tempStates.splice(0).map((state) => state.cleanup()));
});

describe('durable device credentials', () => {
  it('starts the interactive Autohand AI provider with obsolete session expiry metadata', async () => {
    const authServer = await createMockAuthServer();
    authServers.push(authServer);
    const state = await createTempAutohandHome({
      config: {
        provider: 'autohandai',
        features: { autohand_inference: true },
        autohandai: {
          plan: 'cloud',
          authMode: 'account',
          accountToken: `ahc_${'D'.repeat(43)}`,
          baseUrl: authServer.baseUrl,
          model: 'moa',
          contextWindow: 1_000_000,
        },
        auth: {
          token: `ahc_${'D'.repeat(43)}`,
          expiresAt: '2000-01-01T00:00:00.000Z',
          user: {
            id: 'tuistory-test-user',
            email: 'tuistory@example.com',
            name: 'Tuistory Test',
          },
        },
      },
    });
    tempStates.push(state);

    const session = await launchBuiltAutohand(
      ['--path', state.workspaceRoot, '--config', state.configPath],
      {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: { AUTOHAND_AUTH_API_URL: `${authServer.baseUrl}/api/auth` },
        waitForDataTimeout: 15_000,
      },
    );
    sessions.push(session);

    const screen = await session.text({
      timeout: 20_000,
      waitFor: (text) => text.includes('Autohand (Pro) (Autohand AI, moa)'),
    });

    expect(screen).toContain('❯');
    expect(screen).not.toContain('Sign in to continue.');
  }, 30_000);
});
