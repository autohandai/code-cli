/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';

vi.mock('fs-extra', () => ({
  default: {
    pathExists: vi.fn().mockResolvedValue(false),
    readFile: vi.fn(),
    readdir: vi.fn().mockResolvedValue([]),
    readJson: vi.fn(),
    ensureDir: vi.fn().mockResolvedValue(undefined),
    writeJson: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock node:sqlite DatabaseSync – use vi.hoisted() so the variable
// is available when vi.mock() factory runs (vi.mock is hoisted above all other code).
const { mockPrepare, mockClose, MockDatabaseSync } = vi.hoisted(() => {
  const mockPrepare = vi.fn();
  const mockClose = vi.fn();
  const MockDatabaseSync = vi.fn().mockImplementation(() => ({
    prepare: mockPrepare,
    close: mockClose,
  }));
  return { mockPrepare, mockClose, MockDatabaseSync };
});

vi.mock('node:sqlite', () => ({
  DatabaseSync: MockDatabaseSync,
}));

import fse from 'fs-extra';
import { CursorImporter } from '../../src/import/importers/CursorImporter.js';

const HOME = os.homedir();
const CURSOR_HOME = path.join(HOME, '.cursor');

describe('CursorImporter', () => {
  let importer: CursorImporter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReset();
    mockClose.mockReset();
    // mockReset (not mockClear) to restore implementation after tests
    // that override MockDatabaseSync.mockImplementation directly
    MockDatabaseSync.mockReset();
    MockDatabaseSync.mockImplementation(() => ({
      prepare: mockPrepare,
      close: mockClose,
    }));
    importer = new CursorImporter();
  });

  // ---------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------
  describe('identity', () => {
    it('should have name "cursor"', () => {
      expect(importer.name).toBe('cursor');
    });

    it('should have displayName "Cursor"', () => {
      expect(importer.displayName).toBe('Cursor');
    });

    it('should have homePath "~/.cursor"', () => {
      expect(importer.homePath).toBe('~/.cursor');
    });
  });

  // ---------------------------------------------------------------
  // scan()
  // ---------------------------------------------------------------
  describe('scan()', () => {
    it('should return empty available map when ~/.cursor does not exist', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const result = await importer.scan();
      expect(result.source).toBe('cursor');
      expect(result.available.size).toBe(0);
    });

    it('should detect hooks.json as settings', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CURSOR_HOME) return true;
        if (s === path.join(CURSOR_HOME, 'hooks.json')) return true;
        if (s === path.join(CURSOR_HOME, 'mcp.json')) return false;
        return false;
      });

      const result = await importer.scan();
      const settings = result.available.get('settings');
      expect(settings).toBeDefined();
      expect(settings!.count).toBeGreaterThanOrEqual(1);
    });

    it('should detect mcp.json', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CURSOR_HOME) return true;
        if (s === path.join(CURSOR_HOME, 'mcp.json')) return true;
        if (s === path.join(CURSOR_HOME, 'hooks.json')) return false;
        return false;
      });

      const result = await importer.scan();
      const mcp = result.available.get('mcp');
      expect(mcp).toBeDefined();
      expect(mcp!.count).toBe(1);
    });

    it('should detect hooks from hooks.json', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CURSOR_HOME) return true;
        if (s === path.join(CURSOR_HOME, 'hooks.json')) return true;
        if (s === path.join(CURSOR_HOME, 'mcp.json')) return false;
        return false;
      });

      const result = await importer.scan();
      const hooks = result.available.get('hooks');
      expect(hooks).toBeDefined();
    });
  });

  // ---------------------------------------------------------------
  // import() – settings
  // ---------------------------------------------------------------
  describe('import() - settings', () => {
    it('should import settings from hooks.json', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CURSOR_HOME) return true;
        if (s === path.join(CURSOR_HOME, 'hooks.json')) return true;
        return false;
      });

      vi.mocked(fse.readFile).mockImplementation(async (p: string) => {
        if (String(p).endsWith('hooks.json')) {
          return JSON.stringify({ hooks: [{ event: 'onSave', command: 'lint' }] }) as never;
        }
        throw new Error('not found');
      });

      const result = await importer.import(['settings']);
      expect(result.imported.get('settings')!.success).toBe(1);
    });

    it('should handle missing hooks.json', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const result = await importer.import(['settings']);
      expect(result.imported.get('settings')!.skipped).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // import() – mcp
  // ---------------------------------------------------------------
  describe('import() - mcp', () => {
    it('should import MCP server configurations', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CURSOR_HOME) return true;
        if (s === path.join(CURSOR_HOME, 'mcp.json')) return true;
        return false;
      });

      vi.mocked(fse.readFile).mockImplementation(async (p: string) => {
        if (String(p).endsWith('mcp.json')) {
          return JSON.stringify({
            mcpServers: {
              filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
            },
          }) as never;
        }
        throw new Error('not found');
      });

      const result = await importer.import(['mcp']);
      expect(result.imported.get('mcp')!.success).toBe(1);
    });

    it('should handle missing mcp.json', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const result = await importer.import(['mcp']);
      expect(result.imported.get('mcp')!.skipped).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // import() – hooks
  // ---------------------------------------------------------------
  describe('import() - hooks', () => {
    it('should extract hook configurations', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CURSOR_HOME) return true;
        if (s === path.join(CURSOR_HOME, 'hooks.json')) return true;
        return false;
      });

      vi.mocked(fse.readFile).mockImplementation(async (p: string) => {
        if (String(p).endsWith('hooks.json')) {
          return JSON.stringify({ hooks: [{ event: 'onSave', command: 'lint' }] }) as never;
        }
        throw new Error('not found');
      });

      const result = await importer.import(['hooks']);
      expect(result.imported.get('hooks')!.success).toBe(1);
    });

    it('should handle missing hooks.json for hooks', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const result = await importer.import(['hooks']);
      expect(result.imported.get('hooks')!.skipped).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // scan() – skills-cursor detection
  // ---------------------------------------------------------------
  describe('scan() - skills', () => {
    it('should detect skills-cursor directory with subdirectories', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CURSOR_HOME) return true;
        if (s === path.join(CURSOR_HOME, 'skills-cursor')) return true;
        return false;
      });
      vi.mocked(fse.readdir).mockResolvedValue([
        { name: 'create-rule', isDirectory: () => true, isFile: () => false },
        { name: 'create-skill', isDirectory: () => true, isFile: () => false },
        { name: 'create-subagent', isDirectory: () => true, isFile: () => false },
      ] as never);

      const result = await importer.scan();
      const skills = result.available.get('skills');
      expect(skills).toBeDefined();
      expect(skills!.count).toBe(3);
      expect(skills!.description).toContain('skill');
    });

    it('should not report skills when skills-cursor does not exist', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CURSOR_HOME) return true;
        return false;
      });

      const result = await importer.scan();
      expect(result.available.has('skills')).toBe(false);
    });

    it('should not report skills when skills-cursor is empty', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CURSOR_HOME) return true;
        if (s === path.join(CURSOR_HOME, 'skills-cursor')) return true;
        return false;
      });
      vi.mocked(fse.readdir).mockResolvedValue([] as never);

      const result = await importer.scan();
      expect(result.available.has('skills')).toBe(false);
    });

    it('should only count directories, not files like .DS_Store', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CURSOR_HOME) return true;
        if (s === path.join(CURSOR_HOME, 'skills-cursor')) return true;
        return false;
      });
      vi.mocked(fse.readdir).mockResolvedValue([
        { name: 'create-rule', isDirectory: () => true, isFile: () => false },
        { name: '.DS_Store', isDirectory: () => false, isFile: () => true },
        { name: 'README.md', isDirectory: () => false, isFile: () => true },
      ] as never);

      const result = await importer.scan();
      expect(result.available.get('skills')!.count).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // scan() – cli-config.json detection
  // ---------------------------------------------------------------
  describe('scan() - cli-config.json', () => {
    it('should detect cli-config.json as settings source', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CURSOR_HOME) return true;
        if (s === path.join(CURSOR_HOME, 'cli-config.json')) return true;
        return false;
      });

      const result = await importer.scan();
      const settings = result.available.get('settings');
      expect(settings).toBeDefined();
      expect(settings!.description).toContain('CLI');
    });

    it('should report both settings sources when hooks.json and cli-config.json exist', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CURSOR_HOME) return true;
        if (s === path.join(CURSOR_HOME, 'hooks.json')) return true;
        if (s === path.join(CURSOR_HOME, 'cli-config.json')) return true;
        return false;
      });

      const result = await importer.scan();
      expect(result.available.has('settings')).toBe(true);
      // count should reflect both files
      expect(result.available.get('settings')!.count).toBe(2);
    });
  });

  // ---------------------------------------------------------------
  // import() – settings from cli-config.json
  // ---------------------------------------------------------------
  describe('import() - settings from cli-config.json', () => {
    it('should prefer cli-config.json when it exists', async () => {
      const cliConfig = {
        model: { modelId: 'claude-4.6-opus', displayName: 'Claude 4.6 Opus' },
        permissions: { allow: ['Shell(ls)'], deny: [] },
        approvalMode: 'allowlist',
      };

      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s.endsWith('cli-config.json')) return true;
        if (s.endsWith('hooks.json')) return true;
        return true;
      });
      vi.mocked(fse.readFile).mockImplementation(async (p: string) => {
        if (String(p).endsWith('cli-config.json')) {
          return JSON.stringify(cliConfig) as never;
        }
        if (String(p).endsWith('hooks.json')) {
          return JSON.stringify({ hooks: {} }) as never;
        }
        throw new Error('not found');
      });

      const result = await importer.import(['settings']);
      expect(result.imported.get('settings')!.success).toBe(1);
      expect(result.imported.get('settings')!.failed).toBe(0);

      // Should write the imported settings JSON
      const writeJsonCalls = vi.mocked(fse.writeJson).mock.calls;
      const settingsCall = writeJsonCalls.find(call =>
        String(call[0]).includes('imported-cursor-settings')
      );
      expect(settingsCall).toBeDefined();
      // The written data should include the cli-config data
      const written = settingsCall![1] as Record<string, unknown>;
      expect(written.importedFrom).toBe('cursor');
      expect(written.raw).toBeDefined();
    });

    it('should fall back to hooks.json when cli-config.json is missing', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s.endsWith('cli-config.json')) return false;
        if (s.endsWith('hooks.json')) return true;
        return true;
      });
      vi.mocked(fse.readFile).mockImplementation(async (p: string) => {
        if (String(p).endsWith('hooks.json')) {
          return JSON.stringify({ hooks: {} }) as never;
        }
        throw new Error('not found');
      });

      const result = await importer.import(['settings']);
      expect(result.imported.get('settings')!.success).toBe(1);
    });

    it('should handle malformed cli-config.json', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(true as never);
      vi.mocked(fse.readFile).mockImplementation(async (p: string) => {
        if (String(p).endsWith('cli-config.json')) return 'not{valid' as never;
        if (String(p).endsWith('hooks.json')) return JSON.stringify({}) as never;
        throw new Error('not found');
      });

      const result = await importer.import(['settings']);
      expect(result.imported.get('settings')!.failed).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle empty cli-config.json', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(true as never);
      vi.mocked(fse.readFile).mockImplementation(async (p: string) => {
        if (String(p).endsWith('cli-config.json')) return '' as never;
        return JSON.stringify({}) as never;
      });

      const result = await importer.import(['settings']);
      expect(result.imported.get('settings')!.failed).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // import() – skills
  // ---------------------------------------------------------------
  describe('import() - skills', () => {
    it('should import skill directories from skills-cursor', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(true as never);
      vi.mocked(fse.readdir).mockResolvedValue([
        { name: 'create-rule', isDirectory: () => true, isFile: () => false },
        { name: 'create-skill', isDirectory: () => true, isFile: () => false },
      ] as never);

      const result = await importer.import(['skills']);
      expect(result.imported.get('skills')!.success).toBe(2);
      expect(result.imported.get('skills')!.failed).toBe(0);
      expect(fse.copy).toHaveBeenCalledTimes(2);
    });

    it('should skip non-directory entries', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(true as never);
      vi.mocked(fse.readdir).mockResolvedValue([
        { name: 'create-rule', isDirectory: () => true, isFile: () => false },
        { name: '.DS_Store', isDirectory: () => false, isFile: () => true },
      ] as never);

      const result = await importer.import(['skills']);
      expect(result.imported.get('skills')!.success).toBe(1);
      expect(fse.copy).toHaveBeenCalledTimes(1);
    });

    it('should skip when skills-cursor does not exist', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const result = await importer.import(['skills']);
      expect(result.imported.get('skills')!.skipped).toBe(1);
    });

    it('should handle copy errors for individual skills', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(true as never);
      vi.mocked(fse.readdir).mockResolvedValue([
        { name: 'good-skill', isDirectory: () => true, isFile: () => false },
        { name: 'bad-skill', isDirectory: () => true, isFile: () => false },
      ] as never);
      let callCount = 0;
      vi.mocked(fse.copy).mockImplementation(async () => {
        callCount++;
        if (callCount === 2) throw new Error('EACCES: permission denied');
      });

      const result = await importer.import(['skills']);
      expect(result.imported.get('skills')!.success).toBe(1);
      expect(result.imported.get('skills')!.failed).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].category).toBe('skills');
      expect(result.errors[0].retriable).toBe(true);
    });

    it('should fire progress callbacks for each skill', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(true as never);
      vi.mocked(fse.readdir).mockResolvedValue([
        { name: 'skill-a', isDirectory: () => true, isFile: () => false },
        { name: 'skill-b', isDirectory: () => true, isFile: () => false },
      ] as never);

      const progress: Array<{ category: string; item: string; status: string }> = [];
      await importer.import(['skills'], (p) => progress.push(p));

      const skillProgress = progress.filter(p => p.category === 'skills');
      expect(skillProgress.length).toBeGreaterThanOrEqual(2);
      expect(skillProgress.some(p => p.item === 'skill-a' && p.status === 'importing')).toBe(true);
    });

    it('should copy to imported-cursor subdirectory in autohand skills', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(true as never);
      vi.mocked(fse.readdir).mockResolvedValue([
        { name: 'create-rule', isDirectory: () => true, isFile: () => false },
      ] as never);

      await importer.import(['skills']);

      const copyCalls = vi.mocked(fse.copy).mock.calls;
      expect(copyCalls.length).toBe(1);
      const [src, dest] = copyCalls[0];
      expect(String(src)).toContain('skills-cursor');
      expect(String(src)).toContain('create-rule');
      expect(String(dest)).toContain('imported-cursor');
    });
  });

  // ---------------------------------------------------------------
  // import() – all categories together
  // ---------------------------------------------------------------
  describe('import() - multiple categories', () => {
    it('should import all supported categories at once', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(true as never);
      vi.mocked(fse.readFile).mockResolvedValue('{"version":1}' as never);
      vi.mocked(fse.readdir).mockResolvedValue([
        { name: 'a-skill', isDirectory: () => true, isFile: () => false },
      ] as never);

      const result = await importer.import(['settings', 'hooks', 'mcp', 'skills']);
      expect(result.imported.size).toBe(4);
      expect(result.source).toBe('cursor');
      expect(typeof result.duration).toBe('number');
    });

    it('should silently skip unsupported categories', async () => {
      const result = await importer.import(['memory']);
      expect(result.errors.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------
  describe('error handling', () => {
    it('should not throw when hooks.json is malformed', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CURSOR_HOME) return true;
        if (s === path.join(CURSOR_HOME, 'hooks.json')) return true;
        return false;
      });

      vi.mocked(fse.readFile).mockRejectedValue(new Error('invalid json') as never);

      const result = await importer.import(['settings']);
      expect(result.imported.get('settings')!.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------
  // scan() – sessions detection
  // ---------------------------------------------------------------
  describe('scan() - sessions', () => {
    it('should detect sessions from chats directory', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CURSOR_HOME) return true;
        if (s === path.join(CURSOR_HOME, 'chats')) return true;
        return false;
      });

      // Two hash dirs, each with one UUID subdir containing store.db
      vi.mocked(fse.readdir).mockImplementation(async (p: string, _opts?: unknown) => {
        const s = String(p);
        if (s === path.join(CURSOR_HOME, 'chats')) {
          return [
            { name: 'abc123', isDirectory: () => true, isFile: () => false },
            { name: 'def456', isDirectory: () => true, isFile: () => false },
          ] as never;
        }
        if (s.includes('abc123')) {
          return [
            { name: 'uuid-1111', isDirectory: () => true, isFile: () => false },
          ] as never;
        }
        if (s.includes('def456')) {
          return [
            { name: 'uuid-2222', isDirectory: () => true, isFile: () => false },
          ] as never;
        }
        return [] as never;
      });

      const result = await importer.scan();
      const sessions = result.available.get('sessions');
      expect(sessions).toBeDefined();
      expect(sessions!.count).toBe(2);
      expect(sessions!.description).toContain('session');
    });

    it('should not report sessions when chats dir does not exist', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CURSOR_HOME) return true;
        return false;
      });

      const result = await importer.scan();
      expect(result.available.has('sessions')).toBe(false);
    });

    it('should not report sessions when chats dir is empty', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CURSOR_HOME) return true;
        if (s === path.join(CURSOR_HOME, 'chats')) return true;
        return false;
      });
      vi.mocked(fse.readdir).mockResolvedValue([] as never);

      const result = await importer.scan();
      expect(result.available.has('sessions')).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // import() – sessions
  // ---------------------------------------------------------------
  describe('import() - sessions', () => {
    /**
     * Helper: builds a hex-encoded meta JSON string matching Cursor's format.
     */
    function buildHexMeta(opts: {
      agentId: string;
      name: string;
      createdAt: number;
      lastUsedModel: string;
    }): string {
      return Buffer.from(JSON.stringify({
        agentId: opts.agentId,
        latestRootBlobId: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        name: opts.name,
        mode: 'default',
        createdAt: opts.createdAt,
        lastUsedModel: opts.lastUsedModel,
      })).toString('hex');
    }

    /**
     * Helper: sets up fse mocks for session discovery with N session DBs.
     */
    function setupSessionDiscovery(sessions: Array<{ hash: string; uuid: string }>) {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CURSOR_HOME) return true;
        if (s === path.join(CURSOR_HOME, 'chats')) return true;
        // Check for store.db files
        for (const sess of sessions) {
          if (s === path.join(CURSOR_HOME, 'chats', sess.hash, sess.uuid, 'store.db')) return true;
        }
        return false;
      });

      vi.mocked(fse.readdir).mockImplementation(async (p: string, _opts?: unknown) => {
        const s = String(p);
        if (s === path.join(CURSOR_HOME, 'chats')) {
          const uniqueHashes = [...new Set(sessions.map(s => s.hash))];
          return uniqueHashes.map(h => ({
            name: h, isDirectory: () => true, isFile: () => false,
          })) as never;
        }
        for (const sess of sessions) {
          if (s === path.join(CURSOR_HOME, 'chats', sess.hash)) {
            const uuidsForHash = sessions.filter(s2 => s2.hash === sess.hash);
            return uuidsForHash.map(s2 => ({
              name: s2.uuid, isDirectory: () => true, isFile: () => false,
            })) as never;
          }
        }
        return [] as never;
      });
    }

    /**
     * Helper: configures the mocked DatabaseSync to return given meta and blobs.
     */
    function setupMockDatabase(
      metaHex: string,
      blobs: Array<{ data: Buffer }>,
    ) {
      mockPrepare.mockImplementation((sql: string) => {
        if (sql.includes('meta')) {
          return { get: vi.fn().mockReturnValue({ value: metaHex }) };
        }
        if (sql.includes('blobs')) {
          return { all: vi.fn().mockReturnValue(blobs) };
        }
        return { get: vi.fn(), all: vi.fn().mockReturnValue([]) };
      });
    }

    it('should skip sessions when chats dir does not exist', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const result = await importer.import(['sessions']);
      expect(result.imported.get('sessions')!.skipped).toBe(1);
    });

    it('should extract messages from SQLite blobs', async () => {
      setupSessionDiscovery([{ hash: 'abc', uuid: 'uuid-1' }]);

      const userMsg = JSON.stringify({
        role: 'user',
        content: [{ type: 'text', text: '<user_query>\nhello world\n</user_query>' }],
      });
      const assistantMsg = JSON.stringify({
        role: 'assistant',
        content: [{ type: 'text', text: 'Hi there!' }],
      });

      setupMockDatabase(
        buildHexMeta({ agentId: 'uuid-1', name: 'Test Chat', createdAt: 1772503000000, lastUsedModel: 'claude-4.6' }),
        [
          { data: Buffer.from(userMsg) },
          { data: Buffer.from(assistantMsg) },
        ],
      );

      const result = await importer.import(['sessions']);
      expect(result.imported.get('sessions')!.success).toBe(1);
      expect(result.imported.get('sessions')!.failed).toBe(0);

      // Should have written session data
      const writeFileCalls = vi.mocked(fse.writeFile).mock.calls;
      const conversationCall = writeFileCalls.find(call =>
        String(call[0]).includes('conversation.jsonl'),
      );
      expect(conversationCall).toBeDefined();

      // Parse the JSONL content and verify messages
      const jsonl = String(conversationCall![1]);
      const lines = jsonl.trim().split('\n').map(l => JSON.parse(l));
      expect(lines.length).toBe(2);
      expect(lines[0].role).toBe('user');
      expect(lines[0].content).toBe('hello world');
      expect(lines[1].role).toBe('assistant');
      expect(lines[1].content).toBe('Hi there!');
    });

    it('should strip <user_query> XML wrapping from user messages', async () => {
      setupSessionDiscovery([{ hash: 'abc', uuid: 'uuid-1' }]);

      const userMsg = JSON.stringify({
        role: 'user',
        content: [{ type: 'text', text: '<user_query>\nwhat is 2+2?\n</user_query>' }],
      });

      setupMockDatabase(
        buildHexMeta({ agentId: 'uuid-1', name: 'Math', createdAt: 1772503000000, lastUsedModel: 'gpt-5' }),
        [{ data: Buffer.from(userMsg) }],
      );

      const result = await importer.import(['sessions']);
      expect(result.imported.get('sessions')!.success).toBe(1);

      const writeFileCalls = vi.mocked(fse.writeFile).mock.calls;
      const conversationCall = writeFileCalls.find(call =>
        String(call[0]).includes('conversation.jsonl'),
      );
      const lines = String(conversationCall![1]).trim().split('\n').map(l => JSON.parse(l));
      expect(lines[0].content).toBe('what is 2+2?');
      expect(lines[0].content).not.toContain('<user_query>');
    });

    it('should convert reasoning blocks to _meta.thinking', async () => {
      setupSessionDiscovery([{ hash: 'abc', uuid: 'uuid-1' }]);

      const assistantMsg = JSON.stringify({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'Let me think about this...' },
          { type: 'text', text: 'The answer is 4.' },
        ],
      });

      setupMockDatabase(
        buildHexMeta({ agentId: 'uuid-1', name: 'Think', createdAt: 1772503000000, lastUsedModel: 'claude-4.6' }),
        [{ data: Buffer.from(assistantMsg) }],
      );

      const result = await importer.import(['sessions']);
      expect(result.imported.get('sessions')!.success).toBe(1);

      const writeFileCalls = vi.mocked(fse.writeFile).mock.calls;
      const conversationCall = writeFileCalls.find(call =>
        String(call[0]).includes('conversation.jsonl'),
      );
      const lines = String(conversationCall![1]).trim().split('\n').map(l => JSON.parse(l));
      expect(lines[0].content).toBe('The answer is 4.');
      expect(lines[0]._meta?.thinking).toBe('Let me think about this...');
    });

    it('should deduplicate identical messages across blobs', async () => {
      setupSessionDiscovery([{ hash: 'abc', uuid: 'uuid-1' }]);

      const userMsg = JSON.stringify({
        role: 'user',
        content: [{ type: 'text', text: '<user_query>\nhey\n</user_query>' }],
      });
      const assistantMsg = JSON.stringify({
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello!' }],
      });

      // Same messages appear in multiple blobs (Cursor stores snapshots)
      setupMockDatabase(
        buildHexMeta({ agentId: 'uuid-1', name: 'Dedup', createdAt: 1772503000000, lastUsedModel: 'claude-4.6' }),
        [
          { data: Buffer.from(userMsg) },
          { data: Buffer.from(assistantMsg) },
          { data: Buffer.from(userMsg) },       // duplicate
          { data: Buffer.from(assistantMsg) },   // duplicate
        ],
      );

      const result = await importer.import(['sessions']);
      expect(result.imported.get('sessions')!.success).toBe(1);

      const writeFileCalls = vi.mocked(fse.writeFile).mock.calls;
      const conversationCall = writeFileCalls.find(call =>
        String(call[0]).includes('conversation.jsonl'),
      );
      const lines = String(conversationCall![1]).trim().split('\n').map(l => JSON.parse(l));
      // Should only have 2 messages, not 4
      expect(lines.length).toBe(2);
    });

    it('should filter out system messages', async () => {
      setupSessionDiscovery([{ hash: 'abc', uuid: 'uuid-1' }]);

      const systemMsg = JSON.stringify({
        role: 'system',
        content: 'You are an AI agent...',
      });
      const userMsg = JSON.stringify({
        role: 'user',
        content: [{ type: 'text', text: '<user_query>\nhey\n</user_query>' }],
      });

      setupMockDatabase(
        buildHexMeta({ agentId: 'uuid-1', name: 'Sys', createdAt: 1772503000000, lastUsedModel: 'claude-4.6' }),
        [
          { data: Buffer.from(systemMsg) },
          { data: Buffer.from(userMsg) },
        ],
      );

      await importer.import(['sessions']);

      const writeFileCalls = vi.mocked(fse.writeFile).mock.calls;
      const conversationCall = writeFileCalls.find(call =>
        String(call[0]).includes('conversation.jsonl'),
      );
      const lines = String(conversationCall![1]).trim().split('\n').map(l => JSON.parse(l));
      // Only the user message, not the system message
      expect(lines.length).toBe(1);
      expect(lines[0].role).toBe('user');
    });

    it('should skip empty sessions with no messages', async () => {
      setupSessionDiscovery([{ hash: 'abc', uuid: 'uuid-1' }]);

      // Empty blobs — no extractable messages
      setupMockDatabase(
        buildHexMeta({ agentId: 'uuid-1', name: 'Empty', createdAt: 1772503000000, lastUsedModel: 'claude-4.6' }),
        [{ data: Buffer.alloc(0) }],
      );

      const result = await importer.import(['sessions']);
      expect(result.imported.get('sessions')!.success).toBe(0);
      expect(result.imported.get('sessions')!.skipped).toBeGreaterThanOrEqual(1);
    });

    it('should handle SQLite open errors gracefully', async () => {
      setupSessionDiscovery([{ hash: 'abc', uuid: 'uuid-1' }]);

      MockDatabaseSync.mockImplementationOnce(() => {
        throw new Error('SQLITE_CANTOPEN: unable to open database file');
      });

      const result = await importer.import(['sessions']);
      expect(result.imported.get('sessions')!.failed).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].category).toBe('sessions');
      expect(result.errors[0].error).toContain('SQLITE_CANTOPEN');
    });

    it('should handle corrupt meta gracefully', async () => {
      setupSessionDiscovery([{ hash: 'abc', uuid: 'uuid-1' }]);

      mockPrepare.mockImplementation((sql: string) => {
        if (sql.includes('meta')) {
          // Return invalid hex that decodes to invalid JSON
          return { get: vi.fn().mockReturnValue({ value: '6e6f742d6a736f6e' }) };
        }
        return { all: vi.fn().mockReturnValue([]) };
      });

      const result = await importer.import(['sessions']);
      expect(result.imported.get('sessions')!.failed).toBe(1);
      expect(result.errors.length).toBe(1);
    });

    it('should fire progress callbacks for each session', async () => {
      setupSessionDiscovery([
        { hash: 'abc', uuid: 'uuid-1' },
        { hash: 'abc', uuid: 'uuid-2' },
      ]);

      const userMsg = JSON.stringify({
        role: 'user',
        content: [{ type: 'text', text: '<user_query>\nhey\n</user_query>' }],
      });

      // Both sessions use the same mock — configure it for each call
      let callIndex = 0;
      MockDatabaseSync.mockImplementation(() => {
        const idx = callIndex++;
        const names = ['Session 1', 'Session 2'];
        const uuids = ['uuid-1', 'uuid-2'];
        return {
          prepare: (sql: string) => {
            if (sql.includes('meta')) {
              return {
                get: vi.fn().mockReturnValue({
                  value: buildHexMeta({
                    agentId: uuids[idx],
                    name: names[idx],
                    createdAt: 1772503000000 + idx * 1000,
                    lastUsedModel: 'claude-4.6',
                  }),
                }),
              };
            }
            if (sql.includes('blobs')) {
              return { all: vi.fn().mockReturnValue([{ data: Buffer.from(userMsg) }]) };
            }
            return { get: vi.fn(), all: vi.fn().mockReturnValue([]) };
          },
          close: vi.fn(),
        };
      });

      const progress: Array<{ category: string; item: string; status: string }> = [];
      await importer.import(['sessions'], (p) => progress.push(p));

      const sessionProgress = progress.filter(p => p.category === 'sessions');
      expect(sessionProgress.length).toBeGreaterThanOrEqual(2);
      expect(sessionProgress.some(p => p.status === 'importing')).toBe(true);
    });

    it('should pass correct metadata to session writer', async () => {
      setupSessionDiscovery([{ hash: 'abc', uuid: 'uuid-1' }]);

      const userMsg = JSON.stringify({
        role: 'user',
        content: [{ type: 'text', text: '<user_query>\nhello\n</user_query>' }],
      });

      setupMockDatabase(
        buildHexMeta({
          agentId: 'uuid-1',
          name: 'My Chat Session',
          createdAt: 1772503070316,
          lastUsedModel: 'claude-4.6-opus-high-thinking',
        }),
        [{ data: Buffer.from(userMsg) }],
      );

      const result = await importer.import(['sessions']);
      expect(result.imported.get('sessions')!.success).toBe(1);

      // Verify metadata.json was written
      const writeJsonCalls = vi.mocked(fse.writeJson).mock.calls;
      const metadataCall = writeJsonCalls.find(call =>
        String(call[0]).includes('metadata.json'),
      );
      expect(metadataCall).toBeDefined();

      const metadata = metadataCall![1] as Record<string, unknown>;
      expect(metadata.model).toBe('claude-4.6-opus-high-thinking');
      expect(metadata.summary).toContain('My Chat Session');
      expect((metadata.importedFrom as Record<string, unknown>)?.source).toBe('cursor');
      expect((metadata.importedFrom as Record<string, unknown>)?.originalId).toBe('uuid-1');
    });

    it('should handle content as plain string (non-array)', async () => {
      setupSessionDiscovery([{ hash: 'abc', uuid: 'uuid-1' }]);

      const userMsg = JSON.stringify({
        role: 'user',
        content: 'just a plain string message',
      });

      setupMockDatabase(
        buildHexMeta({ agentId: 'uuid-1', name: 'Plain', createdAt: 1772503000000, lastUsedModel: 'gpt-5' }),
        [{ data: Buffer.from(userMsg) }],
      );

      const result = await importer.import(['sessions']);
      expect(result.imported.get('sessions')!.success).toBe(1);

      const writeFileCalls = vi.mocked(fse.writeFile).mock.calls;
      const conversationCall = writeFileCalls.find(call =>
        String(call[0]).includes('conversation.jsonl'),
      );
      const lines = String(conversationCall![1]).trim().split('\n').map(l => JSON.parse(l));
      expect(lines[0].content).toBe('just a plain string message');
    });

    it('should handle messages embedded in larger binary blobs', async () => {
      setupSessionDiscovery([{ hash: 'abc', uuid: 'uuid-1' }]);

      // Simulate a blob with binary prefix + JSON message embedded
      const jsonStr = JSON.stringify({
        role: 'user',
        content: [{ type: 'text', text: '<user_query>\nhey\n</user_query>' }],
      });
      const binaryPrefix = Buffer.from([0x03, 0x68, 0x65, 0x79, 0x12, 0x24]);
      const combined = Buffer.concat([binaryPrefix, Buffer.from(jsonStr)]);

      setupMockDatabase(
        buildHexMeta({ agentId: 'uuid-1', name: 'Mixed', createdAt: 1772503000000, lastUsedModel: 'claude-4.6' }),
        [{ data: combined }],
      );

      const result = await importer.import(['sessions']);
      expect(result.imported.get('sessions')!.success).toBe(1);

      const writeFileCalls = vi.mocked(fse.writeFile).mock.calls;
      const conversationCall = writeFileCalls.find(call =>
        String(call[0]).includes('conversation.jsonl'),
      );
      const lines = String(conversationCall![1]).trim().split('\n').map(l => JSON.parse(l));
      expect(lines[0].role).toBe('user');
      expect(lines[0].content).toBe('hey');
    });

    it('should import multiple sessions across different hash dirs', async () => {
      setupSessionDiscovery([
        { hash: 'hash1', uuid: 'uuid-a' },
        { hash: 'hash2', uuid: 'uuid-b' },
      ]);

      const userMsg = JSON.stringify({
        role: 'user',
        content: [{ type: 'text', text: '<user_query>\nhey\n</user_query>' }],
      });

      let callIndex = 0;
      MockDatabaseSync.mockImplementation(() => {
        const idx = callIndex++;
        const uuids = ['uuid-a', 'uuid-b'];
        const names = ['Chat A', 'Chat B'];
        return {
          prepare: (sql: string) => {
            if (sql.includes('meta')) {
              return {
                get: vi.fn().mockReturnValue({
                  value: buildHexMeta({
                    agentId: uuids[idx],
                    name: names[idx],
                    createdAt: 1772503000000,
                    lastUsedModel: 'claude-4.6',
                  }),
                }),
              };
            }
            if (sql.includes('blobs')) {
              return { all: vi.fn().mockReturnValue([{ data: Buffer.from(userMsg) }]) };
            }
            return { get: vi.fn(), all: vi.fn().mockReturnValue([]) };
          },
          close: vi.fn(),
        };
      });

      const result = await importer.import(['sessions']);
      expect(result.imported.get('sessions')!.success).toBe(2);
    });

    it('should extract project path from binary blob file:// URI', async () => {
      setupSessionDiscovery([{ hash: 'abc', uuid: 'uuid-1' }]);

      const userMsg = JSON.stringify({
        role: 'user',
        content: [{ type: 'text', text: '<user_query>\nhey\n</user_query>' }],
      });
      // Binary blob containing a file:// URI (like in real Cursor data).
      // Trailing 0x00 simulates a null byte separator from protobuf encoding.
      const blobWithPath = Buffer.concat([
        Buffer.from([0x3b]),
        Buffer.from('file:///Users/igorcosta/Documents/autohand/repos/entrie-cli'),
        Buffer.from([0x00]),
      ]);

      setupMockDatabase(
        buildHexMeta({ agentId: 'uuid-1', name: 'Project', createdAt: 1772503000000, lastUsedModel: 'claude-4.6' }),
        [
          { data: blobWithPath },
          { data: Buffer.from(userMsg) },
        ],
      );

      const result = await importer.import(['sessions']);
      expect(result.imported.get('sessions')!.success).toBe(1);

      const writeJsonCalls = vi.mocked(fse.writeJson).mock.calls;
      const metadataCall = writeJsonCalls.find(call =>
        String(call[0]).includes('metadata.json'),
      );
      const metadata = metadataCall![1] as Record<string, unknown>;
      expect(metadata.projectPath).toBe('/Users/igorcosta/Documents/autohand/repos/entrie-cli');
    });
  });
});
