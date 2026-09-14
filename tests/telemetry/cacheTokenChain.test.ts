/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The provider layer already normalizes cache figures onto LLMUsage. They stop
 * there: a turn is many requests, and nothing carries them past the turn
 * boundary into the session usage the console reads. A collapsed cache hit
 * rate multiplies a session's cost while every other figure stays flat, so
 * losing them at the turn boundary loses the only signal that says so.
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addUsageToTurn } from '../../src/core/agent/ReactLoopRunner.js';
import { Session } from '../../src/session/SessionManager.js';
import type { SessionMetadata } from '../../src/session/types.js';
import type { TurnUsage } from '../../src/types.js';

const EMPTY: TurnUsage = { kind: 'unavailable', reason: 'not_reported' };

describe('addUsageToTurn cache accounting', () => {
  it('carries cache figures from the first reporting request of a turn', () => {
    expect(addUsageToTurn(EMPTY, 'anthropic' as never, {
      promptTokens: 4_200,
      completionTokens: 20,
      totalTokens: 4_220,
      cacheReadTokens: 4_096,
      cacheWriteTokens: 100,
    })).toMatchObject({
      kind: 'actual',
      cacheReadTokens: 4_096,
      cacheWriteTokens: 100,
    });
  });

  it('sums cache figures across the requests of a turn', () => {
    const first = addUsageToTurn(EMPTY, 'anthropic' as never, {
      promptTokens: 4_200,
      completionTokens: 20,
      totalTokens: 4_220,
      cacheReadTokens: 4_096,
      cacheWriteTokens: 100,
    });
    const second = addUsageToTurn(first, 'anthropic' as never, {
      promptTokens: 8_300,
      completionTokens: 30,
      totalTokens: 8_330,
      cacheReadTokens: 8_192,
      cacheWriteTokens: 0,
    });
    expect(second).toMatchObject({
      kind: 'actual',
      promptTokens: 12_500,
      cacheReadTokens: 12_288,
      cacheWriteTokens: 100,
    });
  });

  it('leaves cache figures absent when no request in the turn reported any', () => {
    const first = addUsageToTurn(EMPTY, 'ollama' as never, {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    const second = addUsageToTurn(first, 'ollama' as never, {
      promptTokens: 20,
      completionTokens: 5,
      totalTokens: 25,
    });
    expect(second).toMatchObject({ kind: 'actual', totalTokens: 40 });
    expect('cacheReadTokens' in second).toBe(false);
    expect('cacheWriteTokens' in second).toBe(false);
  });

  it('keeps a figure one request reported when a later request reports none', () => {
    const first = addUsageToTurn(EMPTY, 'anthropic' as never, {
      promptTokens: 4_200,
      completionTokens: 20,
      totalTokens: 4_220,
      cacheReadTokens: 4_096,
    });
    const second = addUsageToTurn(first, 'anthropic' as never, {
      promptTokens: 50,
      completionTokens: 10,
      totalTokens: 60,
    });
    expect(second).toMatchObject({ cacheReadTokens: 4_096 });
  });

  it('preserves a genuine zero rather than dropping it as absent', () => {
    const turn = addUsageToTurn(EMPTY, 'openai' as never, {
      promptTokens: 100,
      completionTokens: 10,
      totalTokens: 110,
      cacheReadTokens: 0,
    });
    expect(turn).toMatchObject({ cacheReadTokens: 0 });
    expect('cacheReadTokens' in turn).toBe(true);
  });
});

describe('Session.recordTurnUsage cache accounting', () => {
  let tmpDir: string;

  function createMetadata(): SessionMetadata {
    return {
      sessionId: 'cache-usage-session',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastActiveAt: '2026-01-01T00:00:00.000Z',
      messageCount: 0,
      workspaceRoot: '/tmp/workspace',
    } as SessionMetadata;
  }

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-cache-usage-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('accumulates cache figures across turns', async () => {
    const session = new Session(path.join(tmpDir, 'accumulate'), createMetadata());

    await session.recordTurnUsage({
      promptTokens: 4_200,
      completionTokens: 40,
      totalTokens: 4_240,
      cacheReadTokens: 4_096,
      cacheWriteTokens: 100,
      tokenUsageStatus: 'actual',
      occurredAt: '2026-01-01T00:10:00.000Z',
    });
    await session.recordTurnUsage({
      promptTokens: 8_300,
      completionTokens: 200,
      totalTokens: 8_500,
      cacheReadTokens: 8_192,
      tokenUsageStatus: 'actual',
      occurredAt: '2026-01-01T00:20:00.000Z',
    });

    expect(session.metadata.usage).toMatchObject({
      cacheReadTokens: 12_288,
      cacheWriteTokens: 100,
    });
  });

  it('leaves cache figures absent for a session whose provider never reported any', async () => {
    const session = new Session(path.join(tmpDir, 'silent'), createMetadata());

    await session.recordTurnUsage({
      promptTokens: 100,
      completionTokens: 40,
      totalTokens: 140,
      tokenUsageStatus: 'actual',
      occurredAt: '2026-01-01T00:10:00.000Z',
    });

    // Absent, not zero: a zero would say every request missed cache, which is
    // a measured claim about a provider that never spoke.
    const usage = session.metadata.usage as Record<string, unknown>;
    expect('cacheReadTokens' in usage).toBe(false);
    expect('cacheWriteTokens' in usage).toBe(false);
  });

  it('persists the accumulated cache figures to metadata on disk', async () => {
    const sessionDir = path.join(tmpDir, 'persisted');
    const session = new Session(sessionDir, createMetadata());

    await session.recordTurnUsage({
      promptTokens: 4_200,
      completionTokens: 40,
      totalTokens: 4_240,
      cacheReadTokens: 4_096,
      tokenUsageStatus: 'actual',
      occurredAt: '2026-01-01T00:10:00.000Z',
    });

    const saved = await fs.readJson(path.join(sessionDir, 'metadata.json')) as SessionMetadata;
    expect(saved.usage?.cacheReadTokens).toBe(4_096);
  });
});
