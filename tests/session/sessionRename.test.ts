/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionManager } from '../../src/session/SessionManager.js';
import { getSessionDisplayName, normalizeSessionTitle } from '../../src/session/sessionTitle.js';
import { renameLastSession } from '../../src/startup/renameSession.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
});

async function sessionsDir(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-session-rename-'));
  tempRoots.push(root);
  return path.join(root, 'sessions');
}

describe('session titles', () => {
  it('normalizes a name and rejects empty or oversized ones', () => {
    expect(normalizeSessionTitle('  ship   the caret\tfix ')).toBe('ship the caret fix');
    expect(() => normalizeSessionTitle('   ')).toThrow('Session name cannot be empty.');
    expect(() => normalizeSessionTitle('x'.repeat(81))).toThrow('80 characters or fewer');
  });

  it('lists a session under its name before its summary', () => {
    expect(getSessionDisplayName({ title: 'Caret fix', summary: 'last message' })).toBe('Caret fix');
    expect(getSessionDisplayName({ summary: 'last message' })).toBe('last message');
    expect(getSessionDisplayName({ title: '  ', summary: '' })).toBeUndefined();
  });
});

describe('SessionManager rename', () => {
  it('names the current session on disk and in the index, and the name survives closing', async () => {
    const dir = await sessionsDir();
    const manager = new SessionManager(dir);
    await manager.initialize();
    const session = await manager.createSession('/work/project', 'fantail');

    const renamed = await manager.renameCurrentSession('  Caret fix  ');
    expect(renamed.title).toBe('Caret fix');
    expect((await fs.readJson(path.join(dir, session.metadata.sessionId, 'metadata.json'))).title).toBe('Caret fix');
    const index = await fs.readJson(path.join(dir, 'index.json'));
    expect(index.sessions.find((entry: { id: string }) => entry.id === session.metadata.sessionId).title).toBe('Caret fix');

    await manager.closeSession('the last user message');
    const closed = await fs.readJson(path.join(dir, session.metadata.sessionId, 'metadata.json'));
    expect(closed.title).toBe('Caret fix');
    expect(closed.summary).toBe('the last user message');
  });

  it('names a stored session by id prefix without making it current', async () => {
    const dir = await sessionsDir();
    const manager = new SessionManager(dir);
    await manager.initialize();
    const first = await manager.createSession('/work/project', 'fantail');
    await manager.closeSession('first summary');
    const second = await manager.createSession('/work/project', 'fantail');

    const renamed = await manager.renameSession(first.metadata.sessionId.slice(0, 12), 'Older work');
    expect(renamed.sessionId).toBe(first.metadata.sessionId);
    expect(manager.getCurrentSession()?.metadata.sessionId).toBe(second.metadata.sessionId);
    expect((await fs.readJson(path.join(dir, first.metadata.sessionId, 'metadata.json'))).title).toBe('Older work');
    const listed = await manager.listSessions();
    expect(listed.find((entry) => entry.sessionId === first.metadata.sessionId)?.title).toBe('Older work');
  });

  it('refuses to rename without a session or with an unknown reference', async () => {
    const dir = await sessionsDir();
    const manager = new SessionManager(dir);
    await manager.initialize();
    await expect(manager.renameCurrentSession('Anything')).rejects.toThrow('No active session to rename.');
    await expect(manager.renameSession('nope', 'Anything')).rejects.toThrow('Session not found: nope');
  });
});

describe('renameLastSession (--rename)', () => {
  it('names the most recent session of the workspace only', async () => {
    const dir = await sessionsDir();
    const manager = new SessionManager(dir);
    await manager.initialize();
    const other = await manager.createSession('/work/other', 'fantail');
    await manager.closeSession();
    const older = await manager.createSession('/work/project', 'fantail');
    await manager.closeSession();
    const newer = await manager.createSession('/work/project', 'fantail');
    newer.metadata.lastActiveAt = new Date(Date.now() + 5_000).toISOString();
    await newer.save();
    await manager.closeSession();

    const renamed = await renameLastSession({ workspacePath: '/work/project', name: 'Release prep', sessionsDir: dir });
    expect(renamed.sessionId).toBe(newer.metadata.sessionId);
    expect((await fs.readJson(path.join(dir, newer.metadata.sessionId, 'metadata.json'))).title).toBe('Release prep');
    expect((await fs.readJson(path.join(dir, older.metadata.sessionId, 'metadata.json'))).title).toBeUndefined();
    expect((await fs.readJson(path.join(dir, other.metadata.sessionId, 'metadata.json'))).title).toBeUndefined();
  });

  it('explains when the workspace has no session yet', async () => {
    const dir = await sessionsDir();
    await expect(renameLastSession({ workspacePath: '/work/empty', name: 'Nothing', sessionsDir: dir }))
      .rejects.toThrow('No session found for /work/empty');
  });
});
