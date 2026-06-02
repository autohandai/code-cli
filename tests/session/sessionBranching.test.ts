/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionManager } from '../../src/session/SessionManager.js';

describe('SessionManager branching', () => {
  let tempDir: string;
  let manager: SessionManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'autohand-session-branching-'));
    manager = new SessionManager(tempDir);
    await manager.initialize();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('clones a full session into a new active branch', async () => {
    const source = await manager.createSession('/workspace/project', 'test-model');
    await source.append({ role: 'user', content: 'Build A', timestamp: '2026-01-01T00:00:00.000Z' });
    await source.append({ role: 'assistant', content: 'Done A', timestamp: '2026-01-01T00:00:01.000Z' });
    await source.updateState({
      workspaceRoot: '/workspace/project',
      workspaceFiles: ['src/a.ts'],
      contextUsed: 100,
      contextLimit: 1000,
    });

    const cloned = await manager.branchSession(source.metadata.sessionId, { type: 'clone' });

    expect(cloned.metadata.sessionId).not.toBe(source.metadata.sessionId);
    expect(cloned.metadata.projectPath).toBe('/workspace/project');
    expect(cloned.metadata.messageCount).toBe(2);
    expect(cloned.metadata.branch).toEqual(expect.objectContaining({
      type: 'clone',
      sourceSessionId: source.metadata.sessionId,
    }));
    expect(cloned.getMessages()).toEqual(source.getMessages());
    expect(cloned.getState()).toEqual(source.getState());
    expect(manager.getCurrentSession()?.metadata.sessionId).toBe(cloned.metadata.sessionId);
  });

  it('forks a session at a user-message ordinal', async () => {
    const source = await manager.createSession('/workspace/project', 'test-model');
    await source.append({ role: 'user', content: 'First turn', timestamp: '2026-01-01T00:00:00.000Z' });
    await source.append({ role: 'assistant', content: 'First answer', timestamp: '2026-01-01T00:00:01.000Z' });
    await source.append({ role: 'user', content: 'Second turn', timestamp: '2026-01-01T00:00:02.000Z' });
    await source.append({ role: 'assistant', content: 'Second answer', timestamp: '2026-01-01T00:00:03.000Z' });

    const forked = await manager.branchSession(source.metadata.sessionId, {
      type: 'fork',
      userMessageOrdinal: 2,
    });

    expect(forked.metadata.messageCount).toBe(3);
    expect(forked.getMessages().map((message) => message.content)).toEqual([
      'First turn',
      'First answer',
      'Second turn',
    ]);
    expect(forked.metadata.branch).toEqual(expect.objectContaining({
      type: 'fork',
      sourceSessionId: source.metadata.sessionId,
      sourceMessageIndex: 2,
      sourceUserMessageOrdinal: 2,
    }));
  });

  it('resolves full ids, partial ids, session directories, and conversation files', async () => {
    const source = await manager.createSession('/workspace/project', 'test-model');
    await source.append({ role: 'user', content: 'Hello', timestamp: '2026-01-01T00:00:00.000Z' });
    const sessionDir = path.join(tempDir, source.metadata.sessionId);
    const conversationPath = path.join(sessionDir, 'conversation.jsonl');

    expect(await manager.resolveSessionReference(source.metadata.sessionId)).toBe(source.metadata.sessionId);
    expect(await manager.resolveSessionReference(source.metadata.sessionId.slice(0, 8))).toBe(source.metadata.sessionId);
    expect(await manager.resolveSessionReference(sessionDir)).toBe(source.metadata.sessionId);
    expect(await manager.resolveSessionReference(conversationPath)).toBe(source.metadata.sessionId);
  });
});
