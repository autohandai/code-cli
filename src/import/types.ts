/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Supported agent sources for import.
 */
export type ImportSource = 'claude' | 'codex' | 'gemini' | 'cursor' | 'cline' | 'continue' | 'augment';

/**
 * Categories of data that can be imported from an agent.
 */
export type ImportCategory = 'sessions' | 'settings' | 'skills' | 'memory' | 'mcp' | 'hooks';

/**
 * Metadata about a supported import source.
 */
export interface ImportSourceInfo {
  readonly name: ImportSource;
  readonly displayName: string;
  readonly homePath: string;
  readonly description: string;
}

/**
 * Result of scanning a source for importable data.
 */
export interface ImportScanResult {
  readonly source: ImportSource;
  readonly available: Map<ImportCategory, { count: number; description: string }>;
  readonly version?: string;
}

/**
 * Per-category results after an import operation.
 */
export interface ImportCategoryResult {
  readonly success: number;
  readonly failed: number;
  readonly skipped: number;
  /** Reasons why items were skipped, with counts. e.g. { "already imported": 5, "empty session": 3 } */
  readonly skipReasons?: Record<string, number>;
}

/**
 * Full result of an import operation across all categories.
 */
export interface ImportResult {
  readonly source: ImportSource;
  readonly imported: Map<ImportCategory, ImportCategoryResult>;
  readonly errors: ImportError[];
  readonly duration: number;
}

/**
 * Details about a single import failure.
 */
export interface ImportError {
  readonly category: ImportCategory;
  readonly item: string;
  readonly error: string;
  readonly retriable: boolean;
}

/**
 * Progress report emitted during an import operation.
 */
export interface ImportProgress {
  readonly category: ImportCategory;
  readonly current: number;
  readonly total: number;
  readonly item: string;
  readonly status: 'importing' | 'retrying' | 'skipped' | 'failed' | 'done';
}

/**
 * Callback for receiving import progress updates.
 */
export type ProgressCallback = (progress: ImportProgress) => void;

/**
 * Options passed to the import command.
 */
export interface ImportOptions {
  readonly source?: ImportSource;
  readonly categories?: ImportCategory[];
  readonly all?: boolean;
  readonly dryRun?: boolean;
  readonly retryFailed?: boolean;
}

/**
 * Contract for an agent importer. Each supported source implements this interface.
 */
export interface Importer {
  readonly name: ImportSource;
  readonly displayName: string;
  readonly homePath: string;

  /** Check whether this agent's data directory exists on disk. */
  detect(): Promise<boolean>;

  /** Scan the agent's data directory and report what is available for import. */
  scan(): Promise<ImportScanResult>;

  /** Import selected categories, reporting progress via callback. */
  import(categories: ImportCategory[], onProgress?: ProgressCallback): Promise<ImportResult>;
}

/**
 * All supported import sources.
 */
export const IMPORT_SOURCES: readonly ImportSource[] = Object.freeze([
  'claude', 'codex', 'gemini', 'cursor', 'cline', 'continue', 'augment',
] as const);

/**
 * All importable categories.
 */
export const ALL_CATEGORIES: readonly ImportCategory[] = Object.freeze([
  'sessions', 'settings', 'skills', 'memory', 'mcp', 'hooks',
] as const);
