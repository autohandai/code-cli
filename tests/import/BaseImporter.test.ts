/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import type { ImportSource, ImportCategory, ImportScanResult, ImportResult, ProgressCallback } from '../../src/import/types.js';
import type { SessionMessage } from '../../src/session/types.js';

// Mock fs-extra before importing BaseImporter
vi.mock('fs-extra', () => ({
  default: {
    pathExists: vi.fn(),
    readFile: vi.fn(),
    ensureDir: vi.fn(),
    writeJson: vi.fn(),
    readJson: vi.fn(),
    writeFile: vi.fn(),
  },
}));

// Mock crypto.randomUUID for deterministic session IDs
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    default: {
      ...actual,
      randomUUID: vi.fn().mockReturnValue('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
    },
  };
});

// Import after mocks are set up
import fse from 'fs-extra';
import { BaseImporter } from '../../src/import/importers/BaseImporter.js';
import type { WriteSessionOptions } from '../../src/import/importers/BaseImporter.js';

/**
 * Concrete test double for the abstract BaseImporter.
 */
class TestImporter extends BaseImporter {
  readonly name: ImportSource = 'claude';
  readonly displayName = 'Test Agent';
  readonly homePath = '~/.test-agent';

  async scan(): Promise<ImportScanResult> {
    return { source: this.name, available: new Map() };
  }

  async import(
    _categories: ImportCategory[],
    _onProgress?: ProgressCallback,
  ): Promise<ImportResult> {
    return { source: this.name, imported: new Map(), errors: [], duration: 0 };
  }

  // Expose protected helpers for testing
  public testReadJsonlFile(filePath: string) {
    return this.readJsonlFile(filePath);
  }

  public testWithRetry<T>(fn: () => Promise<T>, maxRetries?: number, baseDelay?: number) {
    return this.withRetry(fn, maxRetries, baseDelay);
  }

  public testWriteAutohandSession(opts: WriteSessionOptions) {
    return this.writeAutohandSession(opts);
  }

  public testUpdateSessionIndex(metadata: import('../../src/session/types.js').SessionMetadata) {
    return this.updateSessionIndex(metadata);
  }

  public testSafeReadJson<T = Record<string, unknown>>(filePath: string) {
    return this.safeReadJson<T>(filePath);
  }

  public testDelay(ms: number) {
    return this.delay(ms);
  }
}

/**
 * Test importer with an absolute homePath (no ~ prefix).
 */
class AbsolutePathImporter extends BaseImporter {
  readonly name: ImportSource = 'codex';
  readonly displayName = 'Absolute Path Agent';
  readonly homePath = '/opt/some-agent';

  async scan(): Promise<ImportScanResult> {
    return { source: this.name, available: new Map() };
  }

  async import(
    _categories: ImportCategory[],
    _onProgress?: ProgressCallback,
  ): Promise<ImportResult> {
    return { source: this.name, imported: new Map(), errors: [], duration: 0 };
  }
}

describe('BaseImporter', () => {
  let importer: TestImporter;

  beforeEach(() => {
    vi.clearAllMocks();
    importer = new TestImporter();
  });

  // ---------------------------------------------------------------
  // resolvedHomePath
  // ---------------------------------------------------------------
  describe('resolvedHomePath', () => {
    it('should expand ~ to os.homedir()', () => {
      const expected = path.join(os.homedir(), '.test-agent');
      expect(importer.resolvedHomePath).toBe(expected);
    });

    it('should return absolute path unchanged when no ~ prefix', () => {
      const abs = new AbsolutePathImporter();
      expect(abs.resolvedHomePath).toBe('/opt/some-agent');
    });

    it('should be idempotent (always returns the same value)', () => {
      const first = importer.resolvedHomePath;
      const second = importer.resolvedHomePath;
      expect(first).toBe(second);
    });
  });

  // ---------------------------------------------------------------
  // detect()
  // ---------------------------------------------------------------
  describe('detect()', () => {
    it('should return true when resolvedHomePath exists', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(true as never);

      const result = await importer.detect();
      expect(result).toBe(true);
      expect(fse.pathExists).toHaveBeenCalledWith(importer.resolvedHomePath);
    });

    it('should return false when resolvedHomePath does not exist', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const result = await importer.detect();
      expect(result).toBe(false);
      expect(fse.pathExists).toHaveBeenCalledWith(importer.resolvedHomePath);
    });
  });

  // ---------------------------------------------------------------
  // readJsonlFile()
  // ---------------------------------------------------------------
  describe('readJsonlFile()', () => {
    it('should parse valid JSONL with multiple records', async () => {
      const lines = [
        '{"role":"user","content":"hello"}',
        '{"role":"assistant","content":"hi"}',
      ].join('\n');

      vi.mocked(fse.readFile).mockResolvedValue(lines as never);

      const result = await importer.testReadJsonlFile('/tmp/test.jsonl');
      expect(result).toEqual([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ]);
    });

    it('should skip blank lines', async () => {
      const lines = [
        '{"a":1}',
        '',
        '   ',
        '{"b":2}',
      ].join('\n');

      vi.mocked(fse.readFile).mockResolvedValue(lines as never);

      const result = await importer.testReadJsonlFile('/tmp/blanks.jsonl');
      expect(result).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it('should skip malformed JSON lines without throwing', async () => {
      const lines = [
        '{"valid":true}',
        'NOT JSON AT ALL',
        '{broken',
        '{"also_valid":42}',
      ].join('\n');

      vi.mocked(fse.readFile).mockResolvedValue(lines as never);

      const result = await importer.testReadJsonlFile('/tmp/mixed.jsonl');
      expect(result).toEqual([{ valid: true }, { also_valid: 42 }]);
    });

    it('should return empty array for empty file', async () => {
      vi.mocked(fse.readFile).mockResolvedValue('' as never);

      const result = await importer.testReadJsonlFile('/tmp/empty.jsonl');
      expect(result).toEqual([]);
    });

    it('should handle trailing newline', async () => {
      const lines = '{"x":1}\n{"y":2}\n';
      vi.mocked(fse.readFile).mockResolvedValue(lines as never);

      const result = await importer.testReadJsonlFile('/tmp/trailing.jsonl');
      expect(result).toEqual([{ x: 1 }, { y: 2 }]);
    });
  });

  // ---------------------------------------------------------------
  // withRetry()
  // ---------------------------------------------------------------
  describe('withRetry()', () => {
    it('should return result on first successful call', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await importer.testWithRetry(fn, 3, 0);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry and succeed after transient failures', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('finally');

      const result = await importer.testWithRetry(fn, 3, 0);
      expect(result).toBe('finally');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw last error after all retries exhausted', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockRejectedValueOnce(new Error('fail 3'));

      await expect(importer.testWithRetry(fn, 3, 0)).rejects.toThrow('fail 3');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should default to 3 retries when maxRetries is not specified', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('1'))
        .mockRejectedValueOnce(new Error('2'))
        .mockRejectedValueOnce(new Error('3'));

      await expect(importer.testWithRetry(fn, undefined, 0)).rejects.toThrow('3');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should retry exactly once when maxRetries=1', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('always fails'));

      await expect(importer.testWithRetry(fn, 1, 0)).rejects.toThrow('always fails');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------
  // writeAutohandSession()
  // ---------------------------------------------------------------
  describe('writeAutohandSession()', () => {
    const baseOpts: WriteSessionOptions = {
      projectPath: '/home/user/my-project',
      projectName: 'my-project',
      model: 'anthropic/claude-3.5-sonnet',
      messages: [
        { role: 'user', content: 'hello', timestamp: '2025-01-01T00:00:00Z' },
        { role: 'assistant', content: 'hi', timestamp: '2025-01-01T00:00:01Z' },
      ] as SessionMessage[],
      source: 'claude',
      originalId: 'orig-123',
      createdAt: '2025-01-01T00:00:00Z',
      closedAt: '2025-01-01T01:00:00Z',
      summary: 'Test session',
      status: 'completed',
    };

    it('should create session directory under AUTOHAND_PATHS.sessions', async () => {
      vi.mocked(fse.ensureDir).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeJson).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeFile).mockResolvedValue(undefined as never);
      vi.mocked(fse.readJson).mockRejectedValue(new Error('not found') as never);
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const sessionId = await importer.testWriteAutohandSession(baseOpts);

      expect(sessionId).toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
      expect(fse.ensureDir).toHaveBeenCalled();
    });

    it('should write metadata.json with correct fields', async () => {
      vi.mocked(fse.ensureDir).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeJson).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeFile).mockResolvedValue(undefined as never);
      vi.mocked(fse.readJson).mockRejectedValue(new Error('not found') as never);
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      await importer.testWriteAutohandSession(baseOpts);

      // First writeJson call should be metadata.json
      const writeJsonCalls = vi.mocked(fse.writeJson).mock.calls;
      const metadataCall = writeJsonCalls.find(call =>
        (call[0] as string).endsWith('metadata.json'),
      );
      expect(metadataCall).toBeDefined();

      const metadata = metadataCall![1] as Record<string, unknown>;
      expect(metadata).toMatchObject({
        projectPath: '/home/user/my-project',
        projectName: 'my-project',
        model: 'anthropic/claude-3.5-sonnet',
        messageCount: 2,
        status: 'completed',
        summary: 'Test session',
      });

      // Check importedFrom provenance
      const importedFrom = metadata.importedFrom as Record<string, unknown>;
      expect(importedFrom.source).toBe('claude');
      expect(importedFrom.originalId).toBe('orig-123');
    });

    it('should write conversation.jsonl with one JSON line per message', async () => {
      vi.mocked(fse.ensureDir).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeJson).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeFile).mockResolvedValue(undefined as never);
      vi.mocked(fse.readJson).mockRejectedValue(new Error('not found') as never);
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      await importer.testWriteAutohandSession(baseOpts);

      const writeFileCalls = vi.mocked(fse.writeFile).mock.calls;
      const convCall = writeFileCalls.find(call =>
        (call[0] as string).endsWith('conversation.jsonl'),
      );
      expect(convCall).toBeDefined();

      const content = convCall![1] as string;
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);

      const msg0 = JSON.parse(lines[0]);
      expect(msg0.role).toBe('user');
      expect(msg0.content).toBe('hello');

      const msg1 = JSON.parse(lines[1]);
      expect(msg1.role).toBe('assistant');
      expect(msg1.content).toBe('hi');
    });

    it('should default status to "completed" when not provided', async () => {
      vi.mocked(fse.ensureDir).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeJson).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeFile).mockResolvedValue(undefined as never);
      vi.mocked(fse.readJson).mockRejectedValue(new Error('not found') as never);
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const { status, ...optsWithoutStatus } = baseOpts;
      await importer.testWriteAutohandSession(optsWithoutStatus);

      const writeJsonCalls = vi.mocked(fse.writeJson).mock.calls;
      const metadataCall = writeJsonCalls.find(call =>
        (call[0] as string).endsWith('metadata.json'),
      );
      const metadata = metadataCall![1] as Record<string, unknown>;
      expect(metadata.status).toBe('completed');
    });

    it('should return the session ID', async () => {
      vi.mocked(fse.ensureDir).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeJson).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeFile).mockResolvedValue(undefined as never);
      vi.mocked(fse.readJson).mockRejectedValue(new Error('not found') as never);
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const sessionId = await importer.testWriteAutohandSession(baseOpts);
      expect(typeof sessionId).toBe('string');
      expect(sessionId.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------
  // updateSessionIndex()
  // ---------------------------------------------------------------
  describe('updateSessionIndex()', () => {
    const mockMetadata = {
      sessionId: 'test-session-1',
      createdAt: '2025-01-01T00:00:00Z',
      lastActiveAt: '2025-01-01T01:00:00Z',
      projectPath: '/home/user/project',
      projectName: 'project',
      model: 'test-model',
      messageCount: 5,
      status: 'completed' as const,
      summary: 'A test session',
    };

    it('should create index.json when it does not exist', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);
      vi.mocked(fse.ensureDir).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeJson).mockResolvedValue(undefined as never);

      await importer.testUpdateSessionIndex(mockMetadata);

      const writeJsonCalls = vi.mocked(fse.writeJson).mock.calls;
      const indexCall = writeJsonCalls.find(call =>
        (call[0] as string).endsWith('index.json'),
      );
      expect(indexCall).toBeDefined();

      const index = indexCall![1] as Record<string, unknown>;
      const sessions = index.sessions as Array<Record<string, unknown>>;
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('test-session-1');
      expect(sessions[0].projectPath).toBe('/home/user/project');
    });

    it('should append to existing index.json', async () => {
      const existingIndex = {
        sessions: [
          { id: 'old-session', projectPath: '/old/path', createdAt: '2024-01-01T00:00:00Z' },
        ],
        byProject: { '/old/path': ['old-session'] },
      };

      vi.mocked(fse.pathExists).mockResolvedValue(true as never);
      vi.mocked(fse.readJson).mockResolvedValue(existingIndex as never);
      vi.mocked(fse.ensureDir).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeJson).mockResolvedValue(undefined as never);

      await importer.testUpdateSessionIndex(mockMetadata);

      const writeJsonCalls = vi.mocked(fse.writeJson).mock.calls;
      const indexCall = writeJsonCalls.find(call =>
        (call[0] as string).endsWith('index.json'),
      );
      const index = indexCall![1] as Record<string, unknown>;
      const sessions = index.sessions as Array<Record<string, unknown>>;
      expect(sessions).toHaveLength(2);
      expect(sessions[1].id).toBe('test-session-1');
    });

    it('should group sessions by project path', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);
      vi.mocked(fse.ensureDir).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeJson).mockResolvedValue(undefined as never);

      await importer.testUpdateSessionIndex(mockMetadata);

      const writeJsonCalls = vi.mocked(fse.writeJson).mock.calls;
      const indexCall = writeJsonCalls.find(call =>
        (call[0] as string).endsWith('index.json'),
      );
      const index = indexCall![1] as Record<string, unknown>;
      const byProject = index.byProject as Record<string, string[]>;
      expect(byProject['/home/user/project']).toContain('test-session-1');
    });

    it('should recover gracefully when index.json exists but is corrupted', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(true as never);
      // Simulate corrupted/empty JSON file — fse.readJson throws SyntaxError
      vi.mocked(fse.readJson).mockRejectedValue(
        new SyntaxError('Unexpected end of JSON input') as never,
      );
      vi.mocked(fse.ensureDir).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeJson).mockResolvedValue(undefined as never);

      // Should NOT throw — should reset to empty index and continue
      await importer.testUpdateSessionIndex(mockMetadata);

      const writeJsonCalls = vi.mocked(fse.writeJson).mock.calls;
      const indexCall = writeJsonCalls.find(call =>
        (call[0] as string).endsWith('index.json'),
      );
      expect(indexCall).toBeDefined();

      const index = indexCall![1] as Record<string, unknown>;
      const sessions = index.sessions as Array<Record<string, unknown>>;
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('test-session-1');
    });

    it('should recover gracefully when index.json contains invalid structure', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(true as never);
      // File contains valid JSON but wrong structure (string instead of object)
      vi.mocked(fse.readJson).mockResolvedValue('not an object' as never);
      vi.mocked(fse.ensureDir).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeJson).mockResolvedValue(undefined as never);

      await importer.testUpdateSessionIndex(mockMetadata);

      const writeJsonCalls = vi.mocked(fse.writeJson).mock.calls;
      const indexCall = writeJsonCalls.find(call =>
        (call[0] as string).endsWith('index.json'),
      );
      expect(indexCall).toBeDefined();

      const index = indexCall![1] as Record<string, unknown>;
      const sessions = index.sessions as Array<Record<string, unknown>>;
      expect(sessions).toHaveLength(1);
    });

    it('should recover when index.json has sessions as non-array', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(true as never);
      vi.mocked(fse.readJson).mockResolvedValue({
        sessions: 'corrupted',
        byProject: {},
      } as never);
      vi.mocked(fse.ensureDir).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeJson).mockResolvedValue(undefined as never);

      await importer.testUpdateSessionIndex(mockMetadata);

      const writeJsonCalls = vi.mocked(fse.writeJson).mock.calls;
      const indexCall = writeJsonCalls.find(call =>
        (call[0] as string).endsWith('index.json'),
      );
      const index = indexCall![1] as Record<string, unknown>;
      const sessions = index.sessions as Array<Record<string, unknown>>;
      expect(Array.isArray(sessions)).toBe(true);
      expect(sessions).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------
  // Deduplication
  // ---------------------------------------------------------------
  describe('deduplication', () => {
    const baseOpts: WriteSessionOptions = {
      projectPath: '/home/user/my-project',
      projectName: 'my-project',
      model: 'anthropic/claude-3.5-sonnet',
      messages: [
        { role: 'user', content: 'hello', timestamp: '2025-01-01T00:00:00Z' },
        { role: 'assistant', content: 'hi', timestamp: '2025-01-01T00:00:01Z' },
      ] as SessionMessage[],
      source: 'claude',
      originalId: 'orig-session-42',
      createdAt: '2025-01-01T00:00:00Z',
      closedAt: '2025-01-01T01:00:00Z',
      summary: 'Test session',
      status: 'completed',
    };

    it('should return null and skip writing when session with same source+originalId exists in index', async () => {
      // Index already has this session imported
      const existingIndex = {
        sessions: [
          {
            id: 'existing-session-id',
            projectPath: '/home/user/my-project',
            createdAt: '2025-01-01T00:00:00Z',
            summary: 'Test session',
            importedFrom: { source: 'claude', originalId: 'orig-session-42' },
          },
        ],
        byProject: { '/home/user/my-project': ['existing-session-id'] },
      };

      vi.mocked(fse.pathExists).mockResolvedValue(true as never);
      vi.mocked(fse.readJson).mockResolvedValue(existingIndex as never);
      vi.mocked(fse.ensureDir).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeJson).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeFile).mockResolvedValue(undefined as never);

      const result = await importer.testWriteAutohandSession(baseOpts);
      expect(result).toBeNull();

      // Should NOT have written any session files
      const writeJsonCalls = vi.mocked(fse.writeJson).mock.calls;
      const metadataCall = writeJsonCalls.find(call =>
        (call[0] as string).endsWith('metadata.json'),
      );
      expect(metadataCall).toBeUndefined();
    });

    it('should import normally when originalId differs from existing', async () => {
      const existingIndex = {
        sessions: [
          {
            id: 'existing-session-id',
            projectPath: '/home/user/my-project',
            createdAt: '2025-01-01T00:00:00Z',
            importedFrom: { source: 'claude', originalId: 'different-id' },
          },
        ],
        byProject: { '/home/user/my-project': ['existing-session-id'] },
      };

      vi.mocked(fse.pathExists).mockResolvedValue(true as never);
      vi.mocked(fse.readJson).mockResolvedValue(existingIndex as never);
      vi.mocked(fse.ensureDir).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeJson).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeFile).mockResolvedValue(undefined as never);

      const result = await importer.testWriteAutohandSession(baseOpts);
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
    });

    it('should import normally when source differs from existing', async () => {
      const existingIndex = {
        sessions: [
          {
            id: 'existing-session-id',
            projectPath: '/home/user/my-project',
            createdAt: '2025-01-01T00:00:00Z',
            importedFrom: { source: 'codex', originalId: 'orig-session-42' },
          },
        ],
        byProject: { '/home/user/my-project': ['existing-session-id'] },
      };

      vi.mocked(fse.pathExists).mockResolvedValue(true as never);
      vi.mocked(fse.readJson).mockResolvedValue(existingIndex as never);
      vi.mocked(fse.ensureDir).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeJson).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeFile).mockResolvedValue(undefined as never);

      const result = await importer.testWriteAutohandSession(baseOpts);
      expect(result).not.toBeNull();
    });

    it('should import normally when index has no importedFrom on existing entries (pre-dedup index)', async () => {
      const existingIndex = {
        sessions: [
          {
            id: 'old-session',
            projectPath: '/home/user/my-project',
            createdAt: '2025-01-01T00:00:00Z',
            // No importedFrom field (legacy entry)
          },
        ],
        byProject: { '/home/user/my-project': ['old-session'] },
      };

      vi.mocked(fse.pathExists).mockResolvedValue(true as never);
      vi.mocked(fse.readJson).mockResolvedValue(existingIndex as never);
      vi.mocked(fse.ensureDir).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeJson).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeFile).mockResolvedValue(undefined as never);

      const result = await importer.testWriteAutohandSession(baseOpts);
      expect(result).not.toBeNull();
    });

    it('should store importedFrom in index entry for future dedup checks', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);
      vi.mocked(fse.ensureDir).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeJson).mockResolvedValue(undefined as never);
      vi.mocked(fse.writeFile).mockResolvedValue(undefined as never);

      await importer.testWriteAutohandSession(baseOpts);

      const writeJsonCalls = vi.mocked(fse.writeJson).mock.calls;
      const indexCall = writeJsonCalls.find(call =>
        (call[0] as string).endsWith('index.json'),
      );
      expect(indexCall).toBeDefined();

      const index = indexCall![1] as Record<string, unknown>;
      const sessions = index.sessions as Array<Record<string, unknown>>;
      const lastEntry = sessions[sessions.length - 1];
      expect(lastEntry.importedFrom).toEqual({
        source: 'claude',
        originalId: 'orig-session-42',
      });
    });
  });

  // ---------------------------------------------------------------
  // safeReadJson()
  // ---------------------------------------------------------------
  describe('safeReadJson()', () => {
    it('should parse valid JSON file', async () => {
      vi.mocked(fse.readFile).mockResolvedValue('{"key": "value"}' as never);

      const result = await importer.testSafeReadJson('/tmp/valid.json');
      expect(result).toEqual({ key: 'value' });
    });

    it('should throw descriptive error for empty file', async () => {
      vi.mocked(fse.readFile).mockResolvedValue('' as never);

      await expect(importer.testSafeReadJson('/tmp/empty.json'))
        .rejects.toThrow('File is empty: empty.json');
    });

    it('should throw descriptive error for whitespace-only file', async () => {
      vi.mocked(fse.readFile).mockResolvedValue('   \n  \t  ' as never);

      await expect(importer.testSafeReadJson('/tmp/blank.json'))
        .rejects.toThrow('File is empty: blank.json');
    });

    it('should throw descriptive error for corrupted JSON', async () => {
      vi.mocked(fse.readFile).mockResolvedValue('{broken' as never);

      await expect(importer.testSafeReadJson('/tmp/broken.json'))
        .rejects.toThrow(/Invalid JSON in broken\.json/);
    });

    it('should parse arrays, not just objects', async () => {
      vi.mocked(fse.readFile).mockResolvedValue('[1, 2, 3]' as never);

      const result = await importer.testSafeReadJson('/tmp/array.json');
      expect(result).toEqual([1, 2, 3]);
    });
  });

  // ---------------------------------------------------------------
  // delay()
  // ---------------------------------------------------------------
  describe('delay()', () => {
    it('should resolve after the specified time', async () => {
      vi.useFakeTimers();

      const promise = importer.testDelay(100);
      vi.advanceTimersByTime(100);
      await promise; // should not hang

      vi.useRealTimers();
    });
  });
});
