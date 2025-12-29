/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EnvironmentBootstrap } from '../../src/core/EnvironmentBootstrap';
import type { PackageManager } from '../../src/core/EnvironmentBootstrap';
import * as fs from 'fs-extra';
import * as child_process from 'child_process';

// Mock fs-extra - share references between named and default exports
vi.mock('fs-extra', () => {
  const pathExists = vi.fn();
  const readJson = vi.fn();
  return {
    pathExists,
    readJson,
    default: {
      pathExists,
      readJson
    }
  };
});

// Mock child_process
vi.mock('child_process', () => ({
  exec: vi.fn()
}));

describe('EnvironmentBootstrap', () => {
  let bootstrap: EnvironmentBootstrap;
  const mockWorkspace = '/test/workspace';

  beforeEach(() => {
    bootstrap = new EnvironmentBootstrap();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('detectPackageManager()', () => {
    it('detects bun from bun.lockb', async () => {
      vi.mocked(fs.pathExists).mockImplementation(async (path: string) => {
        return path.endsWith('bun.lockb');
      });

      const pm = await bootstrap.detectPackageManager(mockWorkspace);
      expect(pm).toBe('bun');
    });

    it('detects bun from bun.lock', async () => {
      vi.mocked(fs.pathExists).mockImplementation(async (path: string) => {
        return path.endsWith('bun.lock');
      });

      const pm = await bootstrap.detectPackageManager(mockWorkspace);
      expect(pm).toBe('bun');
    });

    it('detects pnpm from pnpm-lock.yaml', async () => {
      vi.mocked(fs.pathExists).mockImplementation(async (path: string) => {
        return path.endsWith('pnpm-lock.yaml');
      });

      const pm = await bootstrap.detectPackageManager(mockWorkspace);
      expect(pm).toBe('pnpm');
    });

    it('detects yarn from yarn.lock', async () => {
      vi.mocked(fs.pathExists).mockImplementation(async (path: string) => {
        return path.endsWith('yarn.lock');
      });

      const pm = await bootstrap.detectPackageManager(mockWorkspace);
      expect(pm).toBe('yarn');
    });

    it('detects npm from package-lock.json', async () => {
      vi.mocked(fs.pathExists).mockImplementation(async (path: string) => {
        return path.endsWith('package-lock.json');
      });

      const pm = await bootstrap.detectPackageManager(mockWorkspace);
      expect(pm).toBe('npm');
    });

    it('detects cargo from Cargo.lock', async () => {
      vi.mocked(fs.pathExists).mockImplementation(async (path: string) => {
        return path.endsWith('Cargo.lock');
      });

      const pm = await bootstrap.detectPackageManager(mockWorkspace);
      expect(pm).toBe('cargo');
    });

    it('detects go from go.sum', async () => {
      vi.mocked(fs.pathExists).mockImplementation(async (path: string) => {
        return path.endsWith('go.sum');
      });

      const pm = await bootstrap.detectPackageManager(mockWorkspace);
      expect(pm).toBe('go');
    });

    it('detects poetry from poetry.lock', async () => {
      vi.mocked(fs.pathExists).mockImplementation(async (path: string) => {
        return path.endsWith('poetry.lock');
      });

      const pm = await bootstrap.detectPackageManager(mockWorkspace);
      expect(pm).toBe('poetry');
    });

    it('detects pip from requirements.txt', async () => {
      vi.mocked(fs.pathExists).mockImplementation(async (path: string) => {
        return path.endsWith('requirements.txt');
      });

      const pm = await bootstrap.detectPackageManager(mockWorkspace);
      expect(pm).toBe('pip');
    });

    it('returns npm for package.json without lockfile', async () => {
      vi.mocked(fs.pathExists).mockImplementation(async (path: string) => {
        return path.endsWith('package.json');
      });
      vi.mocked(fs.readJson).mockResolvedValue({});

      const pm = await bootstrap.detectPackageManager(mockWorkspace);
      expect(pm).toBe('npm');
    });

    it('detects from packageManager field in package.json', async () => {
      vi.mocked(fs.pathExists).mockImplementation(async (path: string) => {
        return path.endsWith('package.json');
      });
      vi.mocked(fs.readJson).mockResolvedValue({
        packageManager: 'pnpm@8.0.0'
      });

      const pm = await bootstrap.detectPackageManager(mockWorkspace);
      expect(pm).toBe('pnpm');
    });

    it('returns null when no package manager found', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(false);

      const pm = await bootstrap.detectPackageManager(mockWorkspace);
      expect(pm).toBeNull();
    });

    it('prioritizes lockfiles over package.json', async () => {
      // Both bun.lockb and package.json exist
      vi.mocked(fs.pathExists).mockImplementation(async (path: string) => {
        return path.endsWith('bun.lockb') || path.endsWith('package.json');
      });

      const pm = await bootstrap.detectPackageManager(mockWorkspace);
      expect(pm).toBe('bun');
    });
  });

  describe('getInstallCommand()', () => {
    it('returns correct command for each package manager', () => {
      const commands: Record<PackageManager, string> = {
        bun: 'bun install --frozen-lockfile',
        pnpm: 'pnpm install --frozen-lockfile',
        yarn: 'yarn install --frozen-lockfile',
        npm: 'npm ci',
        cargo: 'cargo fetch',
        go: 'go mod download',
        pip: 'pip install -r requirements.txt',
        poetry: 'poetry install'
      };

      for (const [pm, expected] of Object.entries(commands)) {
        const cmd = bootstrap.getInstallCommand(pm as PackageManager);
        expect(cmd).toBe(expected);
      }
    });
  });

  describe('run()', () => {
    it('returns success when all steps pass', async () => {
      // Mock all checks passing
      vi.mocked(fs.pathExists).mockImplementation(async (path: string) => {
        return path.endsWith('.git') || path.endsWith('bun.lockb');
      });

      // Mock git and install commands
      const mockExec = vi.fn((cmd, opts, callback) => {
        callback(null, { stdout: 'success', stderr: '' });
      });
      vi.mocked(child_process.exec).mockImplementation(mockExec as any);

      const result = await bootstrap.run(mockWorkspace);

      expect(result.success).toBe(true);
      expect(result.steps.length).toBeGreaterThan(0);
    });

    it('returns cached result within timeout', async () => {
      // First run
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      const mockExec = vi.fn((cmd, opts, callback) => {
        callback(null, { stdout: 'success', stderr: '' });
      });
      vi.mocked(child_process.exec).mockImplementation(mockExec as any);

      const result1 = await bootstrap.run(mockWorkspace);
      const result2 = await bootstrap.run(mockWorkspace);

      // Should return cached result
      expect(result2).toEqual(result1);
    });

    it('re-runs when force option is true', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(true);
      const mockExec = vi.fn((cmd, opts, callback) => {
        callback(null, { stdout: 'success', stderr: '' });
      });
      vi.mocked(child_process.exec).mockImplementation(mockExec as any);

      await bootstrap.run(mockWorkspace);
      const callCount = mockExec.mock.calls.length;

      await bootstrap.run(mockWorkspace, { force: true });

      expect(mockExec.mock.calls.length).toBeGreaterThan(callCount);
    });

    it('skips git sync when skipGitSync is true', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(false);

      const result = await bootstrap.run(mockWorkspace, { skipGitSync: true });

      expect(result.steps.find(s => s.name === 'Git Sync')).toBeUndefined();
    });

    it('skips install when skipInstall is true', async () => {
      vi.mocked(fs.pathExists).mockImplementation(async (path: string) => {
        return path.endsWith('bun.lockb');
      });

      const result = await bootstrap.run(mockWorkspace, { skipInstall: true });

      expect(result.steps.find(s => s.name === 'Dependencies')).toBeUndefined();
    });

    it('includes duration in result', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(false);

      const result = await bootstrap.run(mockWorkspace, { skipGitSync: true });

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('gitSync()', () => {
    it('returns skipped when not a git repo', async () => {
      vi.mocked(fs.pathExists).mockResolvedValue(false);

      const result = await bootstrap.run(mockWorkspace);
      const gitStep = result.steps.find(s => s.name === 'Git Sync');

      expect(gitStep?.status).toBe('skipped');
      expect(gitStep?.detail).toContain('Not a git repository');
    });

    it('handles git fetch failure gracefully', async () => {
      vi.mocked(fs.pathExists).mockImplementation(async (path: string) => {
        return path.endsWith('.git');
      });

      const mockExec = vi.fn((cmd, opts, callback) => {
        callback(new Error('Network error'), { stdout: '', stderr: 'fatal: unable to fetch' });
      });
      vi.mocked(child_process.exec).mockImplementation(mockExec as any);

      const result = await bootstrap.run(mockWorkspace);
      const gitStep = result.steps.find(s => s.name === 'Git Sync');

      expect(gitStep?.status).toBe('failed');
      expect(gitStep?.error).toBeDefined();
    });
  });

  describe('validateToolchain()', () => {
    it('checks .nvmrc when present', async () => {
      vi.mocked(fs.pathExists).mockImplementation(async (path: string) => {
        return path.endsWith('.nvmrc');
      });

      // Would need to mock readFile too for full test
      const result = await bootstrap.run(mockWorkspace, { skipGitSync: true });
      const toolchainStep = result.steps.find(s => s.name === 'Toolchain');

      expect(toolchainStep).toBeDefined();
    });

    it('checks .node-version when present', async () => {
      vi.mocked(fs.pathExists).mockImplementation(async (path: string) => {
        return path.endsWith('.node-version');
      });

      const result = await bootstrap.run(mockWorkspace, { skipGitSync: true });
      const toolchainStep = result.steps.find(s => s.name === 'Toolchain');

      expect(toolchainStep).toBeDefined();
    });
  });
});
