/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { execFileSync } from 'node:child_process';
import { runStartupChecks, validateWorkspacePath } from '../src/startup/checks.js';

describe('Optional Git at startup', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    tempDir = path.join(os.tmpdir(), `autohand-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.ensureDir(tempDir);
  });

  afterEach(async () => {
    // Cleanup temp directory
    try {
      await fs.remove(tempDir);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('read-only repository detection', () => {
    it('starts an empty workspace without initializing Git', async () => {
      // tempDir is empty by default
      const result = await runStartupChecks(tempDir);

      expect(result.workspace.isGitRepo).toBe(false);
      expect(result.workspace.initialized).toBeFalsy();
      expect(await fs.readdir(tempDir)).toEqual([]);
    });

    it('preserves hidden files without creating a repository', async () => {
      // Add a hidden file that should be ignored
      await fs.writeFile(path.join(tempDir, '.DS_Store'), 'test');

      const result = await runStartupChecks(tempDir);

      expect(result.workspace.isGitRepo).toBe(false);
      expect(result.workspace.initialized).toBeFalsy();
      expect(await fs.readdir(tempDir)).toEqual(['.DS_Store']);
    });

    it('does NOT treat directory with .git as empty', async () => {
      // Manually create a .git directory (simulate existing repo)
      await fs.ensureDir(path.join(tempDir, '.git'));

      const result = await runStartupChecks(tempDir);

      // .git counts as significant, but it also means it's already a git repo
      // So it should be detected as a git repo, but NOT initialized by us
      expect(result.workspace.initialized).toBeFalsy();
    });

    it('does not wait on git commands when a .git directory has no HEAD', async () => {
      await fs.ensureDir(path.join(tempDir, '.git'));

      const start = performance.now();
      const result = await runStartupChecks(tempDir);
      const elapsedMs = performance.now() - start;

      expect(result.workspace.isGitRepo).toBe(true);
      expect(result.workspace.initialized).toBeFalsy();
      expect(result.workspace.branch).toBeUndefined();
      expect(elapsedMs).toBeLessThan(1_000);
    });

    it('does NOT auto-init if directory has files', async () => {
      // Add a regular file
      await fs.writeFile(path.join(tempDir, 'README.md'), '# Project');

      const result = await runStartupChecks(tempDir);

      // Should NOT auto-initialize git (directory is not empty)
      expect(result.workspace.isGitRepo).toBe(false);
      expect(result.workspace.initialized).toBeFalsy();
    });

    it('does NOT auto-init if directory has subdirectories', async () => {
      // Add a subdirectory
      await fs.ensureDir(path.join(tempDir, 'src'));

      const result = await runStartupChecks(tempDir);

      // Should NOT auto-initialize git (directory is not empty)
      expect(result.workspace.isGitRepo).toBe(false);
      expect(result.workspace.initialized).toBeFalsy();
    });
  });

  describe('Git is an explicit project choice', () => {
    it('does not create a Git directory or ignore file after repeated startup checks', async () => {
      await runStartupChecks(tempDir);
      await runStartupChecks(tempDir);
      expect(await fs.pathExists(path.join(tempDir, '.git'))).toBe(false);
      expect(await fs.pathExists(path.join(tempDir, '.gitignore'))).toBe(false);
    });

    it('keeps a non-Git project writable and Git tooling optional', async () => {
      const result = await runStartupChecks(tempDir);
      expect(result.workspace.writable).toBe(true);
      expect(result.workspace.isGitRepo).toBe(false);
      expect(result.workspace.branch).toBeUndefined();
      expect(result.tools.find(tool => tool.name === 'git')?.required).toBe(false);
    });

    it('preserves an existing ignore file', async () => {
      await fs.writeFile(path.join(tempDir, '.gitignore'), 'private-files/\n');
      await runStartupChecks(tempDir);
      expect(await fs.readFile(path.join(tempDir, '.gitignore'), 'utf8')).toBe('private-files/\n');
      expect(await fs.pathExists(path.join(tempDir, '.git'))).toBe(false);
    });
  });

  describe('existing git repo detection', () => {
    it('detects existing git repo and does NOT re-initialize', async () => {
      execFileSync('git', ['init', '-b', 'chosen-branch'], { cwd: tempDir, stdio: 'ignore' });
      const firstResult = await runStartupChecks(tempDir);
      expect(firstResult.workspace.initialized).toBeFalsy();

      // Second call should detect existing repo, not initialize again
      const secondResult = await runStartupChecks(tempDir);
      expect(secondResult.workspace.isGitRepo).toBe(true);
      expect(secondResult.workspace.initialized).toBeFalsy();
    });

    it('detects branch in existing repo', async () => {
      execFileSync('git', ['init', '-b', 'chosen-branch'], { cwd: tempDir, stdio: 'ignore' });

      // Run again and check branch detection
      const result = await runStartupChecks(tempDir);
      expect(result.workspace.branch).toBe('chosen-branch');
    });

    it('detects branch directly from git HEAD when git commands are unavailable', async () => {
      await fs.ensureDir(path.join(tempDir, '.git'));
      await fs.writeFile(path.join(tempDir, '.git', 'HEAD'), 'ref: refs/heads/feature/startup-check\n');

      const result = await runStartupChecks(tempDir);

      expect(result.workspace.isGitRepo).toBe(true);
      expect(result.workspace.branch).toBe('feature/startup-check');
    });
  });

  describe('workspace path validation', () => {
    it('rejects a missing workspace path early', async () => {
      const result = await validateWorkspacePath(path.join(tempDir, 'missing-project'));
      expect(result.valid).toBe(false);
      expect(result.error).toContain('does not exist');
    });

    it('rejects a non-directory workspace path early', async () => {
      const filePath = path.join(tempDir, 'file.txt');
      await fs.writeFile(filePath, 'hello');

      const result = await validateWorkspacePath(filePath);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not a directory');
    });
  });
});
