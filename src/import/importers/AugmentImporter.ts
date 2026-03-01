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
 * Importer for Augment agent data (~/.augment).
 *
 * Minimal importer: scans for MCP server configs and general settings.
 * Most Augment data lives in the app bundle, so this importer covers
 * whatever is available in the user data directory.
 */
export class AugmentImporter extends BaseImporter {
  readonly name: ImportSource = 'augment';
  readonly displayName = 'Augment';
  readonly homePath = '~/.augment';

  // ---------------------------------------------------------------
  // scan()
  // ---------------------------------------------------------------

  async scan(): Promise<ImportScanResult> {
    const available = new Map<ImportCategory, { count: number; description: string }>();
    const home = this.resolvedHomePath;

    if (!(await fse.pathExists(home))) {
      return { source: this.name, available };
    }

    // Check for MCP config
    const mcpPath = path.join(home, 'mcp.json');
    if (await fse.pathExists(mcpPath)) {
      available.set('mcp', { count: 1, description: 'Augment MCP server configurations' });
    }

    // Check for settings
    const settingsPath = path.join(home, 'settings.json');
    if (await fse.pathExists(settingsPath)) {
      available.set('settings', { count: 1, description: 'Augment settings' });
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
        case 'mcp':
          await this.importMcp(imported, errors, onProgress);
          break;
        case 'settings':
          await this.importSettings(imported, errors, onProgress);
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
  // MCP
  // ---------------------------------------------------------------

  protected async importMcp(
    imported: Map<ImportCategory, ImportCategoryResult>,
    errors: ImportError[],
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const mcpPath = path.join(this.resolvedHomePath, 'mcp.json');

    if (!(await fse.pathExists(mcpPath))) {
      imported.set('mcp', { success: 0, failed: 0, skipped: 1 });
      return;
    }

    onProgress?.({
      category: 'mcp',
      current: 1,
      total: 1,
      item: 'mcp.json',
      status: 'importing',
    });

    try {
      const mcpData = await fse.readJson(mcpPath) as Record<string, unknown>;
      const configDir = AUTOHAND_PATHS.config;
      await fse.ensureDir(configDir);

      await fse.writeJson(
        path.join(configDir, 'imported-augment-mcp.json'),
        {
          importedFrom: 'augment',
          importedAt: new Date().toISOString(),
          mcpServers: mcpData.mcpServers ?? mcpData,
        },
        { spaces: 2 },
      );

      imported.set('mcp', { success: 1, failed: 0, skipped: 0 });

      onProgress?.({
        category: 'mcp',
        current: 1,
        total: 1,
        item: 'mcp.json',
        status: 'done',
      });
    } catch (err) {
      imported.set('mcp', { success: 0, failed: 1, skipped: 0 });
      errors.push({
        category: 'mcp',
        item: 'mcp.json',
        error: err instanceof Error ? err.message : String(err),
        retriable: false,
      });
    }
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
        path.join(configDir, 'imported-augment-settings.json'),
        {
          importedFrom: 'augment',
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
}
