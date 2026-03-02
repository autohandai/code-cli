/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import type {
  ImportSource,
  ImportCategory,
  ImportSourceInfo,
  ImportScanResult,
  ImportCategoryResult,
  ImportResult,
  ImportError,
  ImportProgress,
  ProgressCallback,
  ImportOptions,
  Importer,
} from '../../src/import/types.js';
import {
  IMPORT_SOURCES,
  ALL_CATEGORIES,
} from '../../src/import/types.js';

describe('Import types', () => {
  describe('ImportSource', () => {
    it('should accept all valid source strings', () => {
      const sources: ImportSource[] = [
        'claude', 'codex', 'gemini', 'cursor', 'cline', 'continue', 'augment',
      ];
      expect(sources).toHaveLength(7);
    });
  });

  describe('ImportCategory', () => {
    it('should accept all valid category strings', () => {
      const categories: ImportCategory[] = [
        'sessions', 'settings', 'skills', 'memory', 'mcp', 'hooks',
      ];
      expect(categories).toHaveLength(6);
    });
  });

  describe('IMPORT_SOURCES constant', () => {
    it('should contain all 7 sources', () => {
      expect(IMPORT_SOURCES).toHaveLength(7);
    });

    it('should include every known source', () => {
      expect(IMPORT_SOURCES).toContain('claude');
      expect(IMPORT_SOURCES).toContain('codex');
      expect(IMPORT_SOURCES).toContain('gemini');
      expect(IMPORT_SOURCES).toContain('cursor');
      expect(IMPORT_SOURCES).toContain('cline');
      expect(IMPORT_SOURCES).toContain('continue');
      expect(IMPORT_SOURCES).toContain('augment');
    });

    it('should be readonly', () => {
      // TypeScript readonly enforcement; at runtime we verify it is frozen or typed as const
      expect(Object.isFrozen(IMPORT_SOURCES)).toBe(true);
    });
  });

  describe('ALL_CATEGORIES constant', () => {
    it('should contain all 6 categories', () => {
      expect(ALL_CATEGORIES).toHaveLength(6);
    });

    it('should include every known category', () => {
      expect(ALL_CATEGORIES).toContain('sessions');
      expect(ALL_CATEGORIES).toContain('settings');
      expect(ALL_CATEGORIES).toContain('skills');
      expect(ALL_CATEGORIES).toContain('memory');
      expect(ALL_CATEGORIES).toContain('mcp');
      expect(ALL_CATEGORIES).toContain('hooks');
    });

    it('should be readonly', () => {
      expect(Object.isFrozen(ALL_CATEGORIES)).toBe(true);
    });
  });

  describe('ImportSourceInfo', () => {
    it('should accept a valid source info object', () => {
      const info: ImportSourceInfo = {
        name: 'claude',
        displayName: 'Claude Code',
        homePath: '~/.claude',
        description: 'Import from Claude Code CLI',
      };
      expect(info.name).toBe('claude');
      expect(info.displayName).toBe('Claude Code');
      expect(info.homePath).toBe('~/.claude');
      expect(info.description).toBe('Import from Claude Code CLI');
    });
  });

  describe('ImportScanResult', () => {
    it('should accept a scan result with available categories', () => {
      const result: ImportScanResult = {
        source: 'claude',
        available: new Map([
          ['sessions', { count: 12, description: '12 sessions found' }],
          ['settings', { count: 1, description: 'Config file found' }],
        ]),
      };
      expect(result.source).toBe('claude');
      expect(result.available.size).toBe(2);
      expect(result.available.get('sessions')?.count).toBe(12);
    });

    it('should allow optional version field', () => {
      const result: ImportScanResult = {
        source: 'codex',
        available: new Map(),
        version: '1.2.3',
      };
      expect(result.version).toBe('1.2.3');
    });

    it('should work with empty available map', () => {
      const result: ImportScanResult = {
        source: 'gemini',
        available: new Map(),
      };
      expect(result.available.size).toBe(0);
    });
  });

  describe('ImportCategoryResult', () => {
    it('should track success, failed, and skipped counts', () => {
      const result: ImportCategoryResult = {
        success: 10,
        failed: 2,
        skipped: 1,
      };
      expect(result.success).toBe(10);
      expect(result.failed).toBe(2);
      expect(result.skipped).toBe(1);
    });
  });

  describe('ImportResult', () => {
    it('should accept a complete import result', () => {
      const result: ImportResult = {
        source: 'claude',
        imported: new Map([
          ['sessions', { success: 5, failed: 0, skipped: 0 }],
        ]),
        errors: [],
        duration: 1234,
      };
      expect(result.source).toBe('claude');
      expect(result.imported.get('sessions')?.success).toBe(5);
      expect(result.errors).toHaveLength(0);
      expect(result.duration).toBe(1234);
    });

    it('should accept import result with errors', () => {
      const result: ImportResult = {
        source: 'codex',
        imported: new Map(),
        errors: [
          {
            category: 'sessions',
            item: 'session-abc',
            error: 'Corrupt JSON',
            retriable: false,
          },
        ],
        duration: 500,
      };
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].retriable).toBe(false);
    });
  });

  describe('ImportError', () => {
    it('should capture error details with retriability', () => {
      const err: ImportError = {
        category: 'settings',
        item: 'config.json',
        error: 'Permission denied',
        retriable: true,
      };
      expect(err.category).toBe('settings');
      expect(err.item).toBe('config.json');
      expect(err.error).toBe('Permission denied');
      expect(err.retriable).toBe(true);
    });
  });

  describe('ImportProgress', () => {
    it('should represent in-progress state', () => {
      const progress: ImportProgress = {
        category: 'sessions',
        current: 3,
        total: 10,
        item: 'session-xyz',
        status: 'importing',
      };
      expect(progress.category).toBe('sessions');
      expect(progress.current).toBe(3);
      expect(progress.total).toBe(10);
      expect(progress.status).toBe('importing');
    });

    it('should accept all valid status values', () => {
      const statuses: ImportProgress['status'][] = [
        'importing', 'retrying', 'skipped', 'failed', 'done',
      ];
      expect(statuses).toHaveLength(5);
    });
  });

  describe('ProgressCallback', () => {
    it('should be a function accepting ImportProgress', () => {
      const cb: ProgressCallback = (progress: ImportProgress) => {
        expect(progress.category).toBe('sessions');
      };
      cb({
        category: 'sessions',
        current: 1,
        total: 1,
        item: 'test',
        status: 'done',
      });
    });
  });

  describe('ImportOptions', () => {
    it('should accept empty options', () => {
      const opts: ImportOptions = {};
      expect(opts.source).toBeUndefined();
      expect(opts.categories).toBeUndefined();
      expect(opts.all).toBeUndefined();
      expect(opts.dryRun).toBeUndefined();
      expect(opts.retryFailed).toBeUndefined();
    });

    it('should accept fully-specified options', () => {
      const opts: ImportOptions = {
        source: 'claude',
        categories: ['sessions', 'settings'],
        all: true,
        dryRun: false,
        retryFailed: true,
      };
      expect(opts.source).toBe('claude');
      expect(opts.categories).toEqual(['sessions', 'settings']);
      expect(opts.all).toBe(true);
      expect(opts.dryRun).toBe(false);
      expect(opts.retryFailed).toBe(true);
    });
  });

  describe('Importer interface', () => {
    it('should be implementable with correct shape', () => {
      const importer: Importer = {
        name: 'claude',
        displayName: 'Claude Code',
        homePath: '~/.claude',
        detect: async () => true,
        scan: async () => ({
          source: 'claude',
          available: new Map(),
        }),
        import: async () => ({
          source: 'claude',
          imported: new Map(),
          errors: [],
          duration: 0,
        }),
      };
      expect(importer.name).toBe('claude');
      expect(importer.displayName).toBe('Claude Code');
      expect(typeof importer.detect).toBe('function');
      expect(typeof importer.scan).toBe('function');
      expect(typeof importer.import).toBe('function');
    });

    it('detect should return a promise of boolean', async () => {
      const importer: Importer = {
        name: 'test',
        displayName: 'Test',
        homePath: '/tmp',
        detect: async () => false,
        scan: async () => ({ source: 'test' as ImportSource, available: new Map() }),
        import: async () => ({ source: 'test' as ImportSource, imported: new Map(), errors: [], duration: 0 }),
      };
      const result = await importer.detect();
      expect(result).toBe(false);
    });

    it('scan should return ImportScanResult', async () => {
      const importer: Importer = {
        name: 'test',
        displayName: 'Test',
        homePath: '/tmp',
        detect: async () => true,
        scan: async () => ({
          source: 'codex' as ImportSource,
          available: new Map([['sessions', { count: 5, description: '5 sessions' }]]),
        }),
        import: async () => ({ source: 'codex' as ImportSource, imported: new Map(), errors: [], duration: 0 }),
      };
      const scan = await importer.scan();
      expect(scan.available.get('sessions')?.count).toBe(5);
    });

    it('import should accept categories and progress callback', async () => {
      let progressCalled = false;
      const importer: Importer = {
        name: 'test',
        displayName: 'Test',
        homePath: '/tmp',
        detect: async () => true,
        scan: async () => ({ source: 'claude' as ImportSource, available: new Map() }),
        import: async (categories, onProgress) => {
          if (onProgress) {
            onProgress({ category: 'sessions', current: 1, total: 1, item: 'test', status: 'done' });
            progressCalled = true;
          }
          return { source: 'claude' as ImportSource, imported: new Map(), errors: [], duration: 0 };
        },
      };
      await importer.import(['sessions'], (_p) => { progressCalled = true; });
      expect(progressCalled).toBe(true);
    });
  });
});
