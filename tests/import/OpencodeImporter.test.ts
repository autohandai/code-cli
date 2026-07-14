/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';

const atomicFileMocks = vi.hoisted(() => ({
  atomicWriteJson: vi.fn().mockResolvedValue(undefined),
  withFileLock: vi.fn(
    (_lockPath: string, operation: () => Promise<unknown>) => operation(),
  ),
}));

vi.mock('../../src/utils/atomicFile.js', () => atomicFileMocks);

vi.mock('fs-extra', () => ({
  default: {
    pathExists: vi.fn().mockResolvedValue(false),
    readFile: vi.fn(),
    readJson: vi.fn(),
    readdir: vi.fn().mockResolvedValue([]),
    ensureDir: vi.fn().mockResolvedValue(undefined),
    writeJson: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(undefined),
  },
}));

import fse from 'fs-extra';
import { OpencodeImporter } from '../../src/import/importers/OpencodeImporter.js';

const HOME = os.homedir();
const OPENCODE_CONFIG = path.join(HOME, '.config', 'opencode');
const OPENCODE_DATA = path.join(HOME, '.local', 'share', 'opencode');

describe('OpencodeImporter', () => {
  let importer: OpencodeImporter;

  beforeEach(() => {
    vi.clearAllMocks();
    importer = new OpencodeImporter();
  });

  describe('identity', () => {
    it('should identify OpenCode', () => {
      expect(importer.name).toBe('opencode');
      expect(importer.displayName).toBe('OpenCode');
      expect(importer.homePath).toBe('~/.config/opencode');
    });
  });

  describe('detect()', () => {
    it('should detect OpenCode when only the data directory exists', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) =>
        String(p) === OPENCODE_DATA,
      );

      await expect(importer.detect()).resolves.toBe(true);
    });
  });

  describe('scan()', () => {
    it('should detect config, MCP, memory, skills, and JSON sessions', async () => {
      const sessionDir = path.join(OPENCODE_DATA, 'storage', 'session');
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        return [
          OPENCODE_CONFIG,
          OPENCODE_DATA,
          path.join(OPENCODE_CONFIG, 'opencode.jsonc'),
          path.join(OPENCODE_CONFIG, 'tui.json'),
          path.join(OPENCODE_CONFIG, 'AGENTS.md'),
          path.join(OPENCODE_CONFIG, 'skills'),
          sessionDir,
        ].includes(s);
      });
      vi.mocked(fse.readFile).mockImplementation(async (p: string) => {
        if (String(p).endsWith('opencode.jsonc')) {
          return '{ "mcp": { "docs": { "type": "local", "command": ["docs-mcp"] } } }' as never;
        }
        throw new Error('not found');
      });
      vi.mocked(fse.readdir).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === path.join(OPENCODE_CONFIG, 'skills')) {
          return [{ name: 'review', isDirectory: () => true, isFile: () => false }] as never;
        }
        if (s === sessionDir) {
          return [{ name: 'project-a', isDirectory: () => true, isFile: () => false }] as never;
        }
        if (s === path.join(sessionDir, 'project-a')) {
          return [{ name: 'ses_1.json', isDirectory: () => false, isFile: () => true }] as never;
        }
        return [] as never;
      });

      const result = await importer.scan();

      expect(result.available.get('settings')?.count).toBe(2);
      expect(result.available.get('mcp')?.count).toBe(1);
      expect(result.available.get('memory')?.count).toBe(1);
      expect(result.available.get('skills')?.count).toBe(1);
      expect(result.available.get('sessions')?.count).toBe(1);
    });
  });

  describe('import()', () => {
    it('should import OpenCode settings and MCP config', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) =>
        [
          path.join(OPENCODE_CONFIG, 'opencode.jsonc'),
          path.join(OPENCODE_CONFIG, 'tui.json'),
        ].includes(String(p)),
      );
      vi.mocked(fse.readFile).mockImplementation(async (p: string) => {
        if (String(p).endsWith('opencode.jsonc')) {
          return '{ "model": "anthropic/claude-sonnet-4-5", "mcp": { "docs": { "command": ["docs-mcp"] } } }' as never;
        }
        if (String(p).endsWith('tui.json')) {
          return '{ "theme": "tokyonight" }' as never;
        }
        throw new Error('not found');
      });

      const result = await importer.import(['settings', 'mcp']);

      expect(result.imported.get('settings')?.success).toBe(1);
      expect(result.imported.get('mcp')?.success).toBe(1);
      expect(fse.writeJson).toHaveBeenCalledWith(
        expect.stringContaining('imported-opencode-settings.json'),
        expect.objectContaining({
          importedFrom: 'opencode',
          files: expect.arrayContaining([
            expect.objectContaining({ file: 'opencode.jsonc' }),
            expect.objectContaining({ file: 'tui.json' }),
          ]),
        }),
        { spaces: 2 },
      );
      expect(fse.writeJson).toHaveBeenCalledWith(
        expect.stringContaining('imported-opencode-mcp.json'),
        expect.objectContaining({ mcpServers: expect.objectContaining({ docs: expect.any(Object) }) }),
        { spaces: 2 },
      );
    });

    it('should copy OpenCode memory and skills', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) =>
        [
          path.join(OPENCODE_CONFIG, 'AGENTS.md'),
          path.join(OPENCODE_CONFIG, 'skills'),
        ].includes(String(p)),
      );
      vi.mocked(fse.readdir).mockResolvedValue([
        { name: 'review', isDirectory: () => true, isFile: () => false },
      ] as never);

      const result = await importer.import(['memory', 'skills']);

      expect(result.imported.get('memory')?.success).toBe(1);
      expect(result.imported.get('skills')?.success).toBe(1);
      expect(fse.copy).toHaveBeenCalledWith(
        path.join(OPENCODE_CONFIG, 'AGENTS.md'),
        expect.stringContaining('AGENTS.md'),
      );
      expect(fse.copy).toHaveBeenCalledWith(
        path.join(OPENCODE_CONFIG, 'skills', 'review'),
        expect.stringContaining(path.join('imported-opencode', 'review')),
      );
    });

    it('should convert legacy JSON session storage to Autohand sessions', async () => {
      const sessionRoot = path.join(OPENCODE_DATA, 'storage', 'session');
      const messageRoot = path.join(OPENCODE_DATA, 'storage', 'message', 'ses_1');
      const partRoot = path.join(OPENCODE_DATA, 'storage', 'part', 'msg_1');
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        return [
          sessionRoot,
          path.join(sessionRoot, 'project-a', 'ses_1.json'),
          messageRoot,
          partRoot,
        ].includes(s);
      });
      vi.mocked(fse.readdir).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === sessionRoot) {
          return [{ name: 'project-a', isDirectory: () => true, isFile: () => false }] as never;
        }
        if (s === path.join(sessionRoot, 'project-a')) {
          return [{ name: 'ses_1.json', isDirectory: () => false, isFile: () => true }] as never;
        }
        if (s === messageRoot) {
          return [{ name: 'msg_1.json', isDirectory: () => false, isFile: () => true }] as never;
        }
        if (s === partRoot) {
          return [{ name: 'prt_1.json', isDirectory: () => false, isFile: () => true }] as never;
        }
        return [] as never;
      });
      vi.mocked(fse.readJson).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s.endsWith('ses_1.json')) {
          return {
            id: 'ses_1',
            title: 'Investigate failing test',
            directory: '/repo/app',
            model: { providerID: 'anthropic', id: 'claude-sonnet-4-5' },
            time: { created: 1770000000000, updated: 1770000001000 },
          } as never;
        }
        if (s.endsWith('msg_1.json')) {
          return { id: 'msg_1', role: 'user', time: { created: 1770000000000 } } as never;
        }
        if (s.endsWith('prt_1.json')) {
          return { id: 'prt_1', type: 'text', text: 'please fix this' } as never;
        }
        throw new Error('not found');
      });

      const result = await importer.import(['sessions']);

      expect(result.imported.get('sessions')?.success).toBe(1);
      expect(fse.writeJson).toHaveBeenCalledWith(
        expect.stringContaining('metadata.json'),
        expect.objectContaining({
          projectPath: '/repo/app',
          summary: 'Investigate failing test',
          importedFrom: expect.objectContaining({ source: 'opencode', originalId: 'ses_1' }),
        }),
        { spaces: 2 },
      );
    });
  });
});
