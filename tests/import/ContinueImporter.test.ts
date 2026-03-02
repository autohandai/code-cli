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
import { ContinueImporter } from '../../src/import/importers/ContinueImporter.js';

const HOME = os.homedir();
const CONTINUE_HOME = path.join(HOME, '.continue');

describe('ContinueImporter', () => {
  let importer: ContinueImporter;

  beforeEach(() => {
    vi.clearAllMocks();
    importer = new ContinueImporter();
  });

  // ---------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------
  describe('identity', () => {
    it('should have name "continue"', () => {
      expect(importer.name).toBe('continue');
    });

    it('should have displayName "Continue.dev"', () => {
      expect(importer.displayName).toBe('Continue.dev');
    });

    it('should have homePath "~/.continue"', () => {
      expect(importer.homePath).toBe('~/.continue');
    });
  });

  // ---------------------------------------------------------------
  // scan()
  // ---------------------------------------------------------------
  describe('scan()', () => {
    it('should return empty available map when ~/.continue does not exist', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const result = await importer.scan();
      expect(result.source).toBe('continue');
      expect(result.available.size).toBe(0);
    });

    it('should detect config.json as settings', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CONTINUE_HOME) return true;
        if (s === path.join(CONTINUE_HOME, 'config.json')) return true;
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
    it('should import settings from config.json', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CONTINUE_HOME) return true;
        if (s === path.join(CONTINUE_HOME, 'config.json')) return true;
        return false;
      });

      vi.mocked(fse.readFile).mockImplementation(async (p: string) => {
        if (String(p).endsWith('config.json')) {
          return JSON.stringify({
            models: [
              { title: 'GPT-4', provider: 'openai', model: 'gpt-4' },
              { title: 'Claude', provider: 'anthropic', model: 'claude-3.5-sonnet' },
            ],
            contextProviders: [
              { name: 'code', params: {} },
            ],
            slashCommands: [
              { name: 'edit', description: 'Edit code' },
            ],
            embeddingsProvider: {
              provider: 'openai',
              model: 'text-embedding-3-small',
            },
          }) as never;
        }
        throw new Error('not found');
      });

      const result = await importer.import(['settings']);
      expect(result.imported.get('settings')!.success).toBe(1);

      // Verify it wrote the imported settings
      const writeJsonCalls = vi.mocked(fse.writeJson).mock.calls;
      const settingsCall = writeJsonCalls.find(call =>
        String(call[0]).includes('imported-continue-settings'),
      );
      expect(settingsCall).toBeDefined();
      const written = settingsCall![1] as Record<string, unknown>;
      expect(written.importedFrom).toBe('continue');
      expect((written.models as unknown[]).length).toBe(2);
    });

    it('should handle missing config.json', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const result = await importer.import(['settings']);
      expect(result.imported.get('settings')!.skipped).toBe(1);
    });

    it('should handle malformed config.json', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === CONTINUE_HOME) return true;
        if (s === path.join(CONTINUE_HOME, 'config.json')) return true;
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
