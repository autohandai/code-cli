/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Importer, ImportSource } from './types.js';
import { GrokImporter } from './importers/GrokImporter.js';
import type { HookImportOptions } from './HookImportService.js';
import { ClaudeImporter } from './importers/ClaudeImporter.js';
import { CodexImporter } from './importers/CodexImporter.js';
import { GeminiImporter } from './importers/GeminiImporter.js';
import { CursorImporter } from './importers/CursorImporter.js';
import { ClineImporter } from './importers/ClineImporter.js';
import { ContinueImporter } from './importers/ContinueImporter.js';
import { AugmentImporter } from './importers/AugmentImporter.js';
import { OpencodeImporter } from './importers/OpencodeImporter.js';
import { KimiImporter } from './importers/KimiImporter.js';

/**
 * Central registry for all agent importers.
 *
 * Provides lookup by source name, enumeration, and parallel detection
 * of which agent data directories exist on the current machine.
 */
export class ImporterRegistry {
  private readonly importers: Map<ImportSource, Importer>;

  constructor(options: HookImportOptions = {}) {
    this.importers = new Map();
    this.register(new ClaudeImporter(options));
    this.register(new CodexImporter(options));
    this.register(new GeminiImporter(options));
    this.register(new CursorImporter(options));
    this.register(new ClineImporter(options));
    this.register(new ContinueImporter(options));
    this.register(new AugmentImporter(options));
    this.register(new OpencodeImporter(options));
    this.register(new KimiImporter(options));
    this.register(new GrokImporter(options));
  }

  /**
   * Register an importer instance by its source name.
   */
  private register(importer: Importer): void {
    this.importers.set(importer.name, importer);
  }

  /**
   * Get an importer by its source name.
   * Returns undefined if the source is not registered.
   */
  get(name: ImportSource): Importer | undefined {
    return this.importers.get(name);
  }

  /**
   * Get all registered importers.
   */
  getAll(): Importer[] {
    return Array.from(this.importers.values());
  }

  /**
   * Detect which agent data directories exist on disk.
   * Runs all detect() calls in parallel for speed.
   */
  async detectAvailable(): Promise<Importer[]> {
    const results = await Promise.all(
      this.getAll().map(async (importer) => ({
        importer,
        exists: await importer.detect(),
      })),
    );
    return results.filter(r => r.exists).map(r => r.importer);
  }
}
