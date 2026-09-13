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

describe('SessionManager.resolveSessionReference by name', () => {
  let tempDir: string;
  let manager: SessionManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-resolve-name-'));
    manager = new SessionManager(tempDir);
    await manager.initialize();
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  it('resolves a saved name exactly and case-insensitively', async () => {
    const session = await manager.createSession('/workspace/project', 'test-model');
    await manager.renameCurrentSession('Ship the caret fix');
    await manager.closeSession();

    expect(await manager.resolveSessionReference('Ship the caret fix')).toBe(session.metadata.sessionId);
    expect(await manager.resolveSessionReference('  ship the CARET fix ')).toBe(session.metadata.sessionId);
  });

  it('prefers a saved name over an id prefix that happens to match', async () => {
    const first = await manager.createSession('/workspace/project', 'test-model');
    await manager.closeSession();
    const second = await manager.createSession('/workspace/project', 'test-model');
    // Name the second session after the first session's id prefix.
    const prefix = first.metadata.sessionId.slice(0, 8);
    await manager.renameCurrentSession(prefix);
    await manager.closeSession();

    expect(await manager.resolveSessionReference(prefix)).toBe(second.metadata.sessionId);
    expect(await manager.resolveSessionReference(first.metadata.sessionId)).toBe(first.metadata.sessionId);
  });

  it('rejects a name shared by several sessions and lists their id prefixes', async () => {
    const first = await manager.createSession('/workspace/a', 'test-model');
    await manager.renameCurrentSession('Weekly report');
    await manager.closeSession();
    const second = await manager.createSession('/workspace/b', 'test-model');
    await manager.renameCurrentSession('weekly report');
    await manager.closeSession();

    await expect(manager.resolveSessionReference('Weekly report')).rejects.toThrow(
      new RegExp(`Ambiguous session name "Weekly report": matches 2 sessions \\((?=.*${first.metadata.sessionId.slice(0, 8)})(?=.*${second.metadata.sessionId.slice(0, 8)})`),
    );
  });

  it('still reports a missing reference when no name or id matches', async () => {
    await manager.createSession('/workspace/project', 'test-model');
    await manager.renameCurrentSession('Named');
    await manager.closeSession();
    await expect(manager.resolveSessionReference('Unnamed')).rejects.toThrow('Session not found: Unnamed');
  });
});
