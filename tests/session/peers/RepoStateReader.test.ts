/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fse from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';
import { readRepoHead } from '../../../src/session/peers/RepoStateReader.js';

const tempRoots: string[] = [];

async function makeRoot(prefix = 'autohand-repostate-'): Promise<string> {
  const root = await fse.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fse.remove(root)));
});

describe('readRepoHead', () => {
  it('does not depend on subprocess execution', async () => {
    const sourcePath = fileURLToPath(
      new URL('../../../src/session/peers/RepoStateReader.ts', import.meta.url),
    );
    const source = await fse.readFile(sourcePath, 'utf8');

    expect(source).not.toContain('node:child_process');
    expect(source).not.toMatch(/from\s+['"]child_process['"]/u);
    expect(source).not.toMatch(/require\(\s*['"]child_process['"]\s*\)/u);
  });

  it('reads a symbolic ref and its loose ref file', async () => {
    const root = await makeRoot();
    await fse.ensureDir(path.join(root, '.git', 'refs', 'heads'));
    await fse.writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    await fse.writeFile(path.join(root, '.git', 'refs', 'heads', 'main'), 'abc123def456\n');

    expect(await readRepoHead(root)).toEqual({ branch: 'main', sha: 'abc123def456' });
  });

  it('reads a detached HEAD', async () => {
    const root = await makeRoot();
    await fse.ensureDir(path.join(root, '.git'));
    await fse.writeFile(path.join(root, '.git', 'HEAD'), 'deadbeefcafe\n');

    expect(await readRepoHead(root)).toEqual({ branch: null, sha: 'deadbeefcafe' });
  });

  it('falls back to packed-refs when the loose ref is absent', async () => {
    const root = await makeRoot();
    await fse.ensureDir(path.join(root, '.git'));
    await fse.writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/feature\n');
    await fse.writeFile(
      path.join(root, '.git', 'packed-refs'),
      '# pack-refs with: peeled fully-peeled sorted\n'
        + '1111111111111111111111111111111111111111 refs/heads/main\n'
        + '2222222222222222222222222222222222222222 refs/heads/feature\n',
    );

    expect(await readRepoHead(root)).toEqual({
      branch: 'feature',
      sha: '2222222222222222222222222222222222222222',
    });
  });

  it('resolves a worktree gitdir file and common-dir refs', async () => {
    const root = await makeRoot('autohand-worktree-state-');
    const commonGitDir = path.join(root, '..', `${path.basename(root)}-common.git`);
    const worktreeGitDir = path.join(commonGitDir, 'worktrees', 'feature');
    tempRoots.push(commonGitDir);
    await fse.ensureDir(worktreeGitDir);
    await fse.ensureDir(path.join(commonGitDir, 'refs', 'heads'));
    await fse.writeFile(path.join(root, '.git'), `gitdir: ${worktreeGitDir}\n`);
    await fse.writeFile(path.join(worktreeGitDir, 'commondir'), '../..\n');
    await fse.writeFile(path.join(worktreeGitDir, 'HEAD'), 'ref: refs/heads/feature\n');
    await fse.writeFile(path.join(commonGitDir, 'refs', 'heads', 'feature'), 'worktree123\n');

    expect(await readRepoHead(root)).toEqual({ branch: 'feature', sha: 'worktree123' });
  });

  it('returns null outside a git repository', async () => {
    const root = await makeRoot('autohand-norepo-');
    expect(await readRepoHead(root)).toBeNull();
  });
});
