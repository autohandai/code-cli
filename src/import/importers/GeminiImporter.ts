/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import fse from 'fs-extra';
import type {
  ImportSource,
  ImportCategory,
  ImportScanResult,
  ImportResult,
  ImportError,
  ImportCategoryResult,
  ProgressCallback,
} from '../types.js';
import { AUTOHAND_PATHS } from '../../constants.js';
import { BaseImporter } from './BaseImporter.js';

/**
 * Importer for Google Gemini CLI data (~/.gemini).
 *
 * Handles settings (settings.json with hook configurations),
 * hooks (BeforeAgent/AfterAgent/AfterTool sections), and memory (GEMINI.md).
 */
export class GeminiImporter extends BaseImporter {
  readonly name: ImportSource = 'gemini';
  readonly displayName = 'Google Gemini';
  readonly homePath = '~/.gemini';

  // ---------------------------------------------------------------
  // scan()
  // ---------------------------------------------------------------

  async scan(): Promise<ImportScanResult> {
    const available = new Map<ImportCategory, { count: number; description: string }>();
    const home = this.resolvedHomePath;

    if (!(await fse.pathExists(home))) {
      return { source: this.name, available };
    }

    const settingsPath = path.join(home, 'settings.json');
    const hasSettings = await fse.pathExists(settingsPath);

    if (hasSettings) {
      available.set('settings', { count: 1, description: 'Gemini settings.json' });

      // Try to count hooks from settings
      try {
        const settings = await fse.readJson(settingsPath) as Record<string, unknown>;
        const hooks = settings.hooks as Record<string, unknown[]> | undefined;
        if (hooks) {
          const hookSections = Object.keys(hooks).filter(
            k => Array.isArray(hooks[k]) && hooks[k].length > 0,
          );
          if (hookSections.length > 0) {
            available.set('hooks', {
              count: hookSections.length,
              description: `${hookSections.length} hook section${hookSections.length !== 1 ? 's' : ''} (${hookSections.join(', ')})`,
            });
          }
        }
      } catch {
        // Cannot read settings for hook detection; skip
      }
    }

    // Check for GEMINI.md memory
    const geminiMdPath = path.join(home, 'GEMINI.md');
    if (await fse.pathExists(geminiMdPath)) {
      available.set('memory', { count: 1, description: 'GEMINI.md project memory' });
    }

    return { source: this.name, available };
  }

  // ---------------------------------------------------------------
  // import()
  // ---------------------------------------------------------------

  async import(
    categories: ImportCategory[],
    onProgress?: ProgressCallback,
  ): Promise<ImportResult> {
    const start = Date.now();
    const imported = new Map<ImportCategory, ImportCategoryResult>();
    const errors: ImportError[] = [];

    for (const category of categories) {
      switch (category) {
        case 'settings':
          await this.importSettings(imported, errors, onProgress);
          break;
        case 'hooks':
          await this.importHooks(imported, errors, onProgress);
          break;
        case 'memory':
          await this.importMemory(imported, errors, onProgress);
          break;
        default:
          break;
      }
    }

    return {
      source: this.name,
      imported,
      errors,
      duration: Date.now() - start,
    };
  }

  // ---------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------

  protected async importSettings(
    imported: Map<ImportCategory, ImportCategoryResult>,
    errors: ImportError[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const settingsPath = path.join(this.resolvedHomePath, 'settings.json');

    if (!(await fse.pathExists(settingsPath))) {
      imported.set('settings', { success: 0, failed: 0, skipped: 1 });
      return;
    }

    onProgress?.({
      category: 'settings',
      current: 1,
      total: 1,
      item: 'settings.json',
      status: 'importing',
    });

    try {
      const settings = await fse.readJson(settingsPath) as Record<string, unknown>;
      const configDir = AUTOHAND_PATHS.config;
      await fse.ensureDir(configDir);

      await fse.writeJson(
        path.join(configDir, 'imported-gemini-settings.json'),
        {
          importedFrom: 'gemini',
          importedAt: new Date().toISOString(),
          raw: settings,
        },
        { spaces: 2 },
      );

      imported.set('settings', { success: 1, failed: 0, skipped: 0 });

      onProgress?.({
        category: 'settings',
        current: 1,
        total: 1,
        item: 'settings.json',
        status: 'done',
      });
    } catch (err) {
      imported.set('settings', { success: 0, failed: 1, skipped: 0 });
      errors.push({
        category: 'settings',
        item: 'settings.json',
        error: err instanceof Error ? err.message : String(err),
        retriable: false,
      });
    }
  }

  // ---------------------------------------------------------------
  // Hooks
  // ---------------------------------------------------------------

  protected async importHooks(
    imported: Map<ImportCategory, ImportCategoryResult>,
    errors: ImportError[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const settingsPath = path.join(this.resolvedHomePath, 'settings.json');

    if (!(await fse.pathExists(settingsPath))) {
      imported.set('hooks', { success: 0, failed: 0, skipped: 1 });
      return;
    }

    onProgress?.({
      category: 'hooks',
      current: 1,
      total: 1,
      item: 'hooks from settings.json',
      status: 'importing',
    });

    try {
      const settings = await fse.readJson(settingsPath) as Record<string, unknown>;
      const hooks = settings.hooks as Record<string, unknown[]> | undefined;

      if (!hooks || Object.keys(hooks).length === 0) {
        imported.set('hooks', { success: 0, failed: 0, skipped: 1 });
        return;
      }

      const configDir = AUTOHAND_PATHS.config;
      await fse.ensureDir(configDir);

      await fse.writeJson(
        path.join(configDir, 'imported-gemini-hooks.json'),
        {
          importedFrom: 'gemini',
          importedAt: new Date().toISOString(),
          hooks,
        },
        { spaces: 2 },
      );

      imported.set('hooks', { success: 1, failed: 0, skipped: 0 });

      onProgress?.({
        category: 'hooks',
        current: 1,
        total: 1,
        item: 'hooks from settings.json',
        status: 'done',
      });
    } catch (err) {
      imported.set('hooks', { success: 0, failed: 1, skipped: 0 });
      errors.push({
        category: 'hooks',
        item: 'hooks from settings.json',
        error: err instanceof Error ? err.message : String(err),
        retriable: false,
      });
    }
  }

  // ---------------------------------------------------------------
  // Memory
  // ---------------------------------------------------------------

  protected async importMemory(
    imported: Map<ImportCategory, ImportCategoryResult>,
    errors: ImportError[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const geminiMdPath = path.join(this.resolvedHomePath, 'GEMINI.md');

    if (!(await fse.pathExists(geminiMdPath))) {
      imported.set('memory', { success: 0, failed: 0, skipped: 1 });
      return;
    }

    onProgress?.({
      category: 'memory',
      current: 1,
      total: 1,
      item: 'GEMINI.md',
      status: 'importing',
    });

    try {
      const destDir = path.join(AUTOHAND_PATHS.memory, 'imported-gemini');
      await fse.ensureDir(destDir);
      await fse.copy(geminiMdPath, path.join(destDir, 'GEMINI.md'));

      imported.set('memory', { success: 1, failed: 0, skipped: 0 });

      onProgress?.({
        category: 'memory',
        current: 1,
        total: 1,
        item: 'GEMINI.md',
        status: 'done',
      });
    } catch (err) {
      imported.set('memory', { success: 0, failed: 1, skipped: 0 });
      errors.push({
        category: 'memory',
        item: 'GEMINI.md',
        error: err instanceof Error ? err.message : String(err),
        retriable: true,
      });
    }
  }
}
