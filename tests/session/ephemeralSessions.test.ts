/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionManager } from '../../src/session/SessionManager.js';

describe('ephemeral sessions', () => {
  let root: string;
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-ephemeral-')); });
  afterEach(async () => { await fs.remove(root); });

  it('keeps a full session lifecycle in memory and writes nothing to disk', async () => {
    const sessionsDir = path.join(root, 'sessions');
    const manager = new SessionManager(sessionsDir, { persist: false });
    await manager.initialize();
    expect(manager.isEphemeral()).toBe(true);

    const session = await manager.createSession('/work/project', 'fantail');
    expect(session.isEphemeral()).toBe(true);
    await session.append({ role: 'user', content: 'hello', timestamp: '2026-09-14T00:00:00.000Z' });
    await session.appendTransient({ role: 'assistant', content: 'transient', timestamp: '2026-09-14T00:00:01.000Z' });
    await session.updateState({ cwd: '/work/project' } as never);
    await session.recordTurnUsage({ promptTokens: 10, completionTokens: 5, totalTokens: 15, durationMs: 100 });
    await manager.renameCurrentSession('Scratch work');
    expect(session.getMessages()).toHaveLength(1);
    expect(session.metadata).toMatchObject({ title: 'Scratch work', messageCount: 1, usage: { totalTokens: 15 } });

    await manager.closeSession('done');
    expect(await fs.pathExists(sessionsDir)).toBe(false);
  });

  it('does not touch an existing shared index', async () => {
    const sessionsDir = path.join(root, 'sessions');
    const durable = new SessionManager(sessionsDir);
    await durable.initialize();
    const kept = await durable.createSession('/work/project', 'fantail');
    await durable.closeSession();
    const before = await fs.readFile(path.join(sessionsDir, 'index.json'), 'utf8');

    const manager = new SessionManager(sessionsDir, { persist: false });
    await manager.initialize();
    const session = await manager.createSession('/work/project', 'fantail');
    await session.append({ role: 'user', content: 'x', timestamp: '2026-09-14T00:00:00.000Z' });
    await manager.closeSession();

    expect(await fs.readFile(path.join(sessionsDir, 'index.json'), 'utf8')).toBe(before);
    expect(await fs.pathExists(path.join(sessionsDir, session.metadata.sessionId))).toBe(false);
    expect(await fs.pathExists(path.join(sessionsDir, kept.metadata.sessionId, 'metadata.json'))).toBe(true);
    // The ephemeral manager never learned about the durable session either.
    expect((await manager.listSessions()).map((entry) => entry.sessionId)).not.toContain(kept.metadata.sessionId);
  });
});
