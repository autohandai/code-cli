/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyPatch as applyUnifiedPatch } from 'diff';
import { GitIgnoreParser } from '../utils/gitIgnore.js';

/**
 * Resource limits to prevent DoS and resource exhaustion
 */
export const FILE_LIMITS = {
  /** Maximum file size for read operations (10MB) */
  MAX_READ_SIZE: 10 * 1024 * 1024,
  /** Maximum file size for write operations (50MB) */
  MAX_WRITE_SIZE: 50 * 1024 * 1024,
  /** Maximum number of files in a single directory listing */
  MAX_DIR_ENTRIES: 10000,
  /** Maximum search results to return */
  MAX_SEARCH_RESULTS: 1000,
  /** Maximum undo stack size */
  MAX_UNDO_STACK: 100,
};

interface UndoEntry {
  absolutePath: string;
  previousContents: string;
}

/**
 * Represents a batched change in preview mode
 */
export interface BatchedChange {
  id: string;
  filePath: string;
  changeType: 'create' | 'modify' | 'delete';
  originalContent: string;
  proposedContent: string;
  description: string;
  toolId: string;
  toolName: string;
}

/**
 * Callback for emitting batched changes to RPC
 */
export type BatchChangeCallback = (change: BatchedChange) => void;

export interface SearchHit {
  file: string;
  line: number;
  text: string;
}

export interface SearchOptions {
  limit?: number;
  context?: number;
  relativePath?: string;
}

export class FileActionManager {
  private undoStack: UndoEntry[] = [];
  private readonly workspaceRoot: string;
  private readonly additionalDirs: string[];

  // Preview mode state
  private previewMode = false;
  private pendingChanges: BatchedChange[] = [];
  private batchId: string | null = null;
  private changeCounter = 0;
  private onBatchChange: BatchChangeCallback | null = null;
  private currentToolId = '';
  private currentToolName = '';

  constructor(workspaceRoot: string, additionalDirs: string[] = []) {
    // Resolve and normalize with realpathSync to handle:
    // 1. Symlinks (security: prevent symlink attacks)
    // 2. Case normalization on case-insensitive filesystems (macOS)
    // This ensures consistent comparison when validating paths
    const resolvedRoot = path.resolve(workspaceRoot);
    try {
      this.workspaceRoot = fs.realpathSync(resolvedRoot);
    } catch {
      // If directory doesn't exist yet, fall back to resolved path
      this.workspaceRoot = resolvedRoot;
    }

    // Validate and normalize additional directories
    this.additionalDirs = [];
    for (const dir of additionalDirs) {
      if (!dir || dir.trim() === '') {
        throw new Error('Empty string is not a valid additional directory');
      }
      const resolved = path.resolve(dir);
      // Normalize with realpathSync for consistent case handling
      let normalized: string;
      try {
        normalized = fs.realpathSync(resolved);
      } catch {
        normalized = resolved;
      }
      // Remove trailing slashes for consistent comparison
      if (normalized.endsWith(path.sep) && normalized.length > 1) {
        normalized = normalized.slice(0, -1);
      }
      if (!this.additionalDirs.includes(normalized)) {
        this.additionalDirs.push(normalized);
      }
    }
  }

  /**
   * Get all allowed directories (workspace root + additional dirs)
   */
  getAllowedDirectories(): string[] {
    return [this.workspaceRoot, ...this.additionalDirs];
  }

  /**
   * Add a new additional directory at runtime (for /add-dir command)
   */
  addAdditionalDirectory(dir: string): void {
    if (!dir || dir.trim() === '') {
      throw new Error('Empty string is not a valid additional directory');
    }
    const resolved = path.resolve(dir);
    // Normalize with realpathSync for consistent case handling
    let normalized: string;
    try {
      normalized = fs.realpathSync(resolved);
    } catch {
      normalized = resolved;
    }
    // Remove trailing slashes for consistent comparison
    if (normalized.endsWith(path.sep) && normalized.length > 1) {
      normalized = normalized.slice(0, -1);
    }
    if (!this.additionalDirs.includes(normalized) && normalized !== this.workspaceRoot) {
      this.additionalDirs.push(normalized);
    }
  }

  /**
   * Enter preview mode - changes will be batched instead of written
   */
  enterPreviewMode(batchId: string, onBatchChange?: BatchChangeCallback): void {
    this.previewMode = true;
    this.batchId = batchId;
    this.pendingChanges = [];
    this.changeCounter = 0;
    this.onBatchChange = onBatchChange ?? null;
  }

  /**
   * Exit preview mode
   */
  exitPreviewMode(): void {
    this.previewMode = false;
    this.batchId = null;
    this.onBatchChange = null;
  }

  /**
   * Check if in preview mode
   */
  isInPreviewMode(): boolean {
    return this.previewMode;
  }

  /**
   * Get current batch ID
   */
  getBatchId(): string | null {
    return this.batchId;
  }

  /**
   * Set current tool context for batched changes
   */
  setCurrentTool(toolId: string, toolName: string): void {
    this.currentToolId = toolId;
    this.currentToolName = toolName;
  }

  /**
   * Get all pending changes
   */
  getPendingChanges(): BatchedChange[] {
    return [...this.pendingChanges];
  }

  /**
   * Clear pending changes without applying
   */
  clearPendingChanges(): void {
    this.pendingChanges = [];
    this.changeCounter = 0;
  }

  /**
   * Apply pending changes (selected or all)
   */
  async applyPendingChanges(changeIds?: string[]): Promise<{ applied: string[]; errors: Array<{ id: string; error: string }> }> {
    const changesToApply = changeIds
      ? this.pendingChanges.filter((c) => changeIds.includes(c.id))
      : this.pendingChanges;

    const applied: string[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    // Temporarily disable preview mode to actually write files
    const wasPreviewMode = this.previewMode;
    this.previewMode = false;

    for (const change of changesToApply) {
      try {
        const fullPath = this.resolvePath(change.filePath);

        if (change.changeType === 'delete') {
          await fs.remove(fullPath);
        } else {
          await fs.ensureDir(path.dirname(fullPath));
          await fs.writeFile(fullPath, change.proposedContent, 'utf8');
        }

        applied.push(change.id);
      } catch (err) {
        errors.push({
          id: change.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Restore preview mode state
    this.previewMode = wasPreviewMode;

    // Remove applied changes from pending
    const appliedSet = new Set(applied);
    this.pendingChanges = this.pendingChanges.filter((c) => !appliedSet.has(c.id));

    return { applied, errors };
  }

  /**
   * Add a change to the pending batch (internal use)
   */
  private addBatchedChange(
    filePath: string,
    changeType: 'create' | 'modify' | 'delete',
    originalContent: string,
    proposedContent: string,
    description: string
  ): void {
    const change: BatchedChange = {
      id: `change_${this.batchId}_${++this.changeCounter}`,
      filePath,
      changeType,
      originalContent,
      proposedContent,
      description,
      toolId: this.currentToolId,
      toolName: this.currentToolName,
    };
    this.pendingChanges.push(change);

    // Emit to RPC if callback is set
    if (this.onBatchChange) {
      this.onBatchChange(change);
    }
  }

  get root(): string {
    return this.workspaceRoot;
  }

  async readFile(target: string): Promise<string> {
    const filePath = this.resolvePath(target);
    const exists = await fs.pathExists(filePath);
    if (!exists) {
      throw new Error(`File ${target} not found in workspace.`);
    }

    // Check file size before reading to prevent memory exhaustion
    const stats = await fs.stat(filePath);
    if (stats.size > FILE_LIMITS.MAX_READ_SIZE) {
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      const limitMB = (FILE_LIMITS.MAX_READ_SIZE / 1024 / 1024).toFixed(0);
      throw new Error(`File ${target} is too large (${sizeMB}MB). Maximum allowed: ${limitMB}MB`);
    }

    return fs.readFile(filePath, 'utf8');
  }

  async writeFile(target: string, contents: string, description?: string): Promise<void> {
    // Check content size before writing
    const contentSize = Buffer.byteLength(contents, 'utf8');
    if (contentSize > FILE_LIMITS.MAX_WRITE_SIZE) {
      const sizeMB = (contentSize / 1024 / 1024).toFixed(2);
      const limitMB = (FILE_LIMITS.MAX_WRITE_SIZE / 1024 / 1024).toFixed(0);
      throw new Error(`Content too large to write (${sizeMB}MB). Maximum allowed: ${limitMB}MB`);
    }

    const filePath = this.resolvePath(target);
    const exists = await fs.pathExists(filePath);
    const previous = exists ? await fs.readFile(filePath, 'utf8') : '';
    const changeType = exists ? 'modify' : 'create';

    // In preview mode, batch the change instead of writing
    if (this.previewMode) {
      this.addBatchedChange(
        target,
        changeType,
        previous,
        contents,
        description ?? `${changeType === 'create' ? 'Create' : 'Modify'} ${target}`
      );
      return;
    }

    await fs.ensureDir(path.dirname(filePath));

    // Limit undo stack size to prevent memory exhaustion
    if (this.undoStack.length >= FILE_LIMITS.MAX_UNDO_STACK) {
      this.undoStack.shift(); // Remove oldest entry
    }
    this.undoStack.push({ absolutePath: filePath, previousContents: previous });

    await fs.writeFile(filePath, contents, 'utf8');
  }

  async appendFile(target: string, contents: string): Promise<void> {
    const current = await this.readFileSafe(target);
    await this.writeFile(target, `${current}${contents}`);
  }

  async applyPatch(target: string, patch: string, description?: string): Promise<void> {
    const filePath = this.resolvePath(target);
    const current = await this.readFileSafe(target);
    const updated = applyUnifiedPatch(current, patch);
    if (updated === false) {
      throw new Error(`Failed to apply patch to ${target}`);
    }

    // In preview mode, batch the change instead of writing
    if (this.previewMode) {
      this.addBatchedChange(
        target,
        'modify',
        current,
        updated,
        description ?? `Apply patch to ${target}`
      );
      return;
    }

    this.undoStack.push({ absolutePath: filePath, previousContents: current });
    await fs.writeFile(filePath, updated, 'utf8');
  }

  async undoLast(): Promise<void> {
    const entry = this.undoStack.pop();
    if (!entry) {
      throw new Error('Undo stack is empty');
    }
    await fs.writeFile(entry.absolutePath, entry.previousContents, 'utf8');
  }

  search(query: string, relativePath?: string): SearchHit[] {
    const searchDir = this.resolvePath(relativePath ?? '.');
    // Exclude binary files and common non-text files to avoid wasting tokens
    const rgResult = spawnSync('rg', [
      '--line-number',
      '--color', 'never',
      '--no-binary',  // Skip binary files
      '--max-count', String(FILE_LIMITS.MAX_SEARCH_RESULTS), // Enforce result limit
      '--glob', '!*.{exe,dll,so,dylib,bin,o,a,lib,pyc,pyo,class,jar,war,ear}',
      '--glob', '!*.{png,jpg,jpeg,gif,bmp,ico,svg,webp,tiff}',
      '--glob', '!*.{mp3,mp4,avi,mov,mkv,wav,flac,ogg,webm}',
      '--glob', '!*.{pdf,doc,docx,xls,xlsx,ppt,pptx}',
      '--glob', '!*.{zip,tar,gz,bz2,7z,rar,dmg,iso}',
      '--glob', '!*.{woff,woff2,ttf,eot,otf}',
      '--glob', '!**/node_modules/**',
      '--glob', '!**/.git/**',
      '--glob', '!**/dist/**',
      '--glob', '!**/build/**',
      '--glob', '!**/binaries/**',
      query, '.'
    ], {
      cwd: searchDir,
      encoding: 'utf8'
    });

    if (rgResult.status === 0 && rgResult.stdout) {
      const results = rgResult.stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(0, FILE_LIMITS.MAX_SEARCH_RESULTS) // Double-enforce limit
        .map((line: string) => {
          const [file, lineNo, ...rest] = line.split(':');
          return {
            file: path.relative(this.workspaceRoot, path.join(searchDir, file)),
            line: Number(lineNo),
            text: rest.join(':')
          };
        });
      return results;
    }

    return this.walkFallback(query, searchDir);
  }

  searchWithContext(query: string, options: SearchOptions = {}): string {
    const limit = options.limit ?? 10;
    const contextLines = options.context ?? 2;
    const results = this.search(query, options.relativePath);
    return results.slice(0, limit)
      .map((hit) => this.renderContext(hit, contextLines))
      .join('\n\n');
  }

  semanticSearch(query: string, opts: { limit?: number; window?: number; relativePath?: string } = {}): Array<{ file: string; snippet: string }> {
    const limit = opts.limit ?? 5;
    const window = opts.window ?? 400;
    const baseDir = this.resolvePath(opts.relativePath ?? '.');
    const ignoreFilter = new GitIgnoreParser(baseDir);
    const results: Array<{ file: string; snippet: string }> = [];
    const stack = [baseDir];
    const lowerQuery = query.toLowerCase();

    while (stack.length && results.length < limit) {
      const current = stack.pop();
      if (!current) continue;
      const relative = path.relative(this.workspaceRoot, current);
      const normalizedRel = relative.replace(/\\/g, '/');

      // Skip hidden files/directories and ignored paths
      if (path.basename(current).startsWith('.') || ignoreFilter.isIgnored(normalizedRel)) {
        continue;
      }

      try {
        const stats = fs.statSync(current);
        if (stats.isDirectory()) {
          const entries = fs.readdirSync(current);
          for (const entry of entries) {
            // Skip hidden entries
            if (!entry.startsWith('.')) {
              stack.push(path.join(current, entry));
            }
          }
          continue;
        }
        if (!stats.isFile()) {
          continue;
        }

        // Skip binary and non-text files
        const ext = path.extname(current).toLowerCase();
        const binaryExtensions = new Set([
          '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a', '.lib', '.pyc', '.pyo', '.class', '.jar', '.war', '.ear',
          '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp', '.tiff',
          '.mp3', '.mp4', '.avi', '.mov', '.mkv', '.wav', '.flac', '.ogg', '.webm',
          '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
          '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar', '.dmg', '.iso',
          '.woff', '.woff2', '.ttf', '.eot', '.otf'
        ]);
        if (binaryExtensions.has(ext)) {
          continue;
        }

        // Skip files in excluded directories
        if (normalizedRel.includes('node_modules/') || normalizedRel.includes('/dist/') ||
            normalizedRel.includes('/build/') || normalizedRel.includes('/binaries/')) {
          continue;
        }

        const contents = fs.readFileSync(current, 'utf8');
        const haystack = contents.toLowerCase();
        const idx = haystack.indexOf(lowerQuery);
        if (idx === -1) continue;

        const start = Math.max(0, idx - window);
        const end = Math.min(contents.length, idx + query.length + window);
        const prefixEllipsis = start > 0 ? '…' : '';
        const suffixEllipsis = end < contents.length ? '…' : '';
        const snippet = `${prefixEllipsis}${contents.slice(start, end)}${suffixEllipsis}`;

        results.push({
          file: normalizedRel || path.basename(current),
          snippet
        });
      } catch {
        // Skip files/directories we can't access
        continue;
      }
    }

    return results;
  }

  private async readFileSafe(target: string): Promise<string> {
    const filePath = this.resolvePath(target);
    if (!(await fs.pathExists(filePath))) {
      return '';
    }

    // Check file size to prevent memory exhaustion (same as readFile)
    const stats = await fs.stat(filePath);
    if (stats.size > FILE_LIMITS.MAX_READ_SIZE) {
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      const limitMB = (FILE_LIMITS.MAX_READ_SIZE / 1024 / 1024).toFixed(0);
      throw new Error(`File ${target} is too large (${sizeMB}MB). Maximum allowed: ${limitMB}MB`);
    }

    return fs.readFile(filePath, 'utf8');
  }

  private resolvePath(target: string): string {
    const normalized = path.isAbsolute(target) ? target : path.join(this.workspaceRoot, target);
    const resolved = path.resolve(normalized);

    // Resolve symlinks to prevent symlink attacks (TOCTOU)
    // A symlink inside workspace could point outside it
    let realPath: string;
    try {
      realPath = fs.realpathSync(resolved);
    } catch {
      // File doesn't exist yet - check parent directory
      const parentDir = path.dirname(resolved);
      try {
        const realParent = fs.realpathSync(parentDir);
        realPath = path.join(realParent, path.basename(resolved));
      } catch {
        // Parent doesn't exist either - use resolved path for new paths
        realPath = resolved;
      }
    }

    // Build list of all allowed roots (workspace + additional directories)
    const allAllowedRoots = [this.workspaceRoot, ...this.additionalDirs];

    // Check the REAL path against ALL allowed roots
    for (const allowedRoot of allAllowedRoots) {
      // Get real path of this root for consistent comparison
      let realRoot: string;
      try {
        realRoot = fs.realpathSync(allowedRoot);
      } catch {
        realRoot = allowedRoot;
      }

      const rootWithSep = realRoot.endsWith(path.sep)
        ? realRoot
        : `${realRoot}${path.sep}`;

      // Check if path is within this allowed root
      if (realPath === realRoot || realPath.startsWith(rootWithSep)) {
        return resolved;
      }
    }

    // Path is not in any allowed directory
    const allowedDirsList = allAllowedRoots.join(', ');
    throw new Error(`Path ${target} escapes the allowed directories: ${allowedDirsList}`);
  }

  private walkFallback(query: string, baseDir: string): SearchHit[] {
    const hits: SearchHit[] = [];
    const stack = [baseDir];
    while (stack.length && hits.length < FILE_LIMITS.MAX_SEARCH_RESULTS) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      const basename = path.basename(current);
      const relative = path.relative(this.workspaceRoot, current);

      // Skip hidden files/directories and common excludes
      if (basename.startsWith('.') || relative.includes('node_modules') || relative.startsWith('dist')) {
        continue;
      }
      try {
        const stats = fs.statSync(current);
        if (stats.isDirectory()) {
          const entries = fs.readdirSync(current);
          for (const entry of entries) {
            // Skip hidden entries
            if (!entry.startsWith('.')) {
              stack.push(path.join(current, entry));
            }
          }
        } else if (stats.isFile()) {
          const contents = fs.readFileSync(current, 'utf8');
          const lines = contents.split(/\r?\n/);
          for (let idx = 0; idx < lines.length && hits.length < FILE_LIMITS.MAX_SEARCH_RESULTS; idx++) {
            const line = lines[idx];
            if (line.includes(query)) {
              hits.push({
                file: path.relative(this.workspaceRoot, current),
                line: idx + 1,
                text: line.trim()
              });
            }
          }
        }
      } catch {
        // Skip files/directories that don't exist or can't be accessed
        continue;
      }
    }
    return hits;
  }

  async createDirectory(relativePath: string): Promise<void> {
    const dirPath = this.resolvePath(relativePath);
    await fs.ensureDir(dirPath);
  }

  async listDirectory(relativePath: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
    const dirPath = this.resolvePath(relativePath);
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    // Enforce entry limit
    if (entries.length > FILE_LIMITS.MAX_DIR_ENTRIES) {
      throw new Error(`Directory has too many entries (${entries.length}). Maximum allowed: ${FILE_LIMITS.MAX_DIR_ENTRIES}`);
    }

    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
    }));
  }

  async deletePath(relativePath: string, description?: string): Promise<void> {
    const fullPath = this.resolvePath(relativePath);
    const exists = await fs.pathExists(fullPath);
    if (!exists) {
      throw new Error(`${relativePath} does not exist.`);
    }
    const stats = await fs.stat(fullPath);
    const previousContents = stats.isFile() ? await fs.readFile(fullPath, 'utf8') : '';

    // In preview mode, batch the change instead of deleting
    if (this.previewMode) {
      this.addBatchedChange(
        relativePath,
        'delete',
        previousContents,
        '',
        description ?? `Delete ${relativePath}`
      );
      return;
    }

    this.undoStack.push({
      absolutePath: fullPath,
      previousContents
    });
    await fs.remove(fullPath);
  }

  async renamePath(from: string, to: string): Promise<void> {
    const fromPath = this.resolvePath(from);
    const toPath = this.resolvePath(to);
    await fs.ensureDir(path.dirname(toPath));
    await fs.move(fromPath, toPath, { overwrite: true });
  }

  async copyPath(from: string, to: string): Promise<void> {
    const fromPath = this.resolvePath(from);
    const toPath = this.resolvePath(to);
    await fs.copy(fromPath, toPath, { overwrite: true });
  }

  async replaceInFile(relativePath: string, searchValue: string | RegExp, replaceValue: string): Promise<void> {
    const current = await this.readFile(relativePath);
    const updated = current.replace(searchValue as any, replaceValue);
    await this.writeFile(relativePath, updated);
  }

  async formatFile(
    relativePath: string,
    formatter: (contents: string, file: string) => Promise<string>
  ): Promise<void> {
    const current = await this.readFile(relativePath);
    const formatted = await formatter(current, relativePath);
    await this.writeFile(relativePath, formatted);
  }

  private renderContext(hit: SearchHit, contextLines: number): string {
    const filePath = this.resolvePath(hit.file);
    if (!fs.existsSync(filePath)) {
      return `${hit.file}:${hit.line}`;
    }
    const contents = fs.readFileSync(filePath, 'utf8');
    const lines = contents.split(/\r?\n/);
    const start = Math.max(0, hit.line - 1 - contextLines);
    const end = Math.min(lines.length, hit.line - 1 + contextLines + 1);
    const snippet = lines.slice(start, end).map((line, idx) => {
      const number = start + idx + 1;
      const marker = number === hit.line ? '>' : ' ';
      return `${marker} ${number.toString().padStart(4, ' ')} | ${line}`;
    });
    return `${hit.file}:${hit.line}\n${snippet.join('\n')}`;
  }
}
