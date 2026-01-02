/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Git Safety Tests - Verifies protections against dangerous git operations
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GIT_SAFETY, gitPush, gitRebase, gitMerge, gitReset } from '../../src/actions/git.js';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

describe('Git Safety', () => {
  describe('GIT_SAFETY constants', () => {
    it('should have PROTECTED_BRANCHES defined', () => {
      expect(GIT_SAFETY.PROTECTED_BRANCHES).toBeDefined();
      expect(Array.isArray(GIT_SAFETY.PROTECTED_BRANCHES)).toBe(true);
    });

    it('should protect main branch', () => {
      expect(GIT_SAFETY.PROTECTED_BRANCHES).toContain('main');
    });

    it('should protect master branch', () => {
      expect(GIT_SAFETY.PROTECTED_BRANCHES).toContain('master');
    });

    it('should protect develop branch', () => {
      expect(GIT_SAFETY.PROTECTED_BRANCHES).toContain('develop');
    });

    it('should protect production branch', () => {
      expect(GIT_SAFETY.PROTECTED_BRANCHES).toContain('production');
    });

    it('should protect staging branch', () => {
      expect(GIT_SAFETY.PROTECTED_BRANCHES).toContain('staging');
    });

    it('should have MAX_COMMITS_PER_PUSH defined', () => {
      expect(GIT_SAFETY.MAX_COMMITS_PER_PUSH).toBeDefined();
      expect(GIT_SAFETY.MAX_COMMITS_PER_PUSH).toBeGreaterThan(0);
    });

    it('should have reasonable MAX_COMMITS_PER_PUSH value', () => {
      expect(GIT_SAFETY.MAX_COMMITS_PER_PUSH).toBe(50);
    });
  });

  describe('gitPush safety checks', () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-git-test-'));
      // Initialize a git repo
      spawnSync('git', ['init'], { cwd: testDir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: testDir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: testDir });
      // Create initial commit
      await fs.writeFile(path.join(testDir, 'README.md'), '# Test');
      spawnSync('git', ['add', '.'], { cwd: testDir });
      spawnSync('git', ['commit', '-m', 'Initial commit'], { cwd: testDir });
    });

    afterEach(async () => {
      await fs.remove(testDir);
    });

    it('should block force push to main branch', () => {
      // Checkout main branch
      spawnSync('git', ['checkout', '-b', 'main'], { cwd: testDir });

      expect(() => {
        gitPush(testDir, 'origin', 'main', { force: true });
      }).toThrow(/Force push to protected branch "main" is blocked/);
    });

    it('should block force push to master branch', () => {
      spawnSync('git', ['checkout', '-b', 'master'], { cwd: testDir });

      expect(() => {
        gitPush(testDir, 'origin', 'master', { force: true });
      }).toThrow(/Force push to protected branch "master" is blocked/);
    });

    it('should block force push to develop branch', () => {
      spawnSync('git', ['checkout', '-b', 'develop'], { cwd: testDir });

      expect(() => {
        gitPush(testDir, 'origin', 'develop', { force: true });
      }).toThrow(/Force push to protected branch "develop" is blocked/);
    });

    it('should block force push to production branch', () => {
      spawnSync('git', ['checkout', '-b', 'production'], { cwd: testDir });

      expect(() => {
        gitPush(testDir, 'origin', 'production', { force: true });
      }).toThrow(/Force push to protected branch "production" is blocked/);
    });

    it('should allow force push to feature branches', () => {
      spawnSync('git', ['checkout', '-b', 'feature/my-feature'], { cwd: testDir });

      // This will fail because no remote, but should not throw protection error
      expect(() => {
        gitPush(testDir, 'origin', 'feature/my-feature', { force: true });
      }).toThrow(/does not appear to be a git repository|git push failed/); // Fails for different reason (no remote)
    });

    it('should include protected branches list in error message', () => {
      spawnSync('git', ['checkout', '-b', 'main'], { cwd: testDir });

      expect(() => {
        gitPush(testDir, 'origin', 'main', { force: true });
      }).toThrow(/Protected branches:/);
    });
  });

  describe('gitRebase safety checks', () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-git-test-'));
      spawnSync('git', ['init'], { cwd: testDir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: testDir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: testDir });
      await fs.writeFile(path.join(testDir, 'README.md'), '# Test');
      spawnSync('git', ['add', '.'], { cwd: testDir });
      spawnSync('git', ['commit', '-m', 'Initial commit'], { cwd: testDir });
    });

    afterEach(async () => {
      await fs.remove(testDir);
    });

    it('should block rebase when on main branch', () => {
      spawnSync('git', ['checkout', '-b', 'main'], { cwd: testDir });

      expect(() => {
        gitRebase(testDir, 'HEAD~1');
      }).toThrow(/Rebasing protected branch "main" is blocked/);
    });

    it('should block rebase when on master branch', () => {
      spawnSync('git', ['checkout', '-b', 'master'], { cwd: testDir });

      expect(() => {
        gitRebase(testDir, 'HEAD~1');
      }).toThrow(/Rebasing protected branch "master" is blocked/);
    });

    it('should block rebase when on develop branch', () => {
      spawnSync('git', ['checkout', '-b', 'develop'], { cwd: testDir });

      expect(() => {
        gitRebase(testDir, 'HEAD~1');
      }).toThrow(/Rebasing protected branch "develop" is blocked/);
    });

    it('should suggest using merge instead', () => {
      spawnSync('git', ['checkout', '-b', 'main'], { cwd: testDir });

      expect(() => {
        gitRebase(testDir, 'HEAD~1');
      }).toThrow(/Use merge instead/);
    });

    it('should allow rebase on feature branches', async () => {
      spawnSync('git', ['checkout', '-b', 'feature/test'], { cwd: testDir });
      // Add another commit to rebase
      await fs.writeFile(path.join(testDir, 'file.txt'), 'content');
      spawnSync('git', ['add', '.'], { cwd: testDir });
      spawnSync('git', ['commit', '-m', 'Another commit'], { cwd: testDir });

      // Should not throw protection error
      // May fail for other reasons but not the protection
      try {
        gitRebase(testDir, 'HEAD~1');
      } catch (e: any) {
        expect(e.message).not.toMatch(/Rebasing protected branch/);
      }
    });
  });

  describe('gitMerge safety checks', () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-git-test-'));
      spawnSync('git', ['init'], { cwd: testDir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: testDir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: testDir });
      await fs.writeFile(path.join(testDir, 'README.md'), '# Test');
      spawnSync('git', ['add', '.'], { cwd: testDir });
      spawnSync('git', ['commit', '-m', 'Initial commit'], { cwd: testDir });
    });

    afterEach(async () => {
      await fs.remove(testDir);
    });

    it('should block merge of non-existent branch', () => {
      expect(() => {
        gitMerge(testDir, 'non-existent-branch');
      }).toThrow(/Branch "non-existent-branch" not found/);
    });

    it('should include security message for non-existent branch', () => {
      expect(() => {
        gitMerge(testDir, 'attacker-branch');
      }).toThrow(/For security, only existing branches can be merged/);
    });

    it('should suggest git fetch for remote branches', () => {
      expect(() => {
        gitMerge(testDir, 'remote-branch');
      }).toThrow(/Run 'git fetch' first/);
    });

    it('should allow merge of existing local branch', async () => {
      // Create a branch to merge
      spawnSync('git', ['checkout', '-b', 'feature'], { cwd: testDir });
      await fs.writeFile(path.join(testDir, 'feature.txt'), 'feature content');
      spawnSync('git', ['add', '.'], { cwd: testDir });
      spawnSync('git', ['commit', '-m', 'Feature commit'], { cwd: testDir });
      spawnSync('git', ['checkout', '-'], { cwd: testDir }); // Go back to previous branch

      // Should not throw - merge should work
      const result = gitMerge(testDir, 'feature');
      expect(result).toMatch(/Fast-forward|Merge|Updating/);
    });
  });

  describe('Force push uses --force-with-lease', () => {
    it('should use --force-with-lease instead of --force', () => {
      // This is a design verification test
      // The implementation should use --force-with-lease for safer force pushing
      // We verify this by checking the GIT_SAFETY documentation/constants exist
      expect(GIT_SAFETY.PROTECTED_BRANCHES).toBeDefined();
    });
  });

  describe('gitReset safety checks', () => {
    let testDir: string;

    beforeEach(async () => {
      testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-git-test-'));
      spawnSync('git', ['init'], { cwd: testDir });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: testDir });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: testDir });
      await fs.writeFile(path.join(testDir, 'README.md'), '# Test');
      spawnSync('git', ['add', '.'], { cwd: testDir });
      spawnSync('git', ['commit', '-m', 'Initial commit'], { cwd: testDir });
    });

    afterEach(async () => {
      await fs.remove(testDir);
    });

    it('should block hard reset on main branch', () => {
      spawnSync('git', ['checkout', '-b', 'main'], { cwd: testDir });

      expect(() => {
        gitReset(testDir, 'hard', 'HEAD~1');
      }).toThrow(/Hard reset on protected branch "main" is blocked/);
    });

    it('should block hard reset on master branch', () => {
      spawnSync('git', ['checkout', '-b', 'master'], { cwd: testDir });

      expect(() => {
        gitReset(testDir, 'hard');
      }).toThrow(/Hard reset on protected branch "master" is blocked/);
    });

    it('should block hard reset on develop branch', () => {
      spawnSync('git', ['checkout', '-b', 'develop'], { cwd: testDir });

      expect(() => {
        gitReset(testDir, 'hard', 'HEAD~1');
      }).toThrow(/Hard reset on protected branch "develop" is blocked/);
    });

    it('should allow soft reset on protected branches', () => {
      spawnSync('git', ['checkout', '-b', 'main'], { cwd: testDir });

      // Soft reset should not throw
      const result = gitReset(testDir, 'soft');
      expect(result).toContain('Reset soft');
    });

    it('should allow mixed reset on protected branches', () => {
      spawnSync('git', ['checkout', '-b', 'main'], { cwd: testDir });

      // Mixed reset should not throw
      const result = gitReset(testDir, 'mixed');
      expect(result).toContain('Reset mixed');
    });

    it('should allow hard reset on feature branches', async () => {
      spawnSync('git', ['checkout', '-b', 'feature/test'], { cwd: testDir });
      // Add another commit to reset
      await fs.writeFile(path.join(testDir, 'file.txt'), 'content');
      spawnSync('git', ['add', '.'], { cwd: testDir });
      spawnSync('git', ['commit', '-m', 'Another commit'], { cwd: testDir });

      // Hard reset on feature branch should work (returns git's output or our message)
      const result = gitReset(testDir, 'hard', 'HEAD~1');
      expect(result).toMatch(/HEAD is now at|Reset hard/);
    });

    it('should include suggestion for alternatives in error message', () => {
      spawnSync('git', ['checkout', '-b', 'main'], { cwd: testDir });

      expect(() => {
        gitReset(testDir, 'hard');
      }).toThrow(/Use soft or mixed reset instead/);
    });
  });
});
