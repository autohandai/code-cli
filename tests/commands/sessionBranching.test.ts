/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { cloneSession, forkSession, sessionTree } from '../../src/commands/sessionBranching.js';

function makeSessionManager(overrides: Record<string, unknown> = {}) {
  return {
    branchSession: vi.fn(),
    resolveSessionReference: vi.fn(async (value: string) => value),
    listSessions: vi.fn(async () => []),
    getCurrentSession: vi.fn(() => ({
      metadata: {
        sessionId: 'source-session',
        summary: 'Source session',
      },
    })),
    ...overrides,
  };
}

describe('session branching commands', () => {
  it('keeps /fork behind experimental_fork', async () => {
    const sessionManager = makeSessionManager();

    const output = await forkSession({
      sessionManager: sessionManager as any,
      workspaceRoot: '/workspace',
      isFeatureEnabled: () => false,
    });

    expect(output).toContain('experimental_fork');
    expect(sessionManager.branchSession).not.toHaveBeenCalled();
  });

  it('forks the current session at a user message ordinal and restores the fork', async () => {
    const restoreSession = vi.fn();
    const sessionManager = makeSessionManager({
      branchSession: vi.fn(async () => ({
        metadata: {
          sessionId: 'forked-session',
          messageCount: 3,
          branch: {
            type: 'fork',
            sourceSessionId: 'source-session',
            sourceUserMessageOrdinal: 2,
          },
        },
      })),
    });

    const output = await forkSession({
      sessionManager: sessionManager as any,
      restoreSession,
      workspaceRoot: '/workspace',
      isFeatureEnabled: () => true,
      trackFeatureActivation: vi.fn(),
    }, ['2']);

    expect(sessionManager.branchSession).toHaveBeenCalledWith('source-session', {
      type: 'fork',
      userMessageOrdinal: 2,
    });
    expect(restoreSession).toHaveBeenCalledWith('forked-session');
    expect(output).toContain('Forked session forked-session');
  });

  it('keeps /clone behind experimental_clone', async () => {
    const sessionManager = makeSessionManager();

    const output = await cloneSession({
      sessionManager: sessionManager as any,
      workspaceRoot: '/workspace',
      isFeatureEnabled: () => false,
    });

    expect(output).toContain('experimental_clone');
    expect(sessionManager.branchSession).not.toHaveBeenCalled();
  });

  it('clones the active branch and restores the clone', async () => {
    const restoreSession = vi.fn();
    const sessionManager = makeSessionManager({
      branchSession: vi.fn(async () => ({
        metadata: {
          sessionId: 'cloned-session',
          messageCount: 4,
          branch: {
            type: 'clone',
            sourceSessionId: 'source-session',
          },
        },
      })),
    });

    const output = await cloneSession({
      sessionManager: sessionManager as any,
      restoreSession,
      workspaceRoot: '/workspace',
      isFeatureEnabled: () => true,
      trackFeatureActivation: vi.fn(),
    });

    expect(sessionManager.branchSession).toHaveBeenCalledWith('source-session', { type: 'clone' });
    expect(restoreSession).toHaveBeenCalledWith('cloned-session');
    expect(output).toContain('Cloned session cloned-session');
  });

  it('renders a session tree from branch metadata', async () => {
    const sessionManager = makeSessionManager({
      listSessions: vi.fn(async () => [
        { sessionId: 'root-session', createdAt: '2026-01-01T00:00:00.000Z', messageCount: 1, projectName: 'proj' },
        {
          sessionId: 'forked-session',
          createdAt: '2026-01-01T00:01:00.000Z',
          messageCount: 2,
          projectName: 'proj',
          branch: { type: 'fork', sourceSessionId: 'root-session', sourceUserMessageOrdinal: 1 },
        },
      ]),
    });

    const output = await sessionTree({
      sessionManager: sessionManager as any,
      workspaceRoot: '/workspace',
      isFeatureEnabled: (key) => key === 'experimental_fork',
    });

    expect(output).toContain('Session tree');
    expect(output).toContain('root-session');
    expect(output).toContain('forked-session');
    expect(output).toContain('fork at user message 1');
  });
});
