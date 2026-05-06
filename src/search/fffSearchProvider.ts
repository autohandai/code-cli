/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type GrepResult,
  type Result,
  type SearchResult,
} from '@ff-labs/fff-bun';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { resolveRipgrepCommand } from '../utils/ripgrep.js';

const execFileAsync = promisify(execFile);

export interface GrepParams {
  query: string;
  path?: string;
  exclude?: string;
  caseSensitive?: boolean;
  beforeContext?: number;
  afterContext?: number;
  classifyDefinitions?: boolean;
  limit?: number;
}

export interface FindParams {
  query: string;
  limit?: number;
}

type GrepMode = 'plain' | 'regex' | 'fuzzy';

interface SearchBackend {
  grep(params: GrepParams): Promise<string>;
  fileSearch(params: FindParams): Promise<string>;
  destroy(): void;
}

interface NativeFinder {
  waitForScan(timeoutMs: number): Result<boolean>;
  grep(query: string, options?: {
    mode?: GrepMode;
    smartCase?: boolean;
    beforeContext?: number;
    afterContext?: number;
    maxMatchesPerFile?: number;
  }): Result<GrepResult>;
  fileSearch(query: string, options?: { pageSize?: number }): Result<SearchResult>;
  destroy(): void;
}

interface FFFPackage {
  FileFinder?: {
    create?: (options: {
      basePath: string;
      aiMode?: boolean;
    }) => Result<NativeFinder>;
  };
}

type NativeHandle = unknown;

interface FfiModule {
  ffiCreate(
    basePath: string,
    frecencyDbPath: string,
    historyDbPath: string,
    useUnsafeNoLock: boolean,
    enableMmapCache: boolean,
    enableContentIndexing: boolean,
    watch: boolean,
    aiMode: boolean,
    logFilePath: string,
    logLevel: string,
    cacheBudgetMaxFiles: bigint,
    cacheBudgetMaxBytes: bigint,
    cacheBudgetMaxFileSize: bigint,
  ): Result<NativeHandle>;
  ffiDestroy(handle: NativeHandle): void;
  ffiWaitForScan(handle: NativeHandle, timeoutMs: number): Result<boolean>;
  ffiSearch(
    handle: NativeHandle,
    query: string,
    currentFile: string,
    maxThreads: number,
    pageIndex: number,
    pageSize: number,
    comboBoostMultiplier: number,
    minComboCount: number,
  ): Result<SearchResult>;
  ffiLiveGrep(
    handle: NativeHandle,
    query: string,
    mode: string,
    maxFileSize: number,
    maxMatchesPerFile: number,
    smartCase: boolean,
    fileOffset: number,
    pageLimit: number,
    timeBudgetMs: number,
    beforeContext: number,
    afterContext: number,
    classifyDefinitions: boolean,
  ): Result<GrepResult>;
}

export class FFFSearchProvider {
  private backend: SearchBackend;

  private constructor(backend: SearchBackend) {
    this.backend = backend;
  }

  static async create(workspaceRoot: string): Promise<FFFSearchProvider> {
    const backend =
      await createNativeClassBackend(workspaceRoot)
      ?? await createLowLevelFfiBackend(workspaceRoot)
      ?? new RipgrepSearchBackend(workspaceRoot);

    return new FFFSearchProvider(backend);
  }

  async grep(params: GrepParams): Promise<string> {
    return this.backend.grep(params);
  }

  async fileSearch(params: FindParams): Promise<string> {
    return this.backend.fileSearch(params);
  }

  destroy(): void {
    this.backend.destroy();
  }
}

async function createNativeClassBackend(workspaceRoot: string): Promise<SearchBackend | null> {
  try {
    const fffPackage = await import('@ff-labs/fff-bun') as FFFPackage;
    const create = fffPackage.FileFinder?.create;
    if (typeof create !== 'function') {
      return null;
    }

    const result = create({
      basePath: workspaceRoot,
      aiMode: true,
    });

    if (!result.ok) {
      throw new Error(`Failed to initialize FFF: ${result.error}`);
    }

    const finder = result.value;
    if (
      typeof finder.waitForScan !== 'function'
      || typeof finder.grep !== 'function'
      || typeof finder.fileSearch !== 'function'
      || typeof finder.destroy !== 'function'
    ) {
      finder.destroy?.();
      return null;
    }

    const scanResult = finder.waitForScan(10_000);
    if (!scanResult.ok) {
      throw new Error(`Failed to scan workspace with FFF: ${scanResult.error}`);
    }

    return new NativeClassSearchBackend(finder);
  } catch {
    return null;
  }
}

async function createLowLevelFfiBackend(workspaceRoot: string): Promise<SearchBackend | null> {
  try {
    const ffi = await importLowLevelFfiModule();
    if (!ffi) {
      return null;
    }

    const result = ffi.ffiCreate(
      workspaceRoot,
      '',
      '',
      false,
      true,
      true,
      true,
      true,
      '',
      '',
      0n,
      0n,
      0n,
    );
    if (!result.ok) {
      throw new Error(`Failed to initialize FFF: ${result.error}`);
    }

    const scanResult = ffi.ffiWaitForScan(result.value, 10_000);
    if (!scanResult.ok) {
      ffi.ffiDestroy(result.value);
      throw new Error(`Failed to scan workspace with FFF: ${scanResult.error}`);
    }

    return new LowLevelFfiSearchBackend(ffi, result.value);
  } catch {
    return null;
  }
}

async function importLowLevelFfiModule(): Promise<FfiModule | null> {
  try {
    const require = createRequire(import.meta.url);
    const packageJsonPath = require.resolve('@ff-labs/fff-bun/package.json');
    const ffiPath = path.join(path.dirname(packageJsonPath), 'src', 'ffi.ts');
    return await import(pathToFileURL(ffiPath).href) as FfiModule;
  } catch {
    return null;
  }
}

class NativeClassSearchBackend implements SearchBackend {
  constructor(private readonly finder: NativeFinder) {}

  async grep(params: GrepParams): Promise<string> {
    const query = buildConstrainedQuery(params);
    const mode = inferGrepMode(params.query);
    const result = unwrap(this.finder.grep(query, {
      mode,
      smartCase: !params.caseSensitive,
      beforeContext: params.beforeContext ?? 2,
      afterContext: params.afterContext ?? 2,
      maxMatchesPerFile: params.limit,
    }));

    if (!result.items.length && mode !== 'fuzzy') {
      return formatGrepResult(unwrap(this.finder.grep(query, {
        mode: 'fuzzy',
        smartCase: !params.caseSensitive,
        beforeContext: params.beforeContext ?? 2,
        afterContext: params.afterContext ?? 2,
        maxMatchesPerFile: params.limit,
      })), params.limit);
    }

    return formatGrepResult(result, params.limit);
  }

  async fileSearch(params: FindParams): Promise<string> {
    return formatSearchResult(unwrap(this.finder.fileSearch(params.query, {
      pageSize: params.limit ?? 50,
    })));
  }

  destroy(): void {
    this.finder.destroy();
  }
}

class LowLevelFfiSearchBackend implements SearchBackend {
  constructor(
    private readonly ffi: FfiModule,
    private readonly handle: NativeHandle,
  ) {}

  async grep(params: GrepParams): Promise<string> {
    const query = buildConstrainedQuery(params);
    const mode = inferGrepMode(params.query);
    const result = this.grepWithMode(query, mode, params);

    if (!result.items.length && mode !== 'fuzzy') {
      return formatGrepResult(this.grepWithMode(query, 'fuzzy', params), params.limit);
    }

    return formatGrepResult(result, params.limit);
  }

  async fileSearch(params: FindParams): Promise<string> {
    const result = this.ffi.ffiSearch(
      this.handle,
      params.query,
      '',
      0,
      0,
      params.limit ?? 50,
      0,
      0,
    );
    return formatSearchResult(unwrap(result));
  }

  destroy(): void {
    this.ffi.ffiDestroy(this.handle);
  }

  private grepWithMode(query: string, mode: GrepMode, params: GrepParams): GrepResult {
    return unwrap(this.ffi.ffiLiveGrep(
      this.handle,
      query,
      mode,
      0,
      0,
      !params.caseSensitive,
      0,
      params.limit ?? 50,
      0,
      params.beforeContext ?? 2,
      params.afterContext ?? 2,
      params.classifyDefinitions ?? true,
    ));
  }
}

class RipgrepSearchBackend implements SearchBackend {
  constructor(private readonly workspaceRoot: string) {}

  async grep(params: GrepParams): Promise<string> {
    const target = normalizeSearchTarget(params.path);
    const args = [
      '--line-number',
      '--color',
      'never',
      '--no-heading',
      '--with-filename',
      '--no-binary',
      params.caseSensitive ? '--case-sensitive' : '--smart-case',
    ];

    const mode = inferGrepMode(params.query);
    if (mode === 'plain') {
      args.push('--fixed-strings');
    }

    if (params.beforeContext !== undefined) {
      args.push('--before-context', String(params.beforeContext));
    }
    if (params.afterContext !== undefined) {
      args.push('--after-context', String(params.afterContext));
    }
    for (const pattern of splitExcludePatterns(params.exclude)) {
      args.push('--glob', `!${pattern}`);
    }
    args.push(params.query, target);

    try {
      const result = await execFileAsync(resolveRipgrepCommand(), args, {
        cwd: this.workspaceRoot,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
      const lines = result.stdout.trim().split('\n').filter(Boolean);
      if (!lines.length) {
        return 'No matches found.';
      }
      return formatPlainLines(lines, params.limit ?? 50, 'match', 'matches');
    } catch (error) {
      if (isNoMatchError(error)) {
        return 'No matches found.';
      }
      throw error;
    }
  }

  async fileSearch(params: FindParams): Promise<string> {
    try {
      const result = await execFileAsync(resolveRipgrepCommand(), ['--files', '.'], {
        cwd: this.workspaceRoot,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
      const files = result.stdout.trim().split('\n').filter(Boolean);
      const ranked = rankPaths(files, params.query).slice(0, params.limit ?? 50);
      if (!ranked.length) {
        return 'No files found.';
      }
      return ranked.join('\n');
    } catch (error) {
      if (isNoMatchError(error)) {
        return 'No files found.';
      }
      throw error;
    }
  }

  destroy(): void {}
}

function unwrap<T extends GrepResult | SearchResult | boolean | NativeHandle>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(result.error);
  }

  return result.value;
}

function formatGrepResult(searchResult: GrepResult, limit = 50): string {
  const hits = searchResult.items;

  if (!hits.length) {
    return 'No matches found.';
  }

  const limited = hits.slice(0, limit);

  const formattedHits = limited
    .map((hit) => {
      const before = hit.contextBefore?.join('\n') ?? '';
      const line = `${hit.relativePath}:${hit.lineNumber}: ${hit.lineContent}`;
      const after = hit.contextAfter?.join('\n') ?? '';
      return [before, line, after].filter(Boolean).join('\n');
    })
    .join('\n\n');

  const header =
    hits.length > limit
      ? `Found ${hits.length} matches (showing first ${limit}):\n\n`
      : `Found ${hits.length} match${hits.length === 1 ? '' : 'es'}:\n\n`;

  return header + formattedHits;
}

function formatSearchResult(result: SearchResult): string {
  const files = result.items;

  if (!files.length) {
    return 'No files found.';
  }

  return files
    .map((file) => {
      const gitStatus = file.gitStatus && file.gitStatus !== 'clean' ? `[${file.gitStatus}] ` : '';
      return `${gitStatus}${file.relativePath}`;
    })
    .join('\n');
}

function inferGrepMode(query: string): GrepMode {
  return /(^|[^\\])[\\^$.*+?()[\]{}|]/.test(query) ? 'regex' : 'plain';
}

function buildConstrainedQuery(params: GrepParams): string {
  if (!params.path?.trim()) {
    return params.query;
  }

  const normalizedPath = params.path.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalizedPath) {
    return params.query;
  }

  const constraint = normalizedPath.endsWith('/')
    || normalizedPath.includes('*')
    || /\.[^/]+$/.test(normalizedPath)
    ? normalizedPath
    : `${normalizedPath}/`;
  return `${constraint} ${params.query}`;
}

function splitExcludePatterns(exclude?: string): string[] {
  return exclude?.split(/[,\s]+/).map((entry) => entry.trim()).filter(Boolean) ?? [];
}

function normalizeSearchTarget(target?: string): string {
  const trimmed = target?.trim();
  if (!trimmed || trimmed === '.') {
    return '.';
  }
  return trimmed.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isNoMatchError(error: unknown): boolean {
  const exitCode = (error as { code?: number | string })?.code;
  return exitCode === 1 || exitCode === '1';
}

function formatPlainLines(lines: string[], limit: number, singular: string, plural: string): string {
  const limited = lines.slice(0, limit);
  const header =
    lines.length > limit
      ? `Found ${lines.length} ${plural} (showing first ${limit}):\n\n`
      : `Found ${lines.length} ${lines.length === 1 ? singular : plural}:\n\n`;
  return header + limited.join('\n');
}

function rankPaths(files: string[], query: string): string[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return files
    .map((file) => ({ file, score: scorePath(file, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .map((entry) => entry.file);
}

function scorePath(file: string, terms: string[]): number {
  if (!terms.length) {
    return 1;
  }

  const normalized = file.toLowerCase();
  const basename = path.basename(normalized);
  let score = 0;

  for (const term of terms) {
    if (basename === term) {
      score += 20;
    } else if (basename.includes(term)) {
      score += 10;
    } else if (normalized.includes(term)) {
      score += 4;
    } else {
      return 0;
    }
  }

  return score;
}
