/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs-extra';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getTheme, isThemeInitialized } from '../ui/theme/index.js';

const execAsync = promisify(exec);

/**
 * Supported package managers
 */
export type PackageManager = 'bun' | 'pnpm' | 'yarn' | 'npm' | 'cargo' | 'go' | 'pip' | 'poetry';

/**
 * Status of a bootstrap step
 */
export type BootstrapStepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

/**
 * Individual bootstrap step result
 */
export interface BootstrapStep {
  name: string;
  status: BootstrapStepStatus;
  detail?: string;
  duration?: number; // ms
  error?: string;
}

/**
 * Full bootstrap result
 */
export interface BootstrapResult {
  success: boolean;
  steps: BootstrapStep[];
  packageManager?: PackageManager | null;
  duration: number; // Total ms
}

/**
 * Bootstrap options
 */
export interface BootstrapOptions {
  skipGitSync?: boolean; // For offline mode
  skipInstall?: boolean; // If deps already installed
  force?: boolean; // Re-run even if cached
}

/**
 * Lockfile to package manager mapping
 */
interface LockfileMapping {
  file: string;
  pm: PackageManager;
}

/**
 * Mandatory environment setup before file modifications.
 * Ensures git is synced, dependencies installed, and toolchain validated.
 */
export class EnvironmentBootstrap {
  private lastResult: BootstrapResult | null = null;
  private lastRunTime: number = 0;
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes

  /**
   * Lockfile priority order for package manager detection
   */
  private readonly lockfileChecks: LockfileMapping[] = [
    { file: 'bun.lockb', pm: 'bun' },
    { file: 'bun.lock', pm: 'bun' },
    { file: 'pnpm-lock.yaml', pm: 'pnpm' },
    { file: 'yarn.lock', pm: 'yarn' },
    { file: 'package-lock.json', pm: 'npm' },
    { file: 'Cargo.lock', pm: 'cargo' },
    { file: 'go.sum', pm: 'go' },
    { file: 'poetry.lock', pm: 'poetry' },
    { file: 'requirements.txt', pm: 'pip' },
  ];

  /**
   * Install commands for each package manager (with frozen lockfile where applicable)
   */
  private readonly installCommands: Record<PackageManager, string> = {
    bun: 'bun install --frozen-lockfile',
    pnpm: 'pnpm install --frozen-lockfile',
    yarn: 'yarn install --frozen-lockfile',
    npm: 'npm ci',
    cargo: 'cargo fetch',
    go: 'go mod download',
    pip: 'pip install -r requirements.txt',
    poetry: 'poetry install',
  };

  /**
   * Fallback install commands (non-frozen) for when frozen install fails
   */
  private readonly fallbackInstallCommands: Record<PackageManager, string> = {
    bun: 'bun install',
    pnpm: 'pnpm install',
    yarn: 'yarn install',
    npm: 'npm install',
    cargo: 'cargo fetch',
    go: 'go mod download',
    pip: 'pip install -r requirements.txt',
    poetry: 'poetry install',
  };

  /**
   * Run full bootstrap sequence
   * @param workspaceRoot - Root directory of the workspace
   * @param options - Bootstrap options
   * @returns Bootstrap result with all steps
   */
  async run(workspaceRoot: string, options?: BootstrapOptions): Promise<BootstrapResult> {
    // Check cache unless forced
    if (!options?.force && this.isCacheValid()) {
      return this.lastResult!;
    }

    const startTime = Date.now();
    const steps: BootstrapStep[] = [];

    // Step 1: Git sync
    if (!options?.skipGitSync) {
      steps.push(await this.gitSync(workspaceRoot));
    }

    // Step 2: Detect package manager
    const pm = await this.detectPackageManager(workspaceRoot);
    if (pm) {
      steps.push({
        name: 'Package Manager',
        status: 'success',
        detail: `Detected: ${pm}`,
      });
    }

    // Step 3: Install dependencies
    if (pm && !options?.skipInstall) {
      steps.push(await this.installDependencies(workspaceRoot, pm));
    }

    // Step 4: Validate toolchain
    steps.push(await this.validateToolchain(workspaceRoot));

    const result: BootstrapResult = {
      success: steps.every((s) => s.status === 'success' || s.status === 'skipped'),
      steps,
      packageManager: pm,
      duration: Date.now() - startTime,
    };

    this.lastResult = result;
    this.lastRunTime = Date.now();

    return result;
  }

  /**
   * Detect package manager from lockfiles or package.json
   * @param root - Workspace root directory
   * @returns Detected package manager or null
   */
  async detectPackageManager(root: string): Promise<PackageManager | null> {
    // Check lockfiles in priority order
    for (const { file, pm } of this.lockfileChecks) {
      if (await fs.pathExists(join(root, file))) {
        return pm;
      }
    }

    // Check package.json packageManager field
    const pkgPath = join(root, 'package.json');
    if (await fs.pathExists(pkgPath)) {
      try {
        const pkg = await fs.readJson(pkgPath);
        if (pkg.packageManager) {
          const match = pkg.packageManager.match(/^(bun|pnpm|yarn|npm)@/);
          if (match) {
            return match[1] as PackageManager;
          }
        }
        // Default for package.json without lockfile
        return 'npm';
      } catch {
        // Invalid package.json, treat as no package manager
        return null;
      }
    }

    return null;
  }

  /**
   * Get install command for package manager
   * @param pm - Package manager
   * @returns Install command string
   */
  getInstallCommand(pm: PackageManager): string {
    return this.installCommands[pm];
  }

  /**
   * Git synchronization step
   * @param root - Workspace root directory
   * @returns Bootstrap step result
   */
  private async gitSync(root: string): Promise<BootstrapStep> {
    const step: BootstrapStep = { name: 'Git Sync', status: 'running' };
    const start = Date.now();

    try {
      // Check if git repo
      const isGit = await fs.pathExists(join(root, '.git'));
      if (!isGit) {
        return {
          ...step,
          status: 'skipped',
          detail: 'Not a git repository',
          duration: Date.now() - start,
        };
      }

      // Fetch from remote
      await execAsync('git fetch --all --prune', { cwd: root, timeout: 30000 });

      // Check git status
      const { stdout: statusOutput } = await execAsync('git status -uno', { cwd: root });

      if (statusOutput.includes('Your branch is behind')) {
        // Try fast-forward pull
        try {
          await execAsync('git pull --ff-only', { cwd: root, timeout: 60000 });
          step.detail = 'Pulled latest changes';
        } catch {
          step.detail = 'Behind remote (pull failed, may need manual merge)';
        }
      } else if (statusOutput.includes('Your branch is ahead')) {
        step.detail = 'Local commits not pushed';
      } else {
        step.detail = 'Up to date';
      }

      step.status = 'success';
      step.duration = Date.now() - start;
    } catch (error) {
      step.status = 'failed';
      step.error = error instanceof Error ? error.message : String(error);
      step.duration = Date.now() - start;
    }

    return step;
  }

  /**
   * Install dependencies with frozen lockfile, with fallback to non-frozen
   * @param root - Workspace root directory
   * @param pm - Package manager to use
   * @returns Bootstrap step result
   */
  private async installDependencies(root: string, pm: PackageManager): Promise<BootstrapStep> {
    const step: BootstrapStep = { name: 'Dependencies', status: 'running' };
    const start = Date.now();

    try {
      const cmd = this.installCommands[pm];
      await execAsync(cmd, { cwd: root, timeout: 120000 });
      step.status = 'success';
      step.detail = cmd;
      step.duration = Date.now() - start;
    } catch (error) {
      // Frozen lockfile failed - try fallback (non-frozen)
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isLockfileError =
        errorMsg.includes('lockfile') ||
        errorMsg.includes('frozen') ||
        errorMsg.includes('out of sync') ||
        errorMsg.includes('npm ci');

      if (isLockfileError) {
        try {
          const fallbackCmd = this.fallbackInstallCommands[pm];
          await execAsync(fallbackCmd, { cwd: root, timeout: 120000 });
          step.status = 'success';
          step.detail = `${fallbackCmd} (lockfile updated)`;
          step.duration = Date.now() - start;
        } catch (fallbackError) {
          step.status = 'failed';
          step.error = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          step.duration = Date.now() - start;
        }
      } else {
        step.status = 'failed';
        step.error = errorMsg;
        step.duration = Date.now() - start;
      }
    }

    return step;
  }

  /**
   * Validate toolchain versions
   * @param root - Workspace root directory
   * @returns Bootstrap step result
   */
  private async validateToolchain(root: string): Promise<BootstrapStep> {
    const step: BootstrapStep = { name: 'Toolchain', status: 'running' };
    const start = Date.now();
    const details: string[] = [];

    try {
      // Check for .nvmrc
      const nvmrcPath = join(root, '.nvmrc');
      const nvmrcExists = await fs.pathExists(nvmrcPath);

      // Check for .node-version
      const nodeVersionPath = join(root, '.node-version');
      const nodeVersionExists = await fs.pathExists(nodeVersionPath);

      if (nvmrcExists || nodeVersionExists) {
        // We have a version file, so record it
        details.push('Node version file found');
      }

      // Check for .tool-versions (asdf)
      const toolVersionsPath = join(root, '.tool-versions');
      if (await fs.pathExists(toolVersionsPath)) {
        details.push('.tool-versions found');
      }

      // Check for rust-toolchain.toml
      const rustToolchainPath = join(root, 'rust-toolchain.toml');
      if (await fs.pathExists(rustToolchainPath)) {
        details.push('Rust toolchain found');
      }

      step.status = 'success';
      step.detail = details.length > 0 ? details.join(', ') : 'No version constraints';
      step.duration = Date.now() - start;
    } catch (error) {
      step.status = 'failed';
      step.error = error instanceof Error ? error.message : String(error);
      step.duration = Date.now() - start;
    }

    return step;
  }

  /**
   * Check if cached result is still valid
   */
  private isCacheValid(): boolean {
    return (
      this.lastResult !== null &&
      this.lastResult.success &&
      Date.now() - this.lastRunTime < this.cacheTimeout
    );
  }

  /**
   * Clear cached result
   */
  clearCache(): void {
    this.lastResult = null;
    this.lastRunTime = 0;
  }

  /**
   * Format bootstrap result for display
   * @param result - Bootstrap result
   * @returns Formatted string for terminal display
   */
  formatDisplay(result: BootstrapResult): string {
    const useTheme = isThemeInitialized();
    const theme = useTheme ? getTheme() : null;

    // Helper functions for coloring
    const accent = (text: string) => (theme ? theme.fg('accent', text) : text);
    const success = (text: string) => (theme ? theme.fg('success', text) : text);
    const error = (text: string) => (theme ? theme.fg('error', text) : text);
    const warning = (text: string) => (theme ? theme.fg('warning', text) : text);
    const muted = (text: string) => (theme ? theme.fg('muted', text) : text);

    const lines: string[] = [accent('[BOOTSTRAP] Environment Setup')];

    for (let i = 0; i < result.steps.length; i++) {
      const step = result.steps[i];
      const isLast = i === result.steps.length - 1;
      const prefix = muted(isLast ? '  └── ' : '  ├── ');

      let status: string;
      switch (step.status) {
        case 'success':
          status = success('[OK]');
          break;
        case 'failed':
          status = error('[FAIL]');
          break;
        case 'skipped':
          status = warning('[SKIP]');
          break;
        default:
          status = muted('[...]');
      }

      const duration = step.duration ? muted(`(${(step.duration / 1000).toFixed(1)}s)`) : '';
      const detail = step.detail ? muted(` ${step.detail}`) : '';
      lines.push(`${prefix}${status} ${step.name.padEnd(14)} ${duration}${detail}`);

      if (step.error) {
        lines.push(error(`      Error: ${step.error}`));
      }
    }

    // Add summary
    if (result.success) {
      lines.push('');
      lines.push(success(`[READY] Environment ready (${(result.duration / 1000).toFixed(1)}s)`));
    } else {
      lines.push('');
      lines.push(error('[BLOCKED] Cannot proceed. Fix issues first.'));
    }

    return lines.join('\n');
  }
}
