/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { Session, SessionManager } from '../../src/session/SessionManager.js';
import type { SessionMetadata } from '../../src/session/types.js';

describe('Session', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-session-test-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  function createMetadata(sessionId = 'session-1'): SessionMetadata {
    return {
      sessionId,
      createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      lastActiveAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      projectPath: tmpDir,
      projectName: path.basename(tmpDir),
      model: 'openrouter/test-model',
      messageCount: 0,
      status: 'active',
      client: 'terminal',
    };
  }

  it('recreates the session directory before appending messages', async () => {
    const sessionDir = path.join(tmpDir, 'missing-session');
    const session = new Session(sessionDir, createMetadata());

    await session.append({
      role: 'user',
      content: 'hello',
      timestamp: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    });

    expect(await fs.pathExists(path.join(sessionDir, 'conversation.jsonl'))).toBe(true);
    expect(await fs.pathExists(path.join(sessionDir, 'metadata.json'))).toBe(true);
    expect(session.metadata.messageCount).toBe(1);
  });
});

describe('SessionManager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-session-manager-test-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('recovers from a corrupt session index and initializes empty', async () => {
    const indexPath = path.join(tmpDir, 'index.json');
    const corruptContent = '{ "sessions": [\n  { "id": "broken\x00"';
    await fs.writeFile(indexPath, corruptContent);

    const manager = new SessionManager(tmpDir);
    await expect(manager.initialize()).resolves.toBeUndefined();

    const sessions = await manager.listSessions();
    expect(sessions).toEqual([]);

    const backupFiles = (await fs.readdir(tmpDir)).filter((f) => f.startsWith('index.json.corrupt-'));
    expect(backupFiles).toHaveLength(1);
    expect(await fs.readFile(path.join(tmpDir, backupFiles[0]), 'utf-8')).toBe(corruptContent);
  });

  it('recovers from an empty session index file', async () => {
    const indexPath = path.join(tmpDir, 'index.json');
    await fs.writeFile(indexPath, '');

    const manager = new SessionManager(tmpDir);
    await expect(manager.initialize()).resolves.toBeUndefined();

    const sessions = await manager.listSessions();
    expect(sessions).toEqual([]);

    const backupFiles = (await fs.readdir(tmpDir)).filter((f) => f.startsWith('index.json.corrupt-'));
    expect(backupFiles).toHaveLength(1);
  });
});
