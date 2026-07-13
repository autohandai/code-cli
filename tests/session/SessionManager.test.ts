/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AUTOHAND_PATHS } from '../../src/constants.js';
import { BaseImporter } from '../../src/import/importers/BaseImporter.js';
import type { WriteSessionOptions } from '../../src/import/importers/BaseImporter.js';
import type {
  ImportCategory,
  ImportResult,
  ImportScanResult,
  ImportSource,
  ProgressCallback,
} from '../../src/import/types.js';
import { Session, SessionManager } from '../../src/session/SessionManager.js';
import type { SessionMetadata } from '../../src/session/types.js';

class SessionIndexTestImporter extends BaseImporter {
  readonly name: ImportSource = 'claude';
  readonly displayName = 'Test Importer';
  readonly homePath = '~/.test-importer';

  async scan(): Promise<ImportScanResult> {
    return { source: this.name, available: new Map() };
  }

  async import(
    _categories: ImportCategory[],
    _onProgress?: ProgressCallback,
  ): Promise<ImportResult> {
    return { source: this.name, imported: new Map(), errors: [], duration: 0 };
  }

  addToSessionIndex(metadata: SessionMetadata): Promise<void> {
    return this.updateSessionIndex(metadata);
  }

  writeSession(options: WriteSessionOptions): Promise<string | null> {
    return this.writeAutohandSession(options);
  }
}

describe('Session', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-session-test-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
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

  it('records cumulative turn usage metadata without changing message storage', async () => {
    const sessionDir = path.join(tmpDir, 'usage-session');
    const session = new Session(sessionDir, createMetadata());

    await session.recordTurnUsage({
      promptTokens: 100,
      completionTokens: 40,
      totalTokens: 140,
      tokenUsageStatus: 'actual',
      durationMs: 1_500,
      occurredAt: '2026-01-01T00:10:00.000Z',
    });
    await session.recordTurnUsage({
      promptTokens: 300,
      completionTokens: 200,
      totalTokens: 500,
      tokenUsageStatus: 'actual',
      durationMs: 4_000,
      occurredAt: '2026-01-01T00:20:00.000Z',
    });

    expect(session.metadata.usage).toEqual({
      promptTokens: 400,
      completionTokens: 240,
      totalTokens: 640,
      turnCount: 2,
      tokenUsageStatus: 'actual',
      longestTurnDurationMs: 4_000,
      updatedAt: '2026-01-01T00:20:00.000Z',
    });
    expect(session.metadata.messageCount).toBe(0);

    const saved = await fs.readJson(path.join(sessionDir, 'metadata.json')) as SessionMetadata;
    expect(saved.usage?.totalTokens).toBe(640);
  });
});

describe('SessionManager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-session-manager-test-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
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

  it.each([
    { sessions: 'not-an-array', byProject: {} },
    { sessions: [null], byProject: {} },
    { sessions: [], byProject: [] },
    { sessions: [], byProject: { '/workspace': 'not-an-array' } },
  ])('backs up and resets a structurally malformed session index: %j', async (malformedIndex) => {
    const indexPath = path.join(tmpDir, 'index.json');
    await fs.writeJson(indexPath, malformedIndex);

    const manager = new SessionManager(tmpDir);
    await expect(manager.initialize()).resolves.toBeUndefined();

    expect(await fs.readJson(indexPath)).toEqual({ sessions: [], byProject: {} });
    expect((await fs.readdir(tmpDir)).filter((file) => file.startsWith('index.json.corrupt-')))
      .toHaveLength(1);
  });

  it('merges concurrent updates from independently initialized managers', async () => {
    const first = new SessionManager(tmpDir);
    const second = new SessionManager(tmpDir);
    await Promise.all([first.initialize(), second.initialize()]);

    const [firstSession, secondSession] = await Promise.all([
      first.createSession('/workspace/first', 'test-model'),
      second.createSession('/workspace/second', 'test-model'),
    ]);

    const index = await fs.readJson(path.join(tmpDir, 'index.json')) as {
      sessions: Array<{ id: string }>;
      byProject: Record<string, string[]>;
    };
    expect(index.sessions.map((session) => session.id)).toEqual(expect.arrayContaining([
      firstSession.metadata.sessionId,
      secondSession.metadata.sessionId,
    ]));
    expect(index.byProject['/workspace/first']).toContain(firstSession.metadata.sessionId);
    expect(index.byProject['/workspace/second']).toContain(secondSession.metadata.sessionId);
  });

  it('merges concurrent SessionManager and BaseImporter index updates', async () => {
    const mutablePaths = AUTOHAND_PATHS as { sessions: string };
    const originalSessionsPath = mutablePaths.sessions;
    mutablePaths.sessions = tmpDir;
    const manager = new SessionManager(tmpDir);
    await manager.initialize();
    const importedMetadata: SessionMetadata = {
      sessionId: 'imported-session',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastActiveAt: '2026-01-01T00:00:00.000Z',
      projectPath: '/workspace/imported',
      projectName: 'imported',
      model: 'imported-model',
      messageCount: 1,
      status: 'completed',
      importedFrom: {
        source: 'claude',
        originalId: 'source-session',
        importedAt: '2026-01-01T00:00:00.000Z',
      },
    };

    try {
      const [, localSession] = await Promise.all([
        new SessionIndexTestImporter().addToSessionIndex(importedMetadata),
        manager.createSession('/workspace/local', 'test-model'),
      ]);
      const index = await fs.readJson(path.join(tmpDir, 'index.json')) as {
        sessions: Array<{
          id: string;
          importedFrom?: { source: string; originalId: string };
        }>;
      };

      expect(index.sessions.map((session) => session.id)).toEqual(expect.arrayContaining([
        'imported-session',
        localSession.metadata.sessionId,
      ]));
      expect(index.sessions.find((session) => session.id === 'imported-session')?.importedFrom)
        .toEqual({ source: 'claude', originalId: 'source-session' });
    } finally {
      mutablePaths.sessions = originalSessionsPath;
    }
  });

  it('deduplicates concurrent imports under the session-index lock', async () => {
    const mutablePaths = AUTOHAND_PATHS as { sessions: string };
    const originalSessionsPath = mutablePaths.sessions;
    mutablePaths.sessions = tmpDir;
    const options: WriteSessionOptions = {
      projectPath: '/workspace/imported',
      projectName: 'imported',
      model: 'test-model',
      messages: [{
        role: 'user',
        content: 'hello',
        timestamp: '2026-01-01T00:00:00.000Z',
      }],
      source: 'claude',
      originalId: 'same-source-session',
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    try {
      const results = await Promise.all([
        new SessionIndexTestImporter().writeSession(options),
        new SessionIndexTestImporter().writeSession(options),
      ]);
      const index = await fs.readJson(path.join(tmpDir, 'index.json')) as {
        sessions: Array<{ importedFrom?: { source: string; originalId: string } }>;
      };

      expect(results.filter((result) => result !== null)).toHaveLength(1);
      expect(index.sessions).toHaveLength(1);
      expect(index.sessions[0].importedFrom)
        .toEqual({ source: 'claude', originalId: 'same-source-session' });
    } finally {
      mutablePaths.sessions = originalSessionsPath;
    }
  });

  it('backs up a malformed index before an importer resets it', async () => {
    const mutablePaths = AUTOHAND_PATHS as { sessions: string };
    const originalSessionsPath = mutablePaths.sessions;
    mutablePaths.sessions = tmpDir;
    const malformedIndex = { sessions: [null], byProject: {} };
    await fs.writeJson(path.join(tmpDir, 'index.json'), malformedIndex);

    try {
      await new SessionIndexTestImporter().addToSessionIndex({
        sessionId: 'imported-session',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastActiveAt: '2026-01-01T00:00:00.000Z',
        projectPath: '/workspace/imported',
        projectName: 'imported',
        model: 'test-model',
        messageCount: 1,
        status: 'completed',
      });

      const backupFiles = (await fs.readdir(tmpDir))
        .filter((file) => file.startsWith('index.json.corrupt-'));
      expect(backupFiles).toHaveLength(1);
      expect(await fs.readJson(path.join(tmpDir, backupFiles[0]))).toEqual(malformedIndex);
    } finally {
      mutablePaths.sessions = originalSessionsPath;
    }
  });

  it('preserves the previous index when atomic replacement fails', async () => {
    const indexPath = path.join(tmpDir, 'index.json');
    const previousIndex = {
      sessions: [{
        id: 'existing-session',
        projectPath: '/workspace/existing',
        createdAt: '2026-01-01T00:00:00.000Z',
      }],
      byProject: { '/workspace/existing': ['existing-session'] },
    };
    await fs.writeJson(indexPath, previousIndex);
    const manager = new SessionManager(tmpDir);
    await manager.initialize();
    const originalRename = nodeFs.rename.bind(nodeFs);
    const rename = vi.spyOn(nodeFs, 'rename').mockImplementation(async (source, destination) => {
      if (destination === indexPath) {
        throw Object.assign(new Error('index commit failed'), { code: 'EIO' });
      }
      return originalRename(source, destination);
    });

    try {
      await expect(manager.createSession('/workspace/new', 'test-model'))
        .rejects.toThrow('index commit failed');
      expect(await fs.readJson(indexPath)).toEqual(previousIndex);
      expect((await fs.readdir(tmpDir)).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
    } finally {
      rename.mockRestore();
    }
  });

  it('loads the committed index when a crash left a truncated temporary file', async () => {
    const indexPath = path.join(tmpDir, 'index.json');
    await fs.writeJson(indexPath, { sessions: [], byProject: {} });
    await fs.writeFile(path.join(tmpDir, '.index.json.crashed.tmp'), '{"sessions":');

    const manager = new SessionManager(tmpDir);
    await expect(manager.initialize()).resolves.toBeUndefined();
    expect(await manager.listSessions()).toEqual([]);
    expect(await fs.readFile(path.join(tmpDir, '.index.json.crashed.tmp'), 'utf8'))
      .toBe('{"sessions":');
  });
});
