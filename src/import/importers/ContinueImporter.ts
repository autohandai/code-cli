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
 * Importer for Continue.dev agent data (~/.continue).
 *
 * Handles settings from config.json, including model configurations,
 * context providers, slash commands, and embeddings configuration.
 */
export class ContinueImporter extends BaseImporter {
  readonly name: ImportSource = 'continue';
  readonly displayName = 'Continue.dev';
  readonly homePath = '~/.continue';

  // ---------------------------------------------------------------
  // scan()
  // ---------------------------------------------------------------

  async scan(): Promise<ImportScanResult> {
    const available = new Map<ImportCategory, { count: number; description: string }>();
    const home = this.resolvedHomePath;

    if (!(await fse.pathExists(home))) {
      return { source: this.name, available };
    }

    const configPath = path.join(home, 'config.json');
    if (await fse.pathExists(configPath)) {
      available.set('settings', {
        count: 1,
        description: 'Continue.dev config (models, context providers, slash commands, embeddings)',
      });
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
        default:
          // Continue only supports settings import
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
    const configPath = path.join(this.resolvedHomePath, 'config.json');

    if (!(await fse.pathExists(configPath))) {
      imported.set('settings', { success: 0, failed: 0, skipped: 1 });
      return;
    }

    onProgress?.({
      category: 'settings',
      current: 1,
      total: 1,
      item: 'config.json',
      status: 'importing',
    });

    try {
      const config = await fse.readJson(configPath) as Record<string, unknown>;

      // Extract relevant sections
      const extracted: Record<string, unknown> = {
        importedFrom: 'continue',
        importedAt: new Date().toISOString(),
      };

      if (config.models) extracted.models = config.models;
      if (config.contextProviders) extracted.contextProviders = config.contextProviders;
      if (config.slashCommands) extracted.slashCommands = config.slashCommands;
      if (config.embeddingsProvider) extracted.embeddingsProvider = config.embeddingsProvider;

      const configDir = AUTOHAND_PATHS.config;
      await fse.ensureDir(configDir);

      await fse.writeJson(
        path.join(configDir, 'imported-continue-settings.json'),
        extracted,
        { spaces: 2 },
      );

      imported.set('settings', { success: 1, failed: 0, skipped: 0 });

      onProgress?.({
        category: 'settings',
        current: 1,
        total: 1,
        item: 'config.json',
        status: 'done',
      });
    } catch (err) {
      imported.set('settings', { success: 0, failed: 1, skipped: 0 });
      errors.push({
        category: 'settings',
        item: 'config.json',
        error: err instanceof Error ? err.message : String(err),
        retriable: false,
      });
    }
  }
}
