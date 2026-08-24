/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * An idle interactive session ends locally. It must not revoke the account
 * credential or erase it from the shared config, because that config is global:
 * doing so signs the user out of every other terminal tab and every future run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logout = vi.fn(async () => ({ success: true }));
const saveConfig = vi.fn(async () => {});

vi.mock('../../src/auth/index.js', () => ({
  getAuthClient: () => ({ logout }),
}));
vi.mock('../../src/config.js', () => ({ saveConfig }));

function createHost() {
  const config = {
    configPath: '/tmp/autohand-config.json',
    auth: { token: 'account-token', user: { id: 'u1', email: 'a@b.c', name: 'A' } },
  };
  return {
    lastActivityAt: Date.now() - 4 * 60 * 60 * 1000,
    runtime: { config, options: {} },
    sessionManager: {
      getCurrentSession: vi.fn(() => ({ metadata: { sessionId: 's1' } })),
      closeSession: vi.fn(async () => {}),
    },
    closeSession: vi.fn(async () => {}),
  };
}

describe('idle session end', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    logout.mockClear();
    saveConfig.mockClear();
  });

  it('keeps the account credential so other terminal tabs stay signed in', async () => {
    const { forceAgentIdleLogout } = await import(
      '../../src/core/agent/AgentSessionAccounting.js'
    );
    const host = createHost();

    await forceAgentIdleLogout(host as never);

    expect(logout).not.toHaveBeenCalled();
    expect(saveConfig).not.toHaveBeenCalled();
    expect(host.runtime.config.auth).toEqual(
      expect.objectContaining({ token: 'account-token' }),
    );
  });

  it('prints the saved session id and the command to resume it', async () => {
    const lines: string[] = [];
    (console.log as unknown as { mockImplementation: (fn: (...a: unknown[]) => void) => void })
      .mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      });

    const { forceAgentIdleLogout } = await import(
      '../../src/core/agent/AgentSessionAccounting.js'
    );
    const host = createHost();

    await forceAgentIdleLogout(host as never);

    const output = lines.join('\n');
    expect(output).toContain('s1');
    expect(output).toContain('autohand resume s1');
  });

  it('still ends the local session and tears the runtime down', async () => {
    const { forceAgentIdleLogout } = await import(
      '../../src/core/agent/AgentSessionAccounting.js'
    );
    const host = createHost();

    await forceAgentIdleLogout(host as never);

    expect(host.sessionManager.closeSession).toHaveBeenCalled();
    expect(host.closeSession).toHaveBeenCalled();
  });
});
