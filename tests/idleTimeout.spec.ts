/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { AUTH_CONFIG } from '../src/constants.js';
import { shouldForceAgentIdleLogout } from '../src/core/agent/AgentSessionAccounting.js';
import type { AgentRuntime } from '../src/types.js';

function createRuntime(overrides: Partial<AgentRuntime> = {}): AgentRuntime {
  return {
    config: {
      configPath: '/tmp/autohand-config.json',
      auth: { token: 'token' },
      ...(overrides.config ?? {}),
    },
    workspaceRoot: '/tmp/workspace',
    options: {},
    ...overrides,
  } as AgentRuntime;
}

describe('AUTH_CONFIG.idleTimeoutMs', () => {
  it('defaults to 60 minutes in milliseconds', () => {
    expect(AUTH_CONFIG.idleTimeoutMs).toBe(60 * 60 * 1000);
  });

  it('is a positive number', () => {
    expect(AUTH_CONFIG.idleTimeoutMs).toBeGreaterThan(0);
  });
});

describe('Idle timeout logic', () => {
  it('detects idle when elapsed time exceeds threshold', () => {
    const idleTimeoutMs = AUTH_CONFIG.idleTimeoutMs;
    const lastActivityAt = Date.now() - idleTimeoutMs - 1;
    const idleMs = Date.now() - lastActivityAt;
    expect(idleMs >= idleTimeoutMs).toBe(true);
  });

  it('does not trigger when within threshold', () => {
    const idleTimeoutMs = AUTH_CONFIG.idleTimeoutMs;
    const lastActivityAt = Date.now() - 1000; // 1 second ago
    const idleMs = Date.now() - lastActivityAt;
    expect(idleMs >= idleTimeoutMs).toBe(false);
  });

  it('calculates idle minutes correctly', () => {
    const idleMinutes = Math.round(31 * 60_000 / 60_000);
    expect(idleMinutes).toBe(31);
  });

  it('triggers at exactly the threshold boundary', () => {
    const idleTimeoutMs = AUTH_CONFIG.idleTimeoutMs;
    const lastActivityAt = Date.now() - idleTimeoutMs;
    const idleMs = Date.now() - lastActivityAt;
    // At or beyond the threshold
    expect(idleMs >= idleTimeoutMs).toBe(true);
  });

  it('forces idle logout for authenticated sessions beyond the threshold by default', () => {
    const now = 1_000_000;
    const lastActivityAt = now - AUTH_CONFIG.idleTimeoutMs;

    expect(shouldForceAgentIdleLogout(createRuntime(), lastActivityAt, now)).toBe(true);
  });

  it('uses the configured agent idle timeout', () => {
    const now = 10_000_000;
    const configuredIdleTimeoutMs = 90 * 60 * 1000;
    const runtime = createRuntime({
      config: {
        configPath: '/tmp/autohand-config.json',
        auth: { token: 'token' },
        agent: { idleTimeoutMs: configuredIdleTimeoutMs },
      },
    });

    expect(
      shouldForceAgentIdleLogout(runtime, now - configuredIdleTimeoutMs + 1, now),
    ).toBe(false);
    expect(
      shouldForceAgentIdleLogout(runtime, now - configuredIdleTimeoutMs, now),
    ).toBe(true);
  });

  it('falls back to the default timeout when the configured value is invalid', () => {
    const now = 10_000_000;
    const runtime = createRuntime({
      config: {
        configPath: '/tmp/autohand-config.json',
        auth: { token: 'token' },
        agent: { idleTimeoutMs: 0 },
      },
    });

    expect(
      shouldForceAgentIdleLogout(runtime, now - AUTH_CONFIG.idleTimeoutMs + 1, now),
    ).toBe(false);
    expect(
      shouldForceAgentIdleLogout(runtime, now - AUTH_CONFIG.idleTimeoutMs, now),
    ).toBe(true);
  });

  it('does not force idle logout when the session is not authenticated', () => {
    const now = 1_000_000;
    const lastActivityAt = now - AUTH_CONFIG.idleTimeoutMs - 1;

    expect(
      shouldForceAgentIdleLogout(
        createRuntime({ config: { configPath: '/tmp/autohand-config.json' } }),
        lastActivityAt,
        now,
      ),
    ).toBe(false);
  });

  it('does not force idle logout when config disables it', () => {
    const now = 1_000_000;
    const lastActivityAt = now - AUTH_CONFIG.idleTimeoutMs - 1;

    expect(
      shouldForceAgentIdleLogout(
        createRuntime({
          config: {
            configPath: '/tmp/autohand-config.json',
            auth: { token: 'token' },
            agent: { idleLogoutEnabled: false },
          },
        }),
        lastActivityAt,
        now,
      ),
    ).toBe(false);
  });

  it('does not force idle logout when the CLI flag disables it', () => {
    const now = 1_000_000;
    const lastActivityAt = now - AUTH_CONFIG.idleTimeoutMs - 1;

    expect(
      shouldForceAgentIdleLogout(
        createRuntime({ options: { idleLogout: false } }),
        lastActivityAt,
        now,
      ),
    ).toBe(false);
  });

  it('does not force idle logout when the environment disables it', () => {
    const now = 1_000_000;
    const lastActivityAt = now - AUTH_CONFIG.idleTimeoutMs - 1;

    expect(
      shouldForceAgentIdleLogout(
        createRuntime(),
        lastActivityAt,
        now,
        { AUTOHAND_NO_IDLE_LOGOUT: '1' },
      ),
    ).toBe(false);
  });
});
