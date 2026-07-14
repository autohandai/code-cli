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
import { KimiImporter } from '../../src/import/importers/KimiImporter.js';

const HOME = os.homedir();
const KIMI_HOME = path.join(HOME, '.kimi');

describe('KimiImporter', () => {
  let importer: KimiImporter;

  beforeEach(() => {
    vi.clearAllMocks();
    importer = new KimiImporter();
  });

  describe('identity', () => {
    it('should identify Kimi CLI', () => {
      expect(importer.name).toBe('kimi');
      expect(importer.displayName).toBe('Kimi CLI');
      expect(importer.homePath).toBe('~/.kimi');
    });
  });

  describe('scan()', () => {
    it('should detect core Kimi files and directories', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        return [
          KIMI_HOME,
          path.join(KIMI_HOME, 'config.toml'),
          path.join(KIMI_HOME, 'kimi.json'),
          path.join(KIMI_HOME, 'mcp.json'),
          path.join(KIMI_HOME, 'AGENTS.md'),
          path.join(KIMI_HOME, 'skills'),
          path.join(KIMI_HOME, 'sessions'),
          path.join(KIMI_HOME, 'sessions', 'work-hash', 'session-a', 'context.jsonl'),
        ].includes(s);
      });
      vi.mocked(fse.readFile).mockImplementation(async (p: string) => {
        if (String(p).endsWith('config.toml')) {
          return [
            'default_model = "kimi-for-coding"',
            '[[hooks]]',
            'event = "PostToolUse"',
            'command = "npm test"',
          ].join('\n') as never;
        }
        throw new Error('not found');
      });
      vi.mocked(fse.readdir).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === path.join(KIMI_HOME, 'skills')) {
          return [{ name: 'release', isDirectory: () => true, isFile: () => false }] as never;
        }
        if (s === path.join(KIMI_HOME, 'sessions')) {
          return [{ name: 'work-hash', isDirectory: () => true, isFile: () => false }] as never;
        }
        if (s === path.join(KIMI_HOME, 'sessions', 'work-hash')) {
          return [{ name: 'session-a', isDirectory: () => true, isFile: () => false }] as never;
        }
        return [] as never;
      });

      const result = await importer.scan();

      expect(result.available.get('settings')?.count).toBe(2);
      expect(result.available.get('mcp')?.count).toBe(1);
      expect(result.available.get('memory')?.count).toBe(1);
      expect(result.available.get('skills')?.count).toBe(1);
      expect(result.available.get('sessions')?.count).toBe(1);
      expect(result.available.get('hooks')?.count).toBe(1);
    });
  });

  describe('import()', () => {
    it('should import Kimi settings and hooks from config.toml', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) =>
        [KIMI_HOME, path.join(KIMI_HOME, 'config.toml')].includes(String(p)),
      );
      vi.mocked(fse.readFile).mockResolvedValue('default_model = "kimi-for-coding"\n[[hooks]]\nevent = "Stop"\ncommand = "echo done"' as never);

      const result = await importer.import(['settings', 'hooks']);

      expect(result.imported.get('settings')?.success).toBe(1);
      expect(result.imported.get('hooks')?.success).toBe(1);
      expect(fse.writeJson).toHaveBeenCalledWith(
        expect.stringContaining('imported-kimi-settings.json'),
        expect.objectContaining({
          importedFrom: 'kimi',
          parsed: expect.objectContaining({ default_model: 'kimi-for-coding' }),
        }),
        { spaces: 2 },
      );
      expect(fse.writeJson).toHaveBeenCalledWith(
        expect.stringContaining('imported-kimi-hooks.json'),
        expect.objectContaining({ hooksToml: expect.stringContaining('event = "Stop"') }),
        { spaces: 2 },
      );
    });

    it('should import MCP, memory, and skills', async () => {
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        return [
          path.join(KIMI_HOME, 'mcp.json'),
          path.join(KIMI_HOME, 'AGENTS.md'),
          path.join(KIMI_HOME, 'skills'),
        ].includes(s);
      });
      vi.mocked(fse.readFile).mockImplementation(async (p: string) => {
        if (String(p).endsWith('mcp.json')) {
          return JSON.stringify({ mcpServers: { docs: { command: 'docs-mcp' } } }) as never;
        }
        throw new Error('not found');
      });
      vi.mocked(fse.readdir).mockResolvedValue([
        { name: 'release', isDirectory: () => true, isFile: () => false },
      ] as never);

      const result = await importer.import(['mcp', 'memory', 'skills']);

      expect(result.imported.get('mcp')?.success).toBe(1);
      expect(result.imported.get('memory')?.success).toBe(1);
      expect(result.imported.get('skills')?.success).toBe(1);
      expect(fse.copy).toHaveBeenCalledWith(
        path.join(KIMI_HOME, 'AGENTS.md'),
        expect.stringContaining('AGENTS.md'),
      );
      expect(fse.copy).toHaveBeenCalledWith(
        path.join(KIMI_HOME, 'skills', 'release'),
        expect.stringContaining(path.join('imported-kimi', 'release')),
      );
    });

    it('should convert Kimi context.jsonl sessions to Autohand sessions', async () => {
      const sessionDir = path.join(KIMI_HOME, 'sessions', 'work-hash', 'session-a');
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        return [
          path.join(KIMI_HOME, 'sessions'),
          sessionDir,
          path.join(sessionDir, 'context.jsonl'),
          path.join(sessionDir, 'state.json'),
        ].includes(s);
      });
      vi.mocked(fse.readdir).mockImplementation(async (p: string) => {
        const s = String(p);
        if (s === path.join(KIMI_HOME, 'sessions')) {
          return [{ name: 'work-hash', isDirectory: () => true, isFile: () => false }] as never;
        }
        if (s === path.join(KIMI_HOME, 'sessions', 'work-hash')) {
          return [{ name: 'session-a', isDirectory: () => true, isFile: () => false }] as never;
        }
        return [] as never;
      });
      vi.mocked(fse.readJson).mockImplementation(async (p: string) => {
        if (String(p).endsWith('state.json')) {
          return { title: 'Fix import', cwd: '/repo/app' } as never;
        }
        throw new Error('not found');
      });
      vi.mocked(fse.readFile).mockImplementation(async (p: string) => {
        if (String(p).endsWith('context.jsonl')) {
          return [
            JSON.stringify({ role: '_system_prompt', content: 'system' }),
            JSON.stringify({ role: 'user', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' }),
            JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: 'hi' }], timestamp: '2026-01-01T00:00:01.000Z' }),
          ].join('\n') as never;
        }
        throw new Error('not found');
      });

      const result = await importer.import(['sessions']);

      expect(result.imported.get('sessions')?.success).toBe(1);
      expect(fse.writeJson).toHaveBeenCalledWith(
        expect.stringContaining('metadata.json'),
        expect.objectContaining({
          projectPath: '/repo/app',
          summary: 'Fix import',
          importedFrom: expect.objectContaining({ source: 'kimi', originalId: 'session-a' }),
        }),
        { spaces: 2 },
      );
    });
  });
});
