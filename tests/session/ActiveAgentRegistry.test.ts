/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ActiveAgentRegistry, ACTIVE_AGENT_STALE_MS, type ActiveAgentRecord } from '../../src/session/ActiveAgentRegistry.js';

describe('ActiveAgentRegistry', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'autohand-active-agents-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('writes and lists live active agent records newest first', async () => {
    const registry = new ActiveAgentRegistry(tempRoot, {
      now: () => new Date('2026-01-01T00:00:02.000Z'),
      isPidAlive: () => true,
    });
    await registry.write(createRecord({ sessionId: 'older', updatedAt: '2026-01-01T00:00:00.000Z' }));
    await registry.write(createRecord({ sessionId: 'newer', updatedAt: '2026-01-01T00:00:01.000Z' }));

    const records = await registry.listActive();

    expect(records.map((record) => record.sessionId)).toEqual(['newer', 'older']);
  });

  it('prunes stale heartbeat records', async () => {
    const now = new Date('2026-01-01T00:00:30.000Z');
    const registry = new ActiveAgentRegistry(tempRoot, {
      now: () => now,
      isPidAlive: () => true,
    });
    await registry.write(createRecord({
      sessionId: 'stale',
      updatedAt: new Date(now.getTime() - ACTIVE_AGENT_STALE_MS - 1).toISOString(),
    }));

    expect(await registry.listActive()).toEqual([]);
  });

  it('prunes records whose process is no longer alive', async () => {
    const registry = new ActiveAgentRegistry(tempRoot, { isPidAlive: () => false });
    await registry.write(createRecord({ sessionId: 'dead-process' }));

    expect(await registry.listActive()).toEqual([]);
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
