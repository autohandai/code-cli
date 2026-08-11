/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import type { Stats } from 'node:fs';
import { open, opendir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyPatch as applyUnifiedPatch } from 'diff';
import { GitIgnoreParser } from '../utils/gitIgnore.js';
import { resolveRipgrepCommand } from '../utils/ripgrep.js';
import { validateAndFixPatch } from '../utils/patchValidator.js';
import {
  readTextFileWindow,
  type ReadTextWindowOptions,
  type ReadTextWindowResult,
} from './readFile.js';
import type { ReadFileRevision } from '../session/types.js';

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

export interface ReadFileWindowResult extends ReadTextWindowResult {
  resolvedPath: string;
  openedPath: string;
  repairedPath: boolean;
  sizeBytes: number;
  revision: ReadFileRevision;
  revisionStable: boolean;
  format: { kind: 'text' } | { kind: 'binary'; mimeType: string };
}

export interface ReadFileInspection {
  requestedPath: string;
  resolvedPath: string;
  openedPath: string;
  repairedPath: boolean;
  revision: ReadFileRevision;
}

export type FilePathInspection =
  | { kind: 'missing'; requestedPath: string; resolvedPath: string }
  | { kind: 'directory'; requestedPath: string; resolvedPath: string }
  | {
      kind: 'file';
      requestedPath: string;
      resolvedPath: string;
      revision: ReadFileRevision;
    };

export interface HashedFileRevision {
  sha256: string;
  revision: ReadFileRevision;
  revisionStable: boolean;
}

interface AdmittedSearchEntry {
  realPath: string;
  stats: Stats;
}

const SEARCH_EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  'binaries',
]);

export class FileActionManager {
  private undoStack: UndoEntry[] = [];
  private workspaceRoot: string;
  private readonly additionalDirs: string[];
  private readonly resolveSearchCommand: () => string;

  // Preview mode state
  private previewMode = false;
  private pendingChanges: BatchedChange[] = [];
  private batchId: string | null = null;
  private changeCounter = 0;
  private onBatchChange: BatchChangeCallback | null = null;
  private currentToolId = '';
  private currentToolName = '';
  private previewStaleCheckEnabled = false;

  constructor(
    workspaceRoot: string,
    additionalDirs: string[] = [],
    resolveSearchCommand: () => string = resolveRipgrepCommand
  ) {
    this.resolveSearchCommand = resolveSearchCommand;
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

  setPreviewStaleCheckEnabled(enabled: boolean): void {
    this.previewStaleCheckEnabled = enabled;
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
        if (this.previewStaleCheckEnabled) {
          const exists = await fs.pathExists(fullPath);
          if (change.changeType === 'create') {
            if (exists) {
              throw new Error(`${change.filePath} was created after preview; review and retry.`);
            }
          } else {
            if (!exists) {
              throw new Error(`${change.filePath} changed after preview; review and retry.`);
            }
            const stats = await fs.stat(fullPath);
            const currentContents = stats.isFile()
              ? await fs.readFile(fullPath, 'utf8')
              : '';
            if (currentContents !== change.originalContent) {
              throw new Error(`${change.filePath} changed after preview; review and retry.`);
            }
          }
        }

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

  setWorkspaceRoot(workspaceRoot: string): void {
    const resolvedRoot = path.resolve(workspaceRoot);
    try {
      this.workspaceRoot = fs.realpathSync(resolvedRoot);
    } catch {
      this.workspaceRoot = resolvedRoot;
    }
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

  async readFileWindow(
    target: string,
    options: ReadTextWindowOptions,
    inspection?: ReadFileInspection,
  ): Promise<ReadFileWindowResult> {
    const inspected = inspection?.requestedPath === target
      ? inspection
      : await this.inspectReadFile(target);
    const {
      resolvedPath: filePath,
      openedPath,
      repairedPath,
      revision,
    } = inspected;
    const format = await this.detectReadFileFormat(filePath, revision.sizeBytes);
    if (format.kind === 'binary') {
      const currentRevision = this.toReadFileRevision(await fs.stat(filePath));
      return {
        lines: [],
        reachedEof: true,
        linesScanned: 0,
        resolvedPath: filePath,
        openedPath,
        repairedPath,
        sizeBytes: revision.sizeBytes,
        revision,
        revisionStable: this.sameReadFileRevision(revision, currentRevision),
        format,
      };
    }
    const result = await readTextFileWindow(filePath, options);
    const currentRevision = this.toReadFileRevision(await fs.stat(filePath));
    return {
      ...result,
      resolvedPath: filePath,
      openedPath,
      repairedPath,
      sizeBytes: revision.sizeBytes,
      revision,
      revisionStable: this.sameReadFileRevision(revision, currentRevision),
      format,
    };
  }

  async inspectReadFile(target: string): Promise<ReadFileInspection> {
    this.assertSafeReadFileTarget(target);
    const { filePath, openedPath, repairedPath } = await this.resolveReadFileTarget(target);
    const resolvedPath = await fs.realpath(filePath);
    const stats = await fs.stat(resolvedPath);
    if (!stats.isFile()) {
      throw new Error(`Path ${target} is not a regular file.`);
    }
    return {
      requestedPath: target,
      resolvedPath,
      openedPath,
      repairedPath,
      revision: this.toReadFileRevision(stats),
    };
  }

  async inspectPath(target: string): Promise<FilePathInspection> {
    const requestedPath = target;
    const admittedPath = this.resolvePath(target);
    if (!(await fs.pathExists(admittedPath))) {
      return { kind: 'missing', requestedPath, resolvedPath: admittedPath };
    }
    const resolvedPath = await fs.realpath(admittedPath);
    const stats = await fs.stat(resolvedPath);
    if (stats.isDirectory()) {
      return { kind: 'directory', requestedPath, resolvedPath };
    }
    if (!stats.isFile()) {
      throw new Error(`Path ${target} is not a regular file.`);
    }
    return {
      kind: 'file',
      requestedPath,
      resolvedPath,
      revision: this.toReadFileRevision(stats),
    };
  }

  async hashInspectedFile(inspection: Extract<FilePathInspection, { kind: 'file' }>): Promise<HashedFileRevision> {
    const before = this.toReadFileRevision(await fs.stat(inspection.resolvedPath));
    const hash = createHash('sha256');
    const stream = fs.createReadStream(inspection.resolvedPath);
    for await (const chunk of stream) {
      hash.update(chunk as Buffer);
    }
    const after = this.toReadFileRevision(await fs.stat(inspection.resolvedPath));
    return {
      sha256: hash.digest('hex'),
      revision: before,
      revisionStable: this.sameReadFileRevision(before, after),
    };
  }

  private toReadFileRevision(stats: Stats): ReadFileRevision {
    return {
      sizeBytes: stats.size,
      mtimeMs: stats.mtimeMs,
      ctimeMs: stats.ctimeMs,
      ...(Number.isSafeInteger(stats.ino) ? { inode: stats.ino } : {}),
      ...(Number.isSafeInteger(stats.dev) ? { device: stats.dev } : {}),
    };
  }

  private sameReadFileRevision(left: ReadFileRevision, right: ReadFileRevision): boolean {
    return left.sizeBytes === right.sizeBytes
      && left.mtimeMs === right.mtimeMs
      && left.ctimeMs === right.ctimeMs
      && left.inode === right.inode
      && left.device === right.device;
  }

  private assertSafeReadFileTarget(target: string): void {
    if (process.platform === 'win32') {
      return;
    }
    const expandedTarget = target === '~'
      ? os.homedir()
      : target.startsWith(`~${path.sep}`) || target.startsWith('~/')
        ? path.join(os.homedir(), target.slice(2))
        : target;
    const absolutePath = path.resolve(
      path.isAbsolute(expandedTarget)
        ? expandedTarget
        : path.join(this.workspaceRoot, expandedTarget),
    ).replace(/\\/g, '/');
    const blocked = /^\/dev\/(?:zero|random|urandom|stdin)(?:\/|$)/.test(absolutePath)
      || /^\/dev\/fd(?:\/|$)/.test(absolutePath)
      || /^\/proc\/(?:self|thread-self|\d+)\/fd(?:\/|$)/.test(absolutePath);
    if (blocked) {
      throw new Error(`read_file refuses device or stream path ${target}.`);
    }
  }

  private async resolveReadFileTarget(target: string): Promise<{
    filePath: string;
    openedPath: string;
    repairedPath: boolean;
  }> {
    const requestedPath = this.resolvePath(target);
    if (await fs.pathExists(requestedPath)) {
      return {
        filePath: requestedPath,
        openedPath: this.readFileDisplayPath(requestedPath, target),
        repairedPath: false,
      };
    }

    for (const candidate of this.readPathVariants(target)) {
      let candidatePath: string;
      try {
        candidatePath = this.resolvePath(candidate);
      } catch {
        continue;
      }
      if (await fs.pathExists(candidatePath)) {
        return {
          filePath: candidatePath,
          openedPath: this.readFileDisplayPath(candidatePath, candidate),
          repairedPath: true,
        };
      }
    }

    const suggestions = await this.suggestReadPaths(target);
    const suggestion = suggestions.length === 1
      ? ` Did you mean "${suggestions[0]}"?`
      : suggestions.length > 1
        ? ` Did you mean one of: ${suggestions.map(value => `"${value}"`).join(', ')}?`
        : '';
    throw new Error(`File ${target} not found in workspace.${suggestion}`);
  }

  private readFileDisplayPath(filePath: string, fallback: string): string {
    const realFilePath = this.resolveRealPathOrAncestor(filePath);
    if (!this.isPathWithinRoot(realFilePath, this.workspaceRoot)) {
      return fallback;
    }
    const relativePath = path.relative(this.workspaceRoot, realFilePath);
    return relativePath.split(path.sep).join('/');
  }

  private readPathVariants(target: string): string[] {
    const maximumVariants = 32;
    const variants = new Set<string>();
    const visited = new Set([target]);
    const queue = [target];
    const replacements = [
      [' ', '\u202F'],
      ['\u202F', ' '],
      ["'", '\u2019'],
      ['\u2019', "'"],
    ] as const;

    while (queue.length > 0 && variants.size < maximumVariants) {
      const seed = queue.shift()!;
      const candidates = [seed.normalize('NFC'), seed.normalize('NFD')];
      for (const [from, to] of replacements) {
        let index = seed.indexOf(from);
        while (index !== -1) {
          candidates.push(`${seed.slice(0, index)}${to}${seed.slice(index + from.length)}`);
          index = seed.indexOf(from, index + from.length);
        }
      }

      for (const candidate of candidates) {
        if (visited.has(candidate)) {
          continue;
        }
        visited.add(candidate);
        variants.add(candidate);
        queue.push(candidate);
        if (variants.size >= maximumVariants) {
          break;
        }
      }
    }
    return Array.from(variants);
  }

  private async suggestReadPaths(target: string): Promise<string[]> {
    const parent = path.dirname(target);
    let parentPath: string;
    try {
      parentPath = this.resolvePath(parent);
    } catch {
      return [];
    }
    if (!(await fs.pathExists(parentPath))) {
      return [];
    }
    const stats = await fs.stat(parentPath);
    if (!stats.isDirectory()) {
      return [];
    }

    const requestedName = this.normalizeSuggestedFilename(path.basename(target));
    const matches: Array<{ name: string; distance: number }> = [];
    const directory = await opendir(parentPath);
    let inspectedEntries = 0;
    for await (const entry of directory) {
      if (inspectedEntries >= FILE_LIMITS.MAX_DIR_ENTRIES) {
        break;
      }
      inspectedEntries++;
      if (!entry.isFile() && !entry.isSymbolicLink()) {
        continue;
      }
      const normalized = this.normalizeSuggestedFilename(entry.name);
      const substringMatch = normalized.includes(requestedName) || requestedName.includes(normalized);
      const distance = this.boundedEditDistance(requestedName, normalized, 2);
      if (!substringMatch && distance > 2) {
        continue;
      }
      matches.push({ name: entry.name, distance });
      matches.sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name));
      if (matches.length > 3) {
        matches.pop();
      }
    }
    return matches.map(candidate => (
      parent === '.' ? candidate.name : path.join(parent, candidate.name)
    ));
  }

  private normalizeSuggestedFilename(value: string): string {
    return value
      .normalize('NFC')
      .replace(/\u202F/g, ' ')
      .replace(/\u2019/g, "'")
      .toLowerCase();
  }

  private boundedEditDistance(left: string, right: string, maximum: number): number {
    const leftCharacters = Array.from(left);
    const rightCharacters = Array.from(right);
    if (Math.abs(leftCharacters.length - rightCharacters.length) > maximum) {
      return maximum + 1;
    }

    let previous = Array.from({ length: rightCharacters.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= leftCharacters.length; leftIndex++) {
      const current = [leftIndex];
      let rowMinimum = current[0];
      for (let rightIndex = 1; rightIndex <= rightCharacters.length; rightIndex++) {
        const substitutionCost = leftCharacters[leftIndex - 1] === rightCharacters[rightIndex - 1] ? 0 : 1;
        const distance = Math.min(
          current[rightIndex - 1] + 1,
          previous[rightIndex] + 1,
          previous[rightIndex - 1] + substitutionCost,
        );
        current.push(distance);
        rowMinimum = Math.min(rowMinimum, distance);
      }
      if (rowMinimum > maximum) {
        return maximum + 1;
      }
      previous = current;
    }
    return previous[rightCharacters.length];
  }

  private async detectReadFileFormat(
    filePath: string,
    sizeBytes: number,
  ): Promise<ReadFileWindowResult['format']> {
    const sampleSize = Math.min(sizeBytes, 8 * 1024);
    if (sampleSize === 0) {
      return { kind: 'text' };
    }
    const handle = await open(filePath, 'r');
    try {
      const sample = Buffer.allocUnsafe(sampleSize);
      const { bytesRead } = await handle.read(sample, 0, sampleSize, 0);
      return this.sniffReadFileFormat(sample.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  }

  private sniffReadFileFormat(sample: Buffer): ReadFileWindowResult['format'] {
    if (sample.subarray(0, 5).toString('ascii') === '%PDF-') {
      return { kind: 'binary', mimeType: 'application/pdf' };
    }
    if (sample.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return { kind: 'binary', mimeType: 'image/png' };
    }
    if (sample[0] === 0xff && sample[1] === 0xd8 && sample[2] === 0xff) {
      return { kind: 'binary', mimeType: 'image/jpeg' };
    }
    const signature = sample.subarray(0, 6).toString('ascii');
    if (signature === 'GIF87a' || signature === 'GIF89a') {
      return { kind: 'binary', mimeType: 'image/gif' };
    }
    if (sample.subarray(0, 4).toString('ascii') === 'RIFF'
      && sample.subarray(8, 12).toString('ascii') === 'WEBP') {
      return { kind: 'binary', mimeType: 'image/webp' };
    }
    if (sample.includes(0)) {
      return { kind: 'binary', mimeType: 'application/octet-stream' };
    }
    return { kind: 'text' };
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
    // Validate and fix the patch to correct any mismatched line counts in hunk headers
    const fixedPatch = validateAndFixPatch(patch);
    const updated = applyUnifiedPatch(current, fixedPatch);
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
    const rgResult = spawnSync(this.resolveSearchCommand(), [
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
      '--', query, '.'
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
            file: this.getSearchDisplayPath(path.join(searchDir, file)),
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
    const visitedRealPaths = new Set<string>();
    const realPathIgnoreFilters = this.createAllowedRootIgnoreFilters();
    const lowerQuery = query.toLowerCase();

    while (stack.length && results.length < limit) {
      const current = stack.pop();
      if (!current) continue;
      const displayPath = this.getSearchDisplayPath(current);
      const normalizedRel = displayPath.replace(/\\/g, '/');
      const logicalRelative = path.relative(baseDir, path.resolve(current)).replace(/\\/g, '/');

      // Skip hidden files/directories and ignored paths
      if (
        this.hasHiddenOrExcludedPathSegment(logicalRelative)
        || ignoreFilter.isIgnored(logicalRelative)
      ) {
        continue;
      }

      const admitted = this.admitSearchEntry(current, visitedRealPaths);
      if (!admitted) {
        continue;
      }
      if (this.isAdmittedSearchPathExcluded(admitted.realPath, realPathIgnoreFilters)) {
        continue;
      }

      try {
        const { realPath, stats } = admitted;
        if (stats.isDirectory()) {
          const entries = fs.readdirSync(realPath);
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

        if (stats.size > FILE_LIMITS.MAX_READ_SIZE) {
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

        const contents = fs.readFileSync(realPath, 'utf8');
        const haystack = contents.toLowerCase();
        const idx = haystack.indexOf(lowerQuery);
        if (idx === -1) continue;

        const start = Math.max(0, idx - window);
        const end = Math.min(contents.length, idx + query.length + window);
        const prefixEllipsis = start > 0 ? '…' : '';
        const suffixEllipsis = end < contents.length ? '…' : '';
        const snippet = `${prefixEllipsis}${contents.slice(start, end)}${suffixEllipsis}`;

        results.push({
          file: displayPath,
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
    const expandedTarget = target === '~'
      ? os.homedir()
      : target.startsWith(`~${path.sep}`) || target.startsWith('~/')
        ? path.join(os.homedir(), target.slice(2))
        : target;
    const normalized = path.isAbsolute(expandedTarget) ? expandedTarget : path.join(this.workspaceRoot, expandedTarget);
    const resolved = path.resolve(normalized);

    const realPath = this.resolveRealPathOrAncestor(resolved);

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

  private resolveRealPathOrAncestor(resolvedPath: string): string {
    let probe = resolvedPath;

    while (true) {
      try {
        const realProbe = fs.realpathSync(probe);
        return probe === resolvedPath
          ? realProbe
          : path.join(realProbe, path.relative(probe, resolvedPath));
      } catch {
        const parent = path.dirname(probe);
        if (parent === probe) {
          return resolvedPath;
        }
        probe = parent;
      }
    }
  }

  private admitSearchEntry(
    logicalPath: string,
    visitedRealPaths: Set<string>
  ): AdmittedSearchEntry | null {
    try {
      const logicalStats = fs.lstatSync(logicalPath);
      const realPath = fs.realpathSync(logicalPath);

      if (!this.isRealPathWithinAllowedRoots(realPath) || visitedRealPaths.has(realPath)) {
        return null;
      }

      const stats = logicalStats.isSymbolicLink()
        ? fs.statSync(realPath)
        : logicalStats;
      visitedRealPaths.add(realPath);

      return { realPath, stats };
    } catch {
      return null;
    }
  }

  private isRealPathWithinAllowedRoots(realPath: string): boolean {
    return this.getAllowedDirectories().some((allowedRoot) => {
      const realRoot = this.resolveRealPathOrAncestor(path.resolve(allowedRoot));
      return this.isPathWithinRoot(realPath, realRoot);
    });
  }

  private isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
    const relative = path.relative(rootPath, candidatePath);
    return relative === '' || (
      !path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`)
    );
  }

  private getSearchDisplayPath(logicalPath: string): string {
    const resolvedLogicalPath = path.resolve(logicalPath);

    for (const allowedRoot of this.getAllowedDirectories()) {
      const relative = path.relative(path.resolve(allowedRoot), resolvedLogicalPath);
      if (this.isPathWithinRoot(resolvedLogicalPath, path.resolve(allowedRoot))) {
        return relative || path.basename(resolvedLogicalPath);
      }
    }

    return path.basename(resolvedLogicalPath);
  }

  private createAllowedRootIgnoreFilters(): Map<string, GitIgnoreParser> {
    const filters = new Map<string, GitIgnoreParser>();
    for (const allowedRoot of this.getAllowedDirectories()) {
      const realRoot = this.resolveRealPathOrAncestor(path.resolve(allowedRoot));
      if (!filters.has(realRoot)) {
        filters.set(realRoot, new GitIgnoreParser(realRoot));
      }
    }
    return filters;
  }

  private isAdmittedSearchPathExcluded(
    realPath: string,
    ignoreFilters: ReadonlyMap<string, GitIgnoreParser>
  ): boolean {
    let matchedAllowedRoot = false;
    for (const [realRoot, ignoreFilter] of ignoreFilters) {
      if (!this.isPathWithinRoot(realPath, realRoot)) {
        continue;
      }
      matchedAllowedRoot = true;
      const relative = path.relative(realRoot, realPath).replace(/\\/g, '/');
      if (this.hasHiddenOrExcludedPathSegment(relative) || ignoreFilter.isIgnored(relative)) {
        return true;
      }
    }
    return !matchedAllowedRoot;
  }

  private hasHiddenOrExcludedPathSegment(relativePath: string): boolean {
    if (!relativePath) {
      return false;
    }
    return relativePath.split('/').some((segment) => (
      segment.startsWith('.') || SEARCH_EXCLUDED_DIRECTORIES.has(segment)
    ));
  }

  private walkFallback(query: string, baseDir: string): SearchHit[] {
    const hits: SearchHit[] = [];
    const stack = [baseDir];
    const visitedRealPaths = new Set<string>();
    const logicalIgnoreFilter = new GitIgnoreParser(baseDir);
    const realPathIgnoreFilters = this.createAllowedRootIgnoreFilters();
    while (stack.length && hits.length < FILE_LIMITS.MAX_SEARCH_RESULTS) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      const basename = path.basename(current);
      const relative = this.getSearchDisplayPath(current);
      const logicalRelative = path.relative(baseDir, path.resolve(current)).replace(/\\/g, '/');

      // Skip hidden files/directories and common excludes
      if (
        basename.startsWith('.')
        || this.hasHiddenOrExcludedPathSegment(logicalRelative)
        || logicalIgnoreFilter.isIgnored(logicalRelative)
      ) {
        continue;
      }
      const admitted = this.admitSearchEntry(current, visitedRealPaths);
      if (!admitted) {
        continue;
      }
      if (this.isAdmittedSearchPathExcluded(admitted.realPath, realPathIgnoreFilters)) {
        continue;
      }

      try {
        const { realPath, stats } = admitted;
        if (stats.isDirectory()) {
          const entries = fs.readdirSync(realPath);
          for (const entry of entries) {
            // Skip hidden entries
            if (!entry.startsWith('.')) {
              stack.push(path.join(current, entry));
            }
          }
        } else if (stats.isFile() && stats.size <= FILE_LIMITS.MAX_READ_SIZE) {
          const contents = fs.readFileSync(realPath, 'utf8');
          const lines = contents.split(/\r?\n/);
          for (let idx = 0; idx < lines.length && hits.length < FILE_LIMITS.MAX_SEARCH_RESULTS; idx++) {
            const line = lines[idx];
            if (line.includes(query)) {
              hits.push({
                file: relative,
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
