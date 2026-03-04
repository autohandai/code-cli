/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Importer, ImportSource } from '../../src/import/types.js';
import { ClaudeImporter } from '../../src/import/importers/ClaudeImporter.js';
import { CodexImporter } from '../../src/import/importers/CodexImporter.js';
import { GeminiImporter } from '../../src/import/importers/GeminiImporter.js';
import { CursorImporter } from '../../src/import/importers/CursorImporter.js';
import { ClineImporter } from '../../src/import/importers/ClineImporter.js';
import { ContinueImporter } from '../../src/import/importers/ContinueImporter.js';
import { AugmentImporter } from '../../src/import/importers/AugmentImporter.js';
import { BaseImporter } from '../../src/import/importers/BaseImporter.js';

// Mock node:sqlite so CursorImporter can be loaded in Vitest
vi.mock('node:sqlite', () => ({
  DatabaseSync: vi.fn().mockImplementation(() => ({
    prepare: vi.fn(),
    close: vi.fn(),
  })),
}));

// Mock fs-extra with all methods used by full importer implementations
vi.mock('fs-extra', () => ({
  default: {
    pathExists: vi.fn().mockResolvedValue(false),
    readdir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue(''),
    readJson: vi.fn().mockRejectedValue(new Error('not found')),
    ensureDir: vi.fn().mockResolvedValue(undefined),
    writeJson: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(undefined),
  },
  pathExists: vi.fn().mockResolvedValue(false),
}));

interface ImporterSpec {
  Ctor: new () => Importer;
  name: ImportSource;
  displayName: string;
  homePathSuffix: string;
}

const importerSpecs: ImporterSpec[] = [
  { Ctor: ClaudeImporter, name: 'claude', displayName: 'Claude Code', homePathSuffix: '.claude' },
  { Ctor: CodexImporter, name: 'codex', displayName: 'OpenAI Codex', homePathSuffix: '.codex' },
  { Ctor: GeminiImporter, name: 'gemini', displayName: 'Google Gemini', homePathSuffix: '.gemini' },
  { Ctor: CursorImporter, name: 'cursor', displayName: 'Cursor', homePathSuffix: '.cursor' },
  { Ctor: ClineImporter, name: 'cline', displayName: 'Cline', homePathSuffix: '.cline' },
  { Ctor: ContinueImporter, name: 'continue', displayName: 'Continue.dev', homePathSuffix: '.continue' },
  { Ctor: AugmentImporter, name: 'augment', displayName: 'Augment', homePathSuffix: '.augment' },
];

describe('All importers – shared contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  for (const spec of importerSpecs) {
    describe(spec.displayName, () => {
      it(`should have name "${spec.name}"`, () => {
        const importer = new spec.Ctor();
        expect(importer.name).toBe(spec.name);
      });

      it(`should have displayName "${spec.displayName}"`, () => {
        const importer = new spec.Ctor();
        expect(importer.displayName).toBe(spec.displayName);
      });

      it(`should have homePath ending with "${spec.homePathSuffix}"`, () => {
        const importer = new spec.Ctor();
        expect(importer.homePath).toContain(spec.homePathSuffix);
      });

      it('should resolve homePath via resolvedHomePath using os.homedir()', () => {
        const importer = new spec.Ctor();
        // homePath uses ~ shorthand; resolvedHomePath expands to absolute
        expect(importer.homePath).toContain('~');
        const resolved = (importer as any).resolvedHomePath as string;
        expect(resolved).not.toContain('~');
        expect(resolved.startsWith('/')).toBe(true);
      });

      it('should implement detect() that returns a boolean promise', async () => {
        const importer = new spec.Ctor();
        const result = await importer.detect();
        expect(typeof result).toBe('boolean');
      });

      it('should return false from detect() when directory does not exist', async () => {
        const fse = await import('fs-extra');
        vi.mocked(fse.default.pathExists).mockResolvedValue(false as never);

        const importer = new spec.Ctor();
        const result = await importer.detect();
        expect(result).toBe(false);
      });

      it('should return true from detect() when directory exists', async () => {
        const fse = await import('fs-extra');
        vi.mocked(fse.default.pathExists).mockResolvedValue(true as never);

        const importer = new spec.Ctor();
        const result = await importer.detect();
        expect(result).toBe(true);
      });

      it('should return empty scan result when home directory does not exist', async () => {
        const fse = await import('fs-extra');
        vi.mocked(fse.default.pathExists).mockResolvedValue(false as never);

        const importer = new spec.Ctor();
        const result = await importer.scan();
        expect(result.source).toBe(spec.name);
        expect(result.available).toBeInstanceOf(Map);
        expect(result.available.size).toBe(0);
      });

      it('should return a well-formed import result', async () => {
        const importer = new spec.Ctor();
        const result = await importer.import(['sessions']);
        expect(result.source).toBe(spec.name);
        expect(result.imported).toBeInstanceOf(Map);
        expect(result.errors).toBeInstanceOf(Array);
        expect(typeof result.duration).toBe('number');
      });

      it('should implement the Importer interface', () => {
        const importer = new spec.Ctor();
        // Structural type check: all Importer methods exist
        const asImporter: Importer = importer;
        expect(asImporter.name).toBeDefined();
        expect(asImporter.displayName).toBeDefined();
        expect(asImporter.homePath).toBeDefined();
        expect(typeof asImporter.detect).toBe('function');
        expect(typeof asImporter.scan).toBe('function');
        expect(typeof asImporter.import).toBe('function');
      });

      it('should extend BaseImporter', () => {
        const importer = new spec.Ctor();
        expect(importer).toBeInstanceOf(BaseImporter);
      });
    });
  }
});
