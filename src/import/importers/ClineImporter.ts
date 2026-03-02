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
 * Importer for Cline agent data (~/.cline).
 *
 * Handles settings extracted from data/globalState.json, including
 * model preferences, auto-approval settings, browser settings,
 * and workspace roots.
 */
export class ClineImporter extends BaseImporter {
  readonly name: ImportSource = 'cline';
  readonly displayName = 'Cline';
  readonly homePath = '~/.cline';

  // ---------------------------------------------------------------
  // scan()
  // ---------------------------------------------------------------

  async scan(): Promise<ImportScanResult> {
    const available = new Map<ImportCategory, { count: number; description: string }>();
    const home = this.resolvedHomePath;

    if (!(await fse.pathExists(home))) {
      return { source: this.name, available };
    }

    const globalStatePath = path.join(home, 'data', 'globalState.json');
    if (await fse.pathExists(globalStatePath)) {
      available.set('settings', {
        count: 1,
        description: 'Cline global state (model preferences, auto-approval, browser settings)',
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
          // Cline only supports settings import
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
    const globalStatePath = path.join(this.resolvedHomePath, 'data', 'globalState.json');

    if (!(await fse.pathExists(globalStatePath))) {
      imported.set('settings', { success: 0, failed: 0, skipped: 1 });
      return;
    }

    onProgress?.({
      category: 'settings',
      current: 1,
      total: 1,
      item: 'globalState.json',
      status: 'importing',
    });

    try {
      const state = await this.safeReadJson(globalStatePath);

      // Extract relevant settings
      const extracted: Record<string, unknown> = {};
      if (state.apiModelId) extracted.model = state.apiModelId;
      if (state.autoApprovalSettings) extracted.autoApproval = state.autoApprovalSettings;
      if (state.browserSettings) extracted.browser = state.browserSettings;
      if (state.workspaceRoots) extracted.workspaceRoots = state.workspaceRoots;

      const configDir = AUTOHAND_PATHS.config;
      await fse.ensureDir(configDir);

      await fse.writeJson(
        path.join(configDir, 'imported-cline-settings.json'),
        {
          importedFrom: 'cline',
          importedAt: new Date().toISOString(),
          ...extracted,
          raw: state,
        },
        { spaces: 2 },
      );

      imported.set('settings', { success: 1, failed: 0, skipped: 0 });

      onProgress?.({
        category: 'settings',
        current: 1,
        total: 1,
        item: 'globalState.json',
        status: 'done',
      });
    } catch (err) {
      imported.set('settings', { success: 0, failed: 1, skipped: 0 });
      errors.push({
        category: 'settings',
        item: 'globalState.json',
        error: err instanceof Error ? err.message : String(err),
        retriable: false,
      });
    }
  }
}
