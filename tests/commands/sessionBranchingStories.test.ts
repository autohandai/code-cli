/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloneSession, forkSession, sessionTree } from '../../src/commands/sessionBranching.js';
import { setFeatureState } from '../../src/features/featureRegistry.js';
import { SessionManager, type Session } from '../../src/session/SessionManager.js';
import type { SlashCommandContext } from '../../src/core/slashCommandTypes.js';
import type { LoadedConfig } from '../../src/types.js';

describe('session branching user stories', () => {
  let tempDir: string;
  let manager: SessionManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'autohand-session-branching-story-'));
    manager = new SessionManager(tempDir);
    await manager.initialize();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('lets a user enable fork and clone, branch from a real session, clone the branch, then inspect the tree', async () => {
    const config: LoadedConfig = {
      configPath: path.join(tempDir, 'config.json'),
      provider: 'openrouter',
    };
    expect(setFeatureState(config, 'experimental_fork', true).ok).toBe(true);
    expect(setFeatureState(config, 'experimental_clone', true).ok).toBe(true);

    const source = await manager.createSession('/workspace/project', 'test-model');
    await source.append({ role: 'user', content: 'Build the first version', timestamp: '2026-01-01T00:00:00.000Z' });
    await source.append({ role: 'assistant', content: 'First version done', timestamp: '2026-01-01T00:00:01.000Z' });
    await source.append({ role: 'user', content: 'Try the risky alternative', timestamp: '2026-01-01T00:00:02.000Z' });
    await source.append({ role: 'assistant', content: 'Alternative done', timestamp: '2026-01-01T00:00:03.000Z' });

    const restoredSessions: string[] = [];
    const makeContext = (currentSession?: Session): SlashCommandContext => ({
      promptModelSelection: vi.fn(),
      createAgentsFile: vi.fn(),
      resetConversation: vi.fn(),
      sessionManager: manager,
      currentSession,
      memoryManager: {} as SlashCommandContext['memoryManager'],
      permissionManager: {} as SlashCommandContext['permissionManager'],
      llm: {} as SlashCommandContext['llm'],
      workspaceRoot: '/workspace/project',
      model: 'test-model',
      config,
      restoreSession: async (sessionId: string) => {
        restoredSessions.push(sessionId);
      },
    });

    const forkOutput = await forkSession(makeContext(source), ['2']);
    const forked = manager.getCurrentSession();
    expect(forked).toBeDefined();
    expect(forkOutput).toContain('Forked session');
    expect(forked?.getMessages().map((message) => message.content)).toEqual([
      'Build the first version',
      'First version done',
      'Try the risky alternative',
    ]);

    const cloneOutput = await cloneSession(makeContext(forked));
    const cloned = manager.getCurrentSession();
    expect(cloned).toBeDefined();
    expect(cloneOutput).toContain('Cloned session');
    expect(cloned?.getMessages()).toEqual(forked?.getMessages());

    const treeOutput = await sessionTree(makeContext(cloned));
    expect(treeOutput).toContain(source.metadata.sessionId);
    expect(treeOutput).toContain(forked!.metadata.sessionId);
    expect(treeOutput).toContain(cloned!.metadata.sessionId);
    expect(treeOutput).toContain('fork at user message 2');
    expect(restoredSessions).toEqual([
      forked!.metadata.sessionId,
      cloned!.metadata.sessionId,
    ]);
  });
});
