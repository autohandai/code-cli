/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { formatActiveAgents, handler } from '../../src/commands/agents.js';
import type { ActiveAgentRecord } from '../../src/session/ActiveAgentRegistry.js';

describe('/agents command', () => {
  it('formats the empty active agents state with the definitions hint', () => {
    const output = formatActiveAgents([]);

    expect(output).toContain('No active Autohand agents found.');
    expect(output).toContain('autohand agents definitions');
    expect(output).toContain('/agents definitions');
  });

  it('formats active agent rows', () => {
    const output = formatActiveAgents([
      createRecord({
        status: 'working',
        projectName: 'cli-3',
        sessionId: 'abcdef123456',
        model: 'openai/gpt-4o-mini',
        contextPercent: 42,
        sessionTokensUsed: 1500,
        pid: 9876,
      }),
    ], new Date('2026-01-01T00:00:05.000Z'));

    expect(output).toContain('Active Autohand Agents');
    expect(output).toContain('working');
    expect(output).toContain('cli-3');
    expect(output).toContain('abcdef12');
    expect(output).toContain('42%');
    expect(output).toContain('1.5k');
    expect(output).toContain('9876');
  });

  it('prints a static snapshot when --once is passed', async () => {
    const registry = {
      listActive: async () => [createRecord({ sessionId: 'static123456' })],
    };

    const output = await handler(['--once'], { registry: registry as any });

    expect(output).toContain('static12');
  });
});

function createRecord(overrides: Partial<ActiveAgentRecord> = {}): ActiveAgentRecord {
  return {
    version: 1,
    pid: 123,
    sessionId: 'session-id',
    workspaceRoot: '/repo',
    projectName: 'repo',
    provider: 'openrouter',
    model: 'openai/gpt-4o-mini',
    mode: 'interactive',
    status: 'idle',
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messageCount: 2,
    contextPercent: 87,
    tokensUsed: 1234,
    tokensUsageStatus: 'actual',
    sessionTokensUsed: 1234,
    ...overrides,
  };
}
