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
 * Importer for Cursor editor data (~/.cursor).
 *
 * Handles settings and hooks (hooks.json), and MCP server configurations (mcp.json).
 */
export class CursorImporter extends BaseImporter {
  readonly name: ImportSource = 'cursor';
  readonly displayName = 'Cursor';
  readonly homePath = '~/.cursor';

  // ---------------------------------------------------------------
  // scan()
  // ---------------------------------------------------------------

  async scan(): Promise<ImportScanResult> {
    const available = new Map<ImportCategory, { count: number; description: string }>();
    const home = this.resolvedHomePath;

    if (!(await fse.pathExists(home))) {
      return { source: this.name, available };
    }

    // Check hooks.json (provides both settings and hooks)
    const hooksPath = path.join(home, 'hooks.json');
    if (await fse.pathExists(hooksPath)) {
      available.set('settings', { count: 1, description: 'Cursor hooks.json preferences' });
      available.set('hooks', { count: 1, description: 'Cursor hook configurations' });
    }

    // Check mcp.json
    const mcpPath = path.join(home, 'mcp.json');
    if (await fse.pathExists(mcpPath)) {
      available.set('mcp', { count: 1, description: 'Cursor MCP server configurations' });
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
        case 'mcp':
          await this.importMcp(imported, errors, onProgress);
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
    const hooksPath = path.join(this.resolvedHomePath, 'hooks.json');

    if (!(await fse.pathExists(hooksPath))) {
      imported.set('settings', { success: 0, failed: 0, skipped: 1 });
      return;
    }

    onProgress?.({
      category: 'settings',
      current: 1,
      total: 1,
      item: 'hooks.json',
      status: 'importing',
    });

    try {
      const hooksData = await this.safeReadJson(hooksPath);
      const configDir = AUTOHAND_PATHS.config;
      await fse.ensureDir(configDir);

      await fse.writeJson(
        path.join(configDir, 'imported-cursor-settings.json'),
        {
          importedFrom: 'cursor',
          importedAt: new Date().toISOString(),
          raw: hooksData,
        },
        { spaces: 2 },
      );

      imported.set('settings', { success: 1, failed: 0, skipped: 0 });

      onProgress?.({
        category: 'settings',
        current: 1,
        total: 1,
        item: 'hooks.json',
        status: 'done',
      });
    } catch (err) {
      imported.set('settings', { success: 0, failed: 1, skipped: 0 });
      errors.push({
        category: 'settings',
        item: 'hooks.json',
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
    const hooksPath = path.join(this.resolvedHomePath, 'hooks.json');

    if (!(await fse.pathExists(hooksPath))) {
      imported.set('hooks', { success: 0, failed: 0, skipped: 1 });
      return;
    }

    onProgress?.({
      category: 'hooks',
      current: 1,
      total: 1,
      item: 'hooks.json',
      status: 'importing',
    });

    try {
      const hooksData = await this.safeReadJson(hooksPath);
      const configDir = AUTOHAND_PATHS.config;
      await fse.ensureDir(configDir);

      await fse.writeJson(
        path.join(configDir, 'imported-cursor-hooks.json'),
        {
          importedFrom: 'cursor',
          importedAt: new Date().toISOString(),
          hooks: hooksData.hooks ?? hooksData,
        },
        { spaces: 2 },
      );

      imported.set('hooks', { success: 1, failed: 0, skipped: 0 });

      onProgress?.({
        category: 'hooks',
        current: 1,
        total: 1,
        item: 'hooks.json',
        status: 'done',
      });
    } catch (err) {
      imported.set('hooks', { success: 0, failed: 1, skipped: 0 });
      errors.push({
        category: 'hooks',
        item: 'hooks.json',
        error: err instanceof Error ? err.message : String(err),
        retriable: false,
      });
    }
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
      const mcpData = await this.safeReadJson(mcpPath);
      const configDir = AUTOHAND_PATHS.config;
      await fse.ensureDir(configDir);

      await fse.writeJson(
        path.join(configDir, 'imported-cursor-mcp.json'),
        {
          importedFrom: 'cursor',
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
}
