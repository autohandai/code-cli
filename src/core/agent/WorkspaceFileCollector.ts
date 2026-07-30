/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs-extra';
import path from 'node:path';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import type { GitIgnoreParser } from '../../utils/gitIgnore.js';

/**
 * WorkspaceFileCollector module
 *
 * Extracted from AutohandAgent for better modularity.
 * Handles workspace file discovery via git or filesystem walking.
 */

const WORKSPACE_FILES_CACHE_TTL = 30000; // 30 seconds
const MAX_MOBILE_QUERY_RESULTS = 20;
const MAX_MOBILE_QUERY_CANDIDATES = 50_000;
const MAX_MOBILE_QUERY_TIMEOUT_MS = 2_000;
const DEFAULT_MOBILE_QUERY_TIMEOUT_MS = 750;
const SECRET_WORKSPACE_COMPONENTS = new Set([
  '.aws',
  '.azure',
  '.git',
  '.gnupg',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.secrets',
  '.ssh',
  'credentials',
  'id_dsa',
  'id_ed25519',
  'id_ecdsa',
  'id_rsa',
  'secrets',
]);
const SECRET_WORKSPACE_EXTENSIONS = ['.key', '.p12', '.pfx', '.pem'];

export interface MobileWorkspaceFileDescriptor {
  relativePath: string;
}

export interface MobileWorkspaceFileQueryResult {
  query: string;
  files: MobileWorkspaceFileDescriptor[];
  truncated: boolean;
}

export interface MobileWorkspaceFileQueryOptions {
  limit?: number;
  timeoutMs?: number;
}

export function isSafeMobileWorkspaceRelativePath(value: string): boolean {
  if (
    value.length === 0
    || value.length > 1_000
    || value !== value.trim()
    || value.startsWith('/')
    || value.startsWith('~')
    || value.includes('\\')
    || value.includes('\0')
    || /[\r\n]/.test(value)
    || /^[A-Za-z]:/.test(value)
  ) {
    return false;
  }

  const components = value.split('/');
  if (
    components.some((component) => !component || component === '.' || component === '..')
  ) {
    return false;
  }

  return !components.some((component) => {
    const normalized = component.toLowerCase();
    return normalized === '.env'
      || normalized.startsWith('.env.')
      || normalized === 'credentials'
      || normalized.startsWith('credentials.')
      || normalized === 'secrets'
      || normalized.startsWith('secrets.')
      || SECRET_WORKSPACE_COMPONENTS.has(normalized)
      || SECRET_WORKSPACE_EXTENSIONS.some((extension) => normalized.endsWith(extension));
  });
}

function mobileFileRank(relativePath: string, query: string): number | null {
  if (!query) return 0;
  const normalizedPath = relativePath.toLowerCase();
  const normalizedFilename = path.posix.basename(normalizedPath);
  if (normalizedFilename === query) return 0;
  if (normalizedFilename.startsWith(query)) return 1;
  if (normalizedFilename.includes(query)) return 2;
  if (normalizedPath.startsWith(query)) return 3;
  if (normalizedPath.includes(query)) return 4;
  return null;
}

function mobileFileBefore(
  left: { relativePath: string; rank: number },
  right: { relativePath: string; rank: number },
): number {
  if (left.rank !== right.rank) return left.rank - right.rank;
  const leftFilename = path.posix.basename(left.relativePath);
  const rightFilename = path.posix.basename(right.relativePath);
  if (leftFilename.length !== rightFilename.length) {
    return leftFilename.length - rightFilename.length;
  }
  if (left.relativePath < right.relativePath) return -1;
  if (left.relativePath > right.relativePath) return 1;
  return 0;
}

export class WorkspaceFileCollector {
  private workspaceFiles: string[] = [];
  private workspaceFilesCachedAt = 0;

  constructor(
    private workspaceRoot: string,
    private ignoreFilter: GitIgnoreParser
  ) {}

  setWorkspace(workspaceRoot: string, ignoreFilter: GitIgnoreParser): void {
    this.workspaceRoot = workspaceRoot;
    this.ignoreFilter = ignoreFilter;
    this.workspaceFiles = [];
    this.workspaceFilesCachedAt = 0;
  }

  /**
   * Return cached workspace files immediately (no I/O).
   * Used by promptForInstruction to avoid blocking the prompt.
   */
  getCachedFiles(): string[] {
    return this.workspaceFiles;
  }

  /**
   * List workspace files to console (sorted alphabetically)
   */
  async listWorkspaceFiles(): Promise<void> {
    const entries = await fs.readdir(this.workspaceRoot);
    const sorted = entries.sort((a, b) => a.localeCompare(b));
    console.log('\n' + chalk.cyan('Workspace files:'));
    console.log(sorted.map((entry) => ` - ${entry}`).join('\n'));
    console.log();
  }

  /**
   * Collect all workspace files, using cache if fresh
   * Falls back to filesystem walk if git ls-files fails
   */
  async collectWorkspaceFiles(forceRefresh = false): Promise<string[]> {
    // Use cached files if still fresh (avoid blocking git ls-files on every turn)
    const now = Date.now();
    if (
      !forceRefresh
      && this.workspaceFiles.length > 0
      && (now - this.workspaceFilesCachedAt) < WORKSPACE_FILES_CACHE_TTL
    ) {
      return this.workspaceFiles;
    }

    // Load files silently without spinner to avoid blocking startup
    // The 30-second cache ensures this is fast on subsequent calls
    try {
      const files = await this.gitLsFiles();
      if (files.length > 0) {
        this.workspaceFiles = files;
        this.workspaceFilesCachedAt = now;
        return files;
      }

      // Fallback to filesystem walk if git fails
      const walkedFiles: string[] = [];
      await this.walkWorkspace(this.workspaceRoot, walkedFiles);
      this.workspaceFiles = walkedFiles;
      this.workspaceFilesCachedAt = now;
      return walkedFiles;
    } catch {
      // Return cached files if available, otherwise empty array
      return this.workspaceFiles.length > 0 ? this.workspaceFiles : [];
    }
  }

  async queryWorkspaceFiles(
    query: string,
    options: MobileWorkspaceFileQueryOptions = {},
  ): Promise<MobileWorkspaceFileQueryResult> {
    const limit = Math.min(
      Math.max(Math.trunc(options.limit ?? 8), 1),
      MAX_MOBILE_QUERY_RESULTS,
    );
    const timeoutMs = Math.min(
      Math.max(Math.trunc(options.timeoutMs ?? DEFAULT_MOBILE_QUERY_TIMEOUT_MS), 1),
      MAX_MOBILE_QUERY_TIMEOUT_MS,
    );
    if (
      query.length > 200
      || query.includes('\0')
      || /[\r\n]/.test(query)
    ) {
      return { query, files: [], truncated: false };
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<MobileWorkspaceFileQueryResult>((resolve) => {
      timer = setTimeout(() => {
        resolve({ query, files: [], truncated: true });
      }, timeoutMs);
      timer.unref?.();
    });

    try {
      return await Promise.race([
        this.performMobileWorkspaceFileQuery(query, limit),
        timeout,
      ]);
    } catch {
      return { query, files: [], truncated: true };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async performMobileWorkspaceFileQuery(
    query: string,
    limit: number,
  ): Promise<MobileWorkspaceFileQueryResult> {
    const collectedFiles = await this.collectWorkspaceFiles(true);
    const candidateLimitReached = collectedFiles.length > MAX_MOBILE_QUERY_CANDIDATES;
    const normalizedQuery = query.trim().toLowerCase();
    const ranked = collectedFiles
      .slice(0, MAX_MOBILE_QUERY_CANDIDATES)
      .map((file) => file.split(path.sep).join('/'))
      .filter(isSafeMobileWorkspaceRelativePath)
      .flatMap((relativePath) => {
        const rank = mobileFileRank(relativePath, normalizedQuery);
        return rank === null ? [] : [{ relativePath, rank }];
      })
      .sort(mobileFileBefore);

    const workspaceRealPath = await fs.realpath(this.workspaceRoot);
    const files: MobileWorkspaceFileDescriptor[] = [];
    let truncated = candidateLimitReached;
    for (const candidate of ranked) {
      if (!await this.isContainedWorkspaceFile(workspaceRealPath, candidate.relativePath)) {
        continue;
      }
      if (files.length >= limit) {
        truncated = true;
        break;
      }
      files.push({ relativePath: candidate.relativePath });
    }

    return { query, files, truncated };
  }

  private async isContainedWorkspaceFile(
    workspaceRealPath: string,
    relativePath: string,
  ): Promise<boolean> {
    try {
      const candidateRealPath = await fs.realpath(path.resolve(this.workspaceRoot, relativePath));
      const relativeRealPath = path.relative(workspaceRealPath, candidateRealPath);
      if (
        relativeRealPath === ''
        || relativeRealPath === '..'
        || relativeRealPath.startsWith(`..${path.sep}`)
        || path.isAbsolute(relativeRealPath)
      ) {
        return false;
      }
      return (await fs.stat(candidateRealPath)).isFile();
    } catch {
      return false;
    }
  }

  /**
   * Use git ls-files to get tracked and untracked files (respecting .gitignore)
   */
  private async gitLsFiles(): Promise<string[]> {
    return new Promise((resolve) => {
      const files: string[] = [];
      const ignoreFilter = this.ignoreFilter;

      const proc = spawn('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
        cwd: this.workspaceRoot
      });

      let stdout = '';

      proc.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      proc.on('close', (code) => {
        if (code === 0 && stdout) {
          stdout
            .split(/\r?\n/)
            .map((file) => file.trim())
            .filter(Boolean)
            .forEach((file) => {
              if (!ignoreFilter.isIgnored(file)) {
                files.push(file);
              }
            });
        }
        resolve(files);
      });

      proc.on('error', () => {
        resolve([]);
      });
    });
  }

  /**
   * Recursively walk workspace directory tree
   */
  private async walkWorkspace(current: string, acc: string[]): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(current);
    } catch {
      // Directory doesn't exist or can't be read
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry);
      const rel = path.relative(this.workspaceRoot, full);
      if (rel === '' || this.shouldSkipPath(rel) || this.ignoreFilter.isIgnored(rel)) {
        continue;
      }
      try {
        const stats = await fs.lstat(full);
        if (stats.isSymbolicLink()) {
          continue;
        }
        if (stats.isDirectory()) {
          await this.walkWorkspace(full, acc);
        } else if (stats.isFile()) {
          acc.push(rel);
        }
      } catch {
        // File doesn't exist or can't be accessed, skip it
        continue;
      }
    }
  }

  /**
   * Check if path should be skipped (common build/dependency directories)
   */
  private shouldSkipPath(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, '/');
    return (
      normalized.startsWith('.git') ||
      normalized.startsWith('node_modules') ||
      normalized.startsWith('dist') ||
      normalized.startsWith('build') ||
      normalized.startsWith('.next')
    );
  }
}
