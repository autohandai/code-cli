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
import { ClineImporter } from '../../src/import/importers/ClineImporter.js';

const HOME = os.homedir();
const CLINE_HOME = path.join(HOME, '.cline');

describe('ClineImporter', () => {
  let importer: ClineImporter;

  beforeEach(() => {
    vi.clearAllMocks();
    importer = new ClineImporter();
  });

  // ---------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------
  describe('identity', () => {
    it('should have name "cline"', () => {
      expect(importer.name).toBe('cline');
    });

    it('should have displayName "Cline"', () => {
      expect(importer.displayName).toBe('Cline');
    });

    it('should have homePath "~/.cline"', () => {
      expect(importer.homePath).toBe('~/.cline');
    });
  });

  // ---------------------------------------------------------------
  // scan()
  // ---------------------------------------------------------------
  describe('scan()', () => {
    it('should return empty available map when ~/.cline does not exist', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const result = await importer.scan();
      expect(result.source).toBe('cline');
      expect(result.available.size).toBe(0);
    });

    it('should detect globalState.json as settings', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CLINE_HOME) return true;
        if (s === path.join(CLINE_HOME, 'data', 'globalState.json')) return true;
        return false;
      });

      const result = await importer.scan();
      const settings = result.available.get('settings');
      expect(settings).toBeDefined();
      expect(settings!.count).toBe(1);
    });
  });

  // ---------------------------------------------------------------
  // import() – settings
  // ---------------------------------------------------------------
  describe('import() - settings', () => {
    it('should import settings from globalState.json', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CLINE_HOME) return true;
        if (s === path.join(CLINE_HOME, 'data', 'globalState.json')) return true;
        return false;
      });

      vi.mocked(fse.readFile).mockImplementation(async (p: string) => {
        if (String(p).includes('globalState.json')) {
          return JSON.stringify({
            apiModelId: 'claude-3.5-sonnet',
            autoApprovalSettings: { enabled: true, maxRequests: 10 },
            browserSettings: { headless: true },
            workspaceRoots: ['/home/user/project1', '/home/user/project2'],
          }) as never;
        }
        throw new Error('not found');
      });

      const result = await importer.import(['settings']);
      expect(result.imported.get('settings')!.success).toBe(1);

      // Verify it wrote the imported settings
      const writeJsonCalls = vi.mocked(fse.writeJson).mock.calls;
      const settingsCall = writeJsonCalls.find(call =>
        String(call[0]).includes('imported-cline-settings'),
      );
      expect(settingsCall).toBeDefined();
      const written = settingsCall![1] as Record<string, unknown>;
      expect(written.importedFrom).toBe('cline');
    });

    it('should handle missing globalState.json', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const result = await importer.import(['settings']);
      expect(result.imported.get('settings')!.skipped).toBe(1);
    });

    it('should handle malformed globalState.json', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CLINE_HOME) return true;
        if (s === path.join(CLINE_HOME, 'data', 'globalState.json')) return true;
        return false;
      });

      vi.mocked(fse.readFile).mockRejectedValue(new Error('invalid json') as never);

      const result = await importer.import(['settings']);
      expect(result.imported.get('settings')!.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------
  // import() – unsupported categories
  // ---------------------------------------------------------------
  describe('import() - unsupported categories', () => {
    it('should not import sessions (not supported)', async () => {
      const result = await importer.import(['sessions']);
      expect(result.imported.has('sessions')).toBe(false);
    });
  });
});
