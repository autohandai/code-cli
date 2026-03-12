/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { gitStatus, gitListUntracked } from '../../src/actions/git.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';

describe('git tools in non-git directories', () => {
  it('gitStatus returns a message instead of throwing in non-git directory', () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autohand-test-'));
    try {
      const result = gitStatus(nonGitDir);
      expect(result).toContain('not a git repository');
      expect(result).toContain('git init');
      // Must NOT throw
    } finally {
      fs.removeSync(nonGitDir);
    }
  });

  it('gitListUntracked returns a message instead of throwing in non-git directory', () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autohand-test-'));
    try {
      const result = gitListUntracked(nonGitDir);
      expect(result).toContain('not a git repository');
      expect(result).toContain('git init');
    } finally {
      fs.removeSync(nonGitDir);
    }
  });

  it('gitStatus still works normally in a git directory', () => {
    const gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autohand-test-'));
    try {
      const { spawnSync } = require('node:child_process');
      spawnSync('git', ['init'], { cwd: gitDir });
      const result = gitStatus(gitDir);
      // Should return normal status, not an error
      expect(result).not.toContain('not a git repository');
    } finally {
      fs.removeSync(gitDir);
    }
  });
});
