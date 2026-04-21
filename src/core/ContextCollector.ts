/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'fs-extra';
import path from 'node:path';
import { runWithConcurrency } from '../utils/parallel.js';

const execFileAsync = promisify(execFile);

/**
 * Context information collected for shell suggestions and other operations.
 */
export interface CollectedContext {
  /** Git status output (short format) */
  gitStatus: string;
  /** Package manager and scripts information */
  packageContext: string;
  /** Timestamp when context was collected */
  collectedAt: number;
}

/**
 * Cache entry for package context with expiration.
 */
interface PackageContextCache {
  value: string;
  expiresAt: number;
}

/**
 * Options for ContextCollector.
 */
export interface ContextCollectorOptions {
  /** Root directory for context collection */
  workspaceRoot: string;
  /** Maximum parallelism for concurrent operations */
  parallelismLimit?: number;
  /** Cache TTL for package context in milliseconds (default: 30000) */
  packageContextCacheTtl?: number;
  /** Timeout for git commands in milliseconds (default: 1200) */
  gitTimeout?: number;
}

/**
 * Consolidates context collection methods for shell suggestions and other operations.
 * Provides caching and parallel collection for efficiency.
 * 
 * @example
 * ```typescript
 * const collector = new ContextCollector({
 *   workspaceRoot: '/path/to/project',
 *   parallelismLimit: 5
 * });
 * 
 * const context = await collector.collect();
 * console.log(context.gitStatus);
 * console.log(context.packageContext);
 * ```
 */
export class ContextCollector {
  private readonly workspaceRoot: string;
  private readonly parallelismLimit: number;
  private readonly packageContextCacheTtl: number;
  private readonly gitTimeout: number;
  private packageContextCache: PackageContextCache | null = null;

  constructor(options: ContextCollectorOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.parallelismLimit = options.parallelismLimit ?? 5;
    this.packageContextCacheTtl = options.packageContextCacheTtl ?? 30_000;
    this.gitTimeout = options.gitTimeout ?? 1200;
  }

  /**
   * Collect all context information in parallel.
   * Returns an object with git status and package context.
   */
  async collect(): Promise<CollectedContext> {
    const [packageContext, gitStatus] = await runWithConcurrency([
      { label: 'package_context', run: () => this.getPackageContext() },
      { label: 'git_status', run: () => this.getGitStatus() },
    ], this.parallelismLimit);

    return {
      gitStatus,
      packageContext,
      collectedAt: Date.now(),
    };
  }

  /**
   * Get git status in short format.
   * Returns empty string if git is not available or on error.
   */
  async getGitStatus(): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['status', '--short', '--branch'],
        {
          cwd: this.workspaceRoot,
          encoding: 'utf8',
          timeout: this.gitTimeout
        }
      );
      return String(stdout || '').trim().slice(0, 1200);
    } catch {
      return '';
    }
  }

  /**
   * Get package manager and scripts context.
   * Results are cached for the configured TTL.
   */
  async getPackageContext(): Promise<string> {
    const now = Date.now();
    
    // Return cached value if still valid
    if (this.packageContextCache && this.packageContextCache.expiresAt > now) {
      return this.packageContextCache.value;
    }

    const lines: string[] = [];
    
    // Check for various package managers
    const existenceChecks = [
      { label: 'bun.lockb', paths: ['bun.lockb', 'bun.lock'], manager: 'bun' },
      { label: 'pnpm-lock.yaml', paths: ['pnpm-lock.yaml'], manager: 'pnpm' },
      { label: 'yarn.lock', paths: ['yarn.lock'], manager: 'yarn' },
      { label: 'package-lock.json', paths: ['package-lock.json'], manager: 'npm' },
      { label: 'python-lockfiles', paths: ['pyproject.toml', 'requirements.txt', 'Pipfile'], manager: 'python' },
      { label: 'Cargo.toml', paths: ['Cargo.toml'], manager: 'cargo' },
      { label: 'go.mod', paths: ['go.mod'], manager: 'go' },
    ] as const;

    const managerChecks = await runWithConcurrency(
      existenceChecks.map(({ label, paths, manager }) => ({
        label,
        run: async () => ({
          manager,
          present: (await Promise.all(
            paths.map((rel) => fs.pathExists(path.join(this.workspaceRoot, rel)))
          )).some(Boolean),
        }),
      })),
      this.parallelismLimit,
    );

    const managers = managerChecks
      .filter((entry: { manager: string; present: boolean }) => entry.present)
      .map((entry: { manager: string; present: boolean }) => entry.manager);

    if (managers.length > 0) {
      lines.push(`Detected package managers: ${Array.from(new Set(managers)).join(', ')}`);
    }

    // Read package.json scripts if available
    try {
      const packageJsonPath = path.join(this.workspaceRoot, 'package.json');
      if (await fs.pathExists(packageJsonPath)) {
        const pkg = await fs.readJson(packageJsonPath) as { scripts?: Record<string, string> };
        const scripts = Object.keys(pkg.scripts ?? {});
        if (scripts.length > 0) {
          lines.push(`package.json scripts: ${scripts.slice(0, 20).join(', ')}`);
        }
      }
    } catch {
      // best effort
    }

    const value = lines.join('\n');
    
    // Update cache
    this.packageContextCache = {
      value,
      expiresAt: now + this.packageContextCacheTtl,
    };
    
    return value;
  }

  /**
   * Clear the package context cache.
   * Useful when package.json or lock files have changed.
   */
  clearCache(): void {
    this.packageContextCache = null;
  }

  /**
   * Check if package context cache is valid.
   */
  isCacheValid(): boolean {
    return this.packageContextCache !== null 
      && this.packageContextCache.expiresAt > Date.now();
  }
}