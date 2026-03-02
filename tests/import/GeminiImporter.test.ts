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
import { GeminiImporter } from '../../src/import/importers/GeminiImporter.js';

const HOME = os.homedir();
const GEMINI_HOME = path.join(HOME, '.gemini');

describe('GeminiImporter', () => {
  let importer: GeminiImporter;

  beforeEach(() => {
    vi.clearAllMocks();
    importer = new GeminiImporter();
  });

  // ---------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------
  describe('identity', () => {
    it('should have name "gemini"', () => {
      expect(importer.name).toBe('gemini');
    });

    it('should have displayName "Google Gemini"', () => {
      expect(importer.displayName).toBe('Google Gemini');
    });

    it('should have homePath "~/.gemini"', () => {
      expect(importer.homePath).toBe('~/.gemini');
    });
  });

  // ---------------------------------------------------------------
  // scan()
  // ---------------------------------------------------------------
  describe('scan()', () => {
    it('should return empty available map when ~/.gemini does not exist', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const result = await importer.scan();
      expect(result.source).toBe('gemini');
      expect(result.available.size).toBe(0);
    });

    it('should detect settings.json', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === GEMINI_HOME) return true;
        if (s === path.join(GEMINI_HOME, 'settings.json')) return true;
        if (s === path.join(GEMINI_HOME, 'GEMINI.md')) return false;
        return false;
      });

      const result = await importer.scan();
      const settings = result.available.get('settings');
      expect(settings).toBeDefined();
      expect(settings!.count).toBe(1);
    });

    it('should detect GEMINI.md as memory', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === GEMINI_HOME) return true;
        if (s === path.join(GEMINI_HOME, 'GEMINI.md')) return true;
        if (s === path.join(GEMINI_HOME, 'settings.json')) return false;
        return false;
      });

      const result = await importer.scan();
      const memory = result.available.get('memory');
      expect(memory).toBeDefined();
      expect(memory!.count).toBe(1);
    });

    it('should detect hooks from settings.json', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === GEMINI_HOME) return true;
        if (s === path.join(GEMINI_HOME, 'settings.json')) return true;
        if (s === path.join(GEMINI_HOME, 'GEMINI.md')) return false;
        return false;
      });

      vi.mocked(fse.readFile).mockImplementation(async (p: string) => {
        if (String(p).endsWith('settings.json')) {
          return JSON.stringify({
            hooks: {
              BeforeAgent: [{ command: 'echo before' }],
              AfterAgent: [{ command: 'echo after' }],
            },
          }) as never;
        }
        throw new Error('not found');
      });

      const result = await importer.scan();
      const hooks = result.available.get('hooks');
      expect(hooks).toBeDefined();
      expect(hooks!.count).toBe(2);
    });
  });

  // ---------------------------------------------------------------
  // import() – settings
  // ---------------------------------------------------------------
  describe('import() - settings', () => {
    it('should import settings from settings.json', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === GEMINI_HOME) return true;
        if (s === path.join(GEMINI_HOME, 'settings.json')) return true;
        return false;
      });

      vi.mocked(fse.readFile).mockImplementation(async (p: string) => {
        if (String(p).endsWith('settings.json')) {
          return JSON.stringify({ theme: 'dark', model: 'gemini-2.0-flash' }) as never;
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
  // import() – hooks
  // ---------------------------------------------------------------
  describe('import() - hooks', () => {
    it('should extract hook configurations from settings.json', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === GEMINI_HOME) return true;
        if (s === path.join(GEMINI_HOME, 'settings.json')) return true;
        return false;
      });

      vi.mocked(fse.readFile).mockImplementation(async (p: string) => {
        if (String(p).endsWith('settings.json')) {
          return JSON.stringify({
            hooks: {
              BeforeAgent: [{ command: 'lint' }],
              AfterAgent: [{ command: 'test' }],
              AfterTool: [{ command: 'format' }],
            },
          }) as never;
        }
        throw new Error('not found');
      });

      const result = await importer.import(['hooks']);
      expect(result.imported.get('hooks')!.success).toBe(1);
    });

    it('should handle missing hooks gracefully', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const result = await importer.import(['hooks']);
      expect(result.imported.get('hooks')!.skipped).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // import() – memory
  // ---------------------------------------------------------------
  describe('import() - memory', () => {
    it('should copy GEMINI.md', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === GEMINI_HOME) return true;
        if (s === path.join(GEMINI_HOME, 'GEMINI.md')) return true;
        return false;
      });

      const result = await importer.import(['memory']);
      expect(result.imported.get('memory')!.success).toBe(1);
      expect(fse.copy).toHaveBeenCalled();
    });

    it('should handle missing GEMINI.md', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const result = await importer.import(['memory']);
      expect(result.imported.get('memory')!.skipped).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // import() – malformed data
  // ---------------------------------------------------------------
  describe('error handling', () => {
    it('should not throw when settings.json is malformed', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === GEMINI_HOME) return true;
        if (s === path.join(GEMINI_HOME, 'settings.json')) return true;
        return false;
      });

      vi.mocked(fse.readFile).mockRejectedValue(new Error('invalid json') as never);

      const result = await importer.import(['settings']);
      expect(result.imported.get('settings')!.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
    });
  });
});
