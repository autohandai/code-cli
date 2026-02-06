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

export class WorkspaceFileCollector {
  private workspaceFiles: string[] = [];
  private workspaceFilesCachedAt = 0;

  constructor(
    private workspaceRoot: string,
    private ignoreFilter: GitIgnoreParser
  ) {}

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
  async collectWorkspaceFiles(): Promise<string[]> {
    // Use cached files if still fresh (avoid blocking git ls-files on every turn)
    const now = Date.now();
    if (this.workspaceFiles.length > 0 && (now - this.workspaceFilesCachedAt) < WORKSPACE_FILES_CACHE_TTL) {
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
        const stats = await fs.stat(full);
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
