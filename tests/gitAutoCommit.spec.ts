/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  isGitRepository,
  gitInit,
  getAutoCommitInfo,
  executeAutoCommit
} from '../src/actions/git.js';

describe('Git Auto-Commit Functions', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'autohand-test-'));
  });

  afterEach(() => {
    // Clean up temporary directory
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('isGitRepository', () => {
    it('returns false for non-git directory', () => {
      expect(isGitRepository(tempDir)).toBe(false);
    });

    it('returns true for git repository', () => {
      spawnSync('git', ['init'], { cwd: tempDir });
      expect(isGitRepository(tempDir)).toBe(true);
    });
  });

  describe('gitInit', () => {
    it('initializes a new git repository', () => {
      const result = gitInit(tempDir);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Initialized');
      expect(isGitRepository(tempDir)).toBe(true);
    });

    it('succeeds even if already initialized', () => {
      // Initialize once
      gitInit(tempDir);
      // Initialize again
      const result = gitInit(tempDir);

      // Git reinitializes without error
      expect(result.success).toBe(true);
    });
  });

  describe('getAutoCommitInfo', () => {
    it('returns error for non-git directory', () => {
      const info = getAutoCommitInfo(tempDir);

      expect(info.canCommit).toBe(false);
      expect(info.error).toBe('Not a git repository');
      expect(info.filesChanged).toEqual([]);
    });

    it('returns no changes for clean repository', () => {
      spawnSync('git', ['init'], { cwd: tempDir });
      // Configure git user for commits
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tempDir });
      spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: tempDir });

      const info = getAutoCommitInfo(tempDir);

      expect(info.canCommit).toBe(false);
      expect(info.error).toBe('No changes to commit');
    });

    it('detects new files', () => {
      spawnSync('git', ['init'], { cwd: tempDir });
      writeFileSync(join(tempDir, 'test.txt'), 'hello world');

      const info = getAutoCommitInfo(tempDir);

      expect(info.canCommit).toBe(true);
      expect(info.filesChanged).toContain('test.txt');
      expect(info.suggestedMessage).toContain('Add');
    });

    it('detects modified files', () => {
      spawnSync('git', ['init'], { cwd: tempDir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tempDir });
      spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: tempDir });

      // Create and commit initial file
      writeFileSync(join(tempDir, 'test.txt'), 'initial content');
      spawnSync('git', ['add', 'test.txt'], { cwd: tempDir });
      spawnSync('git', ['commit', '-m', 'initial'], { cwd: tempDir });

      // Modify the file
      writeFileSync(join(tempDir, 'test.txt'), 'modified content');

      const info = getAutoCommitInfo(tempDir);

      expect(info.canCommit).toBe(true);
      // Check that we have changed files detected
      expect(info.filesChanged.length).toBeGreaterThan(0);
      expect(info.suggestedMessage).toContain('Modify');
    });

    it('generates appropriate commit message for single file', () => {
      spawnSync('git', ['init'], { cwd: tempDir });
      writeFileSync(join(tempDir, 'newfile.ts'), 'export const x = 1;');

      const info = getAutoCommitInfo(tempDir);

      expect(info.suggestedMessage).toMatch(/feat:.*Add.*newfile\.ts/i);
    });

    it('generates appropriate commit message for multiple files', () => {
      spawnSync('git', ['init'], { cwd: tempDir });
      writeFileSync(join(tempDir, 'file1.ts'), 'content1');
      writeFileSync(join(tempDir, 'file2.ts'), 'content2');
      writeFileSync(join(tempDir, 'file3.ts'), 'content3');

      const info = getAutoCommitInfo(tempDir);

      expect(info.suggestedMessage).toMatch(/add 3 files/i);
    });

    it('generates message for multiple new files', () => {
      spawnSync('git', ['init'], { cwd: tempDir });
      writeFileSync(join(tempDir, 'feature.test.ts'), 'test content');
      writeFileSync(join(tempDir, 'other.test.ts'), 'more test content');

      const info = getAutoCommitInfo(tempDir);

      // Multiple added files uses feat prefix
      expect(info.suggestedMessage).toMatch(/feat:.*add 2 files/i);
    });

    it('generates message for multiple doc files', () => {
      spawnSync('git', ['init'], { cwd: tempDir });
      writeFileSync(join(tempDir, 'README.md'), '# Readme');
      writeFileSync(join(tempDir, 'CONTRIBUTING.md'), '# Contributing');

      const info = getAutoCommitInfo(tempDir);

      // Multiple added files uses feat prefix
      expect(info.suggestedMessage).toMatch(/feat:.*add 2 files/i);
    });

    it('uses feat prefix for single file addition', () => {
      spawnSync('git', ['init'], { cwd: tempDir });
      writeFileSync(join(tempDir, 'feature.test.ts'), 'test content');

      const info = getAutoCommitInfo(tempDir);

      // Single file additions use "feat: Add <filename>"
      expect(info.suggestedMessage).toMatch(/feat:.*Add/i);
    });
  });

  describe('executeAutoCommit', () => {
    beforeEach(() => {
      // Initialize git and configure user
      spawnSync('git', ['init'], { cwd: tempDir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tempDir });
      spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: tempDir });
    });

    it('commits staged changes', () => {
      writeFileSync(join(tempDir, 'test.txt'), 'hello');

      const result = executeAutoCommit(tempDir, 'test commit');

      expect(result.success).toBe(true);
      expect(result.filesChanged).toBe(1);
      expect(result.commitHash).toBeDefined();
      expect(result.message).toContain('Committed');
    });

    it('stages all changes when stageAll is true', () => {
      writeFileSync(join(tempDir, 'file1.txt'), 'content1');
      writeFileSync(join(tempDir, 'file2.txt'), 'content2');

      const result = executeAutoCommit(tempDir, 'commit multiple files', true);

      expect(result.success).toBe(true);
      expect(result.filesChanged).toBe(2);
    });

    it('returns error when no changes to commit', () => {
      // Create an initial commit so repo is not empty
      writeFileSync(join(tempDir, 'initial.txt'), 'initial');
      spawnSync('git', ['add', '.'], { cwd: tempDir });
      spawnSync('git', ['commit', '-m', 'initial'], { cwd: tempDir });

      // Try to commit with no new changes
      const result = executeAutoCommit(tempDir, 'empty commit');

      expect(result.success).toBe(false);
      // The error message may vary - just check it indicates failure
      expect(result.message).toBeDefined();
    });

    it('returns the short commit hash', () => {
      writeFileSync(join(tempDir, 'test.txt'), 'content');

      const result = executeAutoCommit(tempDir, 'test');

      expect(result.success).toBe(true);
      expect(result.commitHash).toMatch(/^[a-f0-9]{7,}$/);
    });
  });
});
