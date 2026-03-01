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

import fse from 'fs-extra';
import { CursorImporter } from '../../src/import/importers/CursorImporter.js';

const HOME = os.homedir();
const CURSOR_HOME = path.join(HOME, '.cursor');

describe('CursorImporter', () => {
  let importer: CursorImporter;

  beforeEach(() => {
    vi.clearAllMocks();
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

      vi.mocked(fse.readJson).mockImplementation(async (p: string) => {
        if (String(p).endsWith('hooks.json')) {
          return { hooks: [{ event: 'onSave', command: 'lint' }] };
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

      vi.mocked(fse.readJson).mockImplementation(async (p: string) => {
        if (String(p).endsWith('mcp.json')) {
          return {
            mcpServers: {
              filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
            },
          };
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

      vi.mocked(fse.readJson).mockImplementation(async (p: string) => {
        if (String(p).endsWith('hooks.json')) {
          return { hooks: [{ event: 'onSave', command: 'lint' }] };
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

      vi.mocked(fse.readJson).mockRejectedValue(new Error('invalid json') as never);

      const result = await importer.import(['settings']);
      expect(result.imported.get('settings')!.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
    });
  });
});
