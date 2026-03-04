/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ImportSource } from '../../src/import/types.js';

// Mock node:sqlite so CursorImporter can be loaded in Vitest
vi.mock('node:sqlite', () => ({
  DatabaseSync: vi.fn().mockImplementation(() => ({
    prepare: vi.fn(),
    close: vi.fn(),
  })),
}));

// Mock fs-extra so importers don't touch the real filesystem
vi.mock('fs-extra', () => ({
  default: {
    pathExists: vi.fn().mockResolvedValue(false),
    readFile: vi.fn(),
    ensureDir: vi.fn(),
    writeJson: vi.fn(),
    readJson: vi.fn(),
    writeFile: vi.fn(),
  },
}));

import fse from 'fs-extra';
import { ImporterRegistry } from '../../src/import/registry.js';

describe('ImporterRegistry', () => {
  let registry: ImporterRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new ImporterRegistry();
  });

  // ---------------------------------------------------------------
  // getAll()
  // ---------------------------------------------------------------
  describe('getAll()', () => {
    it('should return all 7 importers', () => {
      const all = registry.getAll();
      expect(all).toHaveLength(7);
    });

    it('should include every ImportSource', () => {
      const all = registry.getAll();
      const names = all.map(i => i.name);
      expect(names).toContain('claude');
      expect(names).toContain('codex');
      expect(names).toContain('gemini');
      expect(names).toContain('cursor');
      expect(names).toContain('cline');
      expect(names).toContain('continue');
      expect(names).toContain('augment');
    });

    it('should return importers with unique names', () => {
      const all = registry.getAll();
      const names = all.map(i => i.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });

  // ---------------------------------------------------------------
  // get()
  // ---------------------------------------------------------------
  describe('get()', () => {
    it('should return the correct importer for "claude"', () => {
      const importer = registry.get('claude');
      expect(importer).toBeDefined();
      expect(importer!.name).toBe('claude');
      expect(importer!.displayName).toBe('Claude Code');
    });

    it('should return the correct importer for "codex"', () => {
      const importer = registry.get('codex');
      expect(importer).toBeDefined();
      expect(importer!.name).toBe('codex');
      expect(importer!.displayName).toBe('OpenAI Codex');
    });

    it('should return the correct importer for "gemini"', () => {
      const importer = registry.get('gemini');
      expect(importer).toBeDefined();
      expect(importer!.name).toBe('gemini');
    });

    it('should return the correct importer for "cursor"', () => {
      const importer = registry.get('cursor');
      expect(importer).toBeDefined();
      expect(importer!.name).toBe('cursor');
    });

    it('should return the correct importer for "cline"', () => {
      const importer = registry.get('cline');
      expect(importer).toBeDefined();
      expect(importer!.name).toBe('cline');
    });

    it('should return the correct importer for "continue"', () => {
      const importer = registry.get('continue');
      expect(importer).toBeDefined();
      expect(importer!.name).toBe('continue');
    });

    it('should return the correct importer for "augment"', () => {
      const importer = registry.get('augment');
      expect(importer).toBeDefined();
      expect(importer!.name).toBe('augment');
    });

    it('should return undefined for unknown source name', () => {
      // cast to ImportSource for type-safety test
      const importer = registry.get('unknown' as ImportSource);
      expect(importer).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------
  // detectAvailable()
  // ---------------------------------------------------------------
  describe('detectAvailable()', () => {
    it('should return empty array when no agent directories exist', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      const available = await registry.detectAvailable();
      expect(available).toEqual([]);
    });

    it('should return only importers whose directories exist', async () => {
      // Make pathExists return true only for paths containing .claude or .codex
      vi.mocked(fse.pathExists).mockImplementation(async (p: string) => {
        const s = String(p);
        return s.includes('.claude') || s.includes('.codex');
      });

      const available = await registry.detectAvailable();
      expect(available).toHaveLength(2);
      const names = available.map(i => i.name);
      expect(names).toContain('claude');
      expect(names).toContain('codex');
    });

    it('should return all importers when all directories exist', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(true as never);

      const available = await registry.detectAvailable();
      expect(available).toHaveLength(7);
    });

    it('should call detect() on every registered importer', async () => {
      vi.mocked(fse.pathExists).mockResolvedValue(false as never);

      await registry.detectAvailable();
      // pathExists should be called once per importer
      expect(fse.pathExists).toHaveBeenCalledTimes(7);
    });
  });
});
