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
import { AugmentImporter } from '../../src/import/importers/AugmentImporter.js';

const HOME = os.homedir();
const AUGMENT_HOME = path.join(HOME, '.augment');

describe('AugmentImporter', () => {
  let importer: AugmentImporter;

  beforeEach(() => {
    vi.clearAllMocks();
    importer = new AugmentImporter();
  });

  // ---------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------
  describe('identity', () => {
    it('should have name "augment"', () => {
      expect(importer.name).toBe('augment');
    });

    it('should have displayName "Augment"', () => {
      expect(importer.displayName).toBe('Augment');
    });

    it('should have homePath "~/.augment"', () => {
      expect(importer.homePath).toBe('~/.augment');
    });
  });

  // ---------------------------------------------------------------
  // scan()
  // ---------------------------------------------------------------
  describe('scan()', () => {
    it('should return empty available map when ~/.augment does not exist', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const result = await importer.scan();
      expect(result.source).toBe('augment');
      expect(result.available.size).toBe(0);
    });

    it('should detect mcp.json as mcp config', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === AUGMENT_HOME) return true;
        if (s === path.join(AUGMENT_HOME, 'mcp.json')) return true;
        if (s === path.join(AUGMENT_HOME, 'settings.json')) return false;
        return false;
      });

      const result = await importer.scan();
      const mcp = result.available.get('mcp');
      expect(mcp).toBeDefined();
      expect(mcp!.count).toBe(1);
    });

    it('should detect settings.json as settings', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === AUGMENT_HOME) return true;
        if (s === path.join(AUGMENT_HOME, 'settings.json')) return true;
        if (s === path.join(AUGMENT_HOME, 'mcp.json')) return false;
        return false;
      });

      const result = await importer.scan();
      const settings = result.available.get('settings');
      expect(settings).toBeDefined();
      expect(settings!.count).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // import() – mcp
  // ---------------------------------------------------------------
  describe('import() - mcp', () => {
    it('should import MCP server configurations', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === AUGMENT_HOME) return true;
        if (s === path.join(AUGMENT_HOME, 'mcp.json')) return true;
        return false;
      });

      vi.mocked(fse.readFile).mockImplementation(async (p: string) => {
        if (String(p).endsWith('mcp.json')) {
          return JSON.stringify({
            mcpServers: {
              myServer: { command: 'node', args: ['server.js'] },
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
  // import() – settings
  // ---------------------------------------------------------------
  describe('import() - settings', () => {
    it('should import settings from settings.json', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === AUGMENT_HOME) return true;
        if (s === path.join(AUGMENT_HOME, 'settings.json')) return true;
        return false;
      });

      vi.mocked(fse.readFile).mockImplementation(async (p: string) => {
        if (String(p).endsWith('settings.json')) {
          return JSON.stringify({ model: 'augment-v2', theme: 'dark' }) as never;
        }
        throw new Error('not found');
      });

      const result = await importer.import(['settings']);
      expect(result.imported.get('settings')!.success).toBe(1);
    });

    it('should handle missing settings.json', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const result = await importer.import(['settings']);
      expect(result.imported.get('settings')!.skipped).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------
  describe('error handling', () => {
    it('should not throw when mcp.json is malformed', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === AUGMENT_HOME) return true;
        if (s === path.join(AUGMENT_HOME, 'mcp.json')) return true;
        return false;
      });

      vi.mocked(fse.readFile).mockRejectedValue(new Error('invalid json') as never);

      const result = await importer.import(['mcp']);
      expect(result.imported.get('mcp')!.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('should not throw on unsupported categories', async () => {
      const result = await importer.import(['sessions']);
      expect(result.errors).toEqual([]);
    });
  });
});
