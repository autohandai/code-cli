/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { runStartupChecks } from '../src/startup/checks.js';

describe('Git Auto-Init for Empty Directories', () => {
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

  describe('isEmptyDirectory detection', () => {
    it('treats directory with no files as empty', async () => {
      // tempDir is empty by default
      const result = await runStartupChecks(tempDir);

      // Should have auto-initialized git
      expect(result.workspace.isGitRepo).toBe(true);
      expect(result.workspace.initialized).toBe(true);
    });

    it('treats directory with only hidden files (like .DS_Store) as empty', async () => {
      // Add a hidden file that should be ignored
      await fs.writeFile(path.join(tempDir, '.DS_Store'), 'test');

      const result = await runStartupChecks(tempDir);

      // Should still auto-initialize git
      expect(result.workspace.isGitRepo).toBe(true);
      expect(result.workspace.initialized).toBe(true);
    });

    it('does NOT treat directory with .git as empty', async () => {
      // Manually create a .git directory (simulate existing repo)
      await fs.ensureDir(path.join(tempDir, '.git'));

      const result = await runStartupChecks(tempDir);

      // .git counts as significant, but it also means it's already a git repo
      // So it should be detected as a git repo, but NOT initialized by us
      expect(result.workspace.initialized).toBeFalsy();
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

  describe('git initialization behavior', () => {
    it('creates .git directory when initializing', async () => {
      const result = await runStartupChecks(tempDir);

      expect(result.workspace.initialized).toBe(true);
      expect(await fs.pathExists(path.join(tempDir, '.git'))).toBe(true);
    });

    it('sets branch name after initialization', async () => {
      const result = await runStartupChecks(tempDir);

      expect(result.workspace.initialized).toBe(true);
      expect(result.workspace.branch).toBeDefined();
      // Branch should be 'main' or 'master' depending on git config
      expect(['main', 'master']).toContain(result.workspace.branch);
    });

    it('creates .gitignore with .DS_Store on macOS', async () => {
      const result = await runStartupChecks(tempDir);

      expect(result.workspace.initialized).toBe(true);

      // Only check for .gitignore on macOS
      if (process.platform === 'darwin') {
        const gitignorePath = path.join(tempDir, '.gitignore');
        expect(await fs.pathExists(gitignorePath)).toBe(true);

        const content = await fs.readFile(gitignorePath, 'utf8');
        expect(content).toContain('.DS_Store');
      }
    });
  });

  describe('existing git repo detection', () => {
    it('detects existing git repo and does NOT re-initialize', async () => {
      // First call initializes git
      const firstResult = await runStartupChecks(tempDir);
      expect(firstResult.workspace.initialized).toBe(true);

      // Second call should detect existing repo, not initialize again
      const secondResult = await runStartupChecks(tempDir);
      expect(secondResult.workspace.isGitRepo).toBe(true);
      expect(secondResult.workspace.initialized).toBeFalsy();
    });

    it('detects branch in existing repo', async () => {
      // Initialize git
      await runStartupChecks(tempDir);

      // Run again and check branch detection
      const result = await runStartupChecks(tempDir);
      expect(result.workspace.branch).toBeDefined();
    });
  });
});
