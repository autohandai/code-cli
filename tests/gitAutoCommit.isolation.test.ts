import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { captureAutoCommitSnapshot, executeAutoCommit, getAutoCommitInfo } from '../src/actions/git.js';
import { finalizeSessionGitSnapshot, resetSessionGitSnapshot, type SessionGitState } from '../src/actions/gitSessionSnapshot.js';

describe('session-scoped auto-commit (F-0151)', () => {
  let root: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd();
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'autohand-commit-isolation-'));
    git('init', '-q'); git('config', 'user.name', 'Autohand Tests'); git('config', 'user.email', 'tests@autohand.ai');
    fs.writeFileSync(path.join(root, 'README.md'), 'original\n');
    fs.writeFileSync(path.join(root, 'old name.txt'), 'rename this\n');
    git('add', '--', '.'); git('commit', '-qm', 'fixture');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('defers a new session baseline until its first instruction and preserves intervening user edits', async () => {
    const runtime: SessionGitState = {
      workspaceRoot: root, sessionGitSnapshot: captureAutoCommitSnapshot(root),
      sessionGitSnapshotFinalized: true, sessionGitSnapshotError: 'previous session',
    };
    resetSessionGitSnapshot(runtime);
    expect(runtime.sessionGitSnapshot).toBeUndefined();
    expect(runtime.sessionGitSnapshotError).toBeUndefined();
    expect(runtime.sessionGitSnapshotFinalized).toBe(false);
    fs.writeFileSync(path.join(root, 'README.md'), 'user edit before first instruction\n');
    fs.writeFileSync(path.join(root, 'notes.txt'), 'user notes before first instruction\n');
    finalizeSessionGitSnapshot(runtime);
    const snapshot = runtime.sessionGitSnapshot;
    if (!snapshot) throw new Error('The first instruction must capture a Git baseline');
    fs.writeFileSync(path.join(root, 'feature.ts'), 'session feature\n');
    const result = await executeAutoCommit(root, 'Add session feature', true, snapshot);
    expect(result.success).toBe(true);
    expect(git('show', '--pretty=', '--name-only', 'HEAD')).toBe('feature.ts');
    expect(git('status', '--porcelain')).toContain(' M README.md');
    expect(git('status', '--porcelain')).toContain('?? notes.txt');
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toBe('user edit before first instruction\n');
    expect(fs.readFileSync(path.join(root, 'notes.txt'), 'utf8')).toBe('user notes before first instruction\n');
  });

  it('commits only the new test and leaves pre-existing edits and untracked notes alone', async () => {
    fs.writeFileSync(path.join(root, 'README.md'), 'user edit\n');
    fs.writeFileSync(path.join(root, 'notes.txt'), 'private user notes\n');
    const snapshot = captureAutoCommitSnapshot(root);
    fs.writeFileSync(path.join(root, 'feature.test.ts'), 'test added by session\n');
    const info = getAutoCommitInfo(root, snapshot);
    expect(info.filesChanged).toEqual(['feature.test.ts']);
    expect(info.filesLeftUncommitted).toEqual(expect.arrayContaining(['README.md', 'notes.txt']));
    const result = await executeAutoCommit(root, 'Add feature regression', true, snapshot);
    expect(result.success).toBe(true);
    expect(git('show', '--pretty=', '--name-only', 'HEAD')).toBe('feature.test.ts');
    expect(git('status', '--porcelain')).toContain(' M README.md');
    expect(git('status', '--porcelain')).toContain('?? notes.txt');
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toBe('user edit\n');
  });

  it('preserves the existing index as well as unstaged user content', async () => {
    fs.writeFileSync(path.join(root, 'README.md'), 'user staged edit\n'); git('add', '--', 'README.md');
    fs.writeFileSync(path.join(root, 'README.md'), 'user unstaged edit too\n');
    const staged = git('show', ':README.md');
    const snapshot = captureAutoCommitSnapshot(root);
    fs.writeFileSync(path.join(root, 'feature.ts'), 'session feature\n');
    const result = await executeAutoCommit(root, 'Add session feature', true, snapshot);
    expect(result.success).toBe(true);
    expect(git('show', ':README.md')).toBe(staged);
    expect(git('diff', '--cached', '--name-only')).toBe('README.md');
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toBe('user unstaged edit too\n');
    expect(git('show', '--pretty=', '--name-only', 'HEAD')).toBe('feature.ts');
  });

  it('leaves an initially dirty path uncommitted even if the agent edits it again', async () => {
    fs.writeFileSync(path.join(root, 'README.md'), 'user change\n');
    const snapshot = captureAutoCommitSnapshot(root);
    fs.appendFileSync(path.join(root, 'README.md'), 'agent change\n');
    fs.writeFileSync(path.join(root, 'session.ts'), 'session\n');
    await executeAutoCommit(root, 'Commit session only', true, snapshot);
    expect(git('show', '--pretty=', '--name-only', 'HEAD')).toBe('session.ts');
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toBe('user change\nagent change\n');
  });

  it('handles staged renames, deletions and filenames containing spaces', async () => {
    const snapshot = captureAutoCommitSnapshot(root);
    git('mv', 'old name.txt', 'new name.txt');
    fs.unlinkSync(path.join(root, 'README.md'));
    const result = await executeAutoCommit(root, 'Rename and remove session files', true, snapshot);
    expect(result.success).toBe(true);
    expect(git('show', '--pretty=', '--name-status', '--no-renames', 'HEAD')).toContain('D\tREADME.md');
    expect(git('status', '--porcelain')).toBe('');
  });

  it('treats pathspec characters as literal filenames', async () => {
    fs.writeFileSync(path.join(root, 'd.txt'), 'user file\n');
    const snapshot = captureAutoCommitSnapshot(root);
    fs.writeFileSync(path.join(root, '[data].txt'), 'session file\n');
    const result = await executeAutoCommit(root, 'Add literal file', true, snapshot);
    expect(result.success).toBe(true);
    expect(git('show', '--pretty=', '--name-only', 'HEAD')).toBe('[data].txt');
    expect(git('status', '--porcelain')).toContain('?? d.txt');
  });

  it('detects a content change even when the old modification time is restored', () => {
    const snapshot = captureAutoCommitSnapshot(root);
    const file = path.join(root, 'README.md'); const before = fs.statSync(file);
    fs.writeFileSync(file, 'replaced\n'); fs.utimesSync(file, before.atime, before.mtime);
    expect(getAutoCommitInfo(root, snapshot).filesChanged).toContain('README.md');
  });

  it('fails closed when no session baseline was captured', async () => {
    fs.writeFileSync(path.join(root, 'notes.txt'), 'user content\n');
    expect(getAutoCommitInfo(root, null).canCommit).toBe(false);
    const head = git('rev-parse', 'HEAD');
    const result = await executeAutoCommit(root, 'Must not commit', true, null);
    expect(result.success).toBe(false);
    expect(git('rev-parse', 'HEAD')).toBe(head);
    expect(git('diff', '--cached', '--name-only')).toBe('');
  });
  it('commits only the staged session content when stage_all is false', async () => {
    fs.writeFileSync(path.join(root, 'notes.txt'), 'user notes\n'); git('add', '--', 'notes.txt');
    const snapshot = captureAutoCommitSnapshot(root);
    fs.writeFileSync(path.join(root, 'README.md'), 'session staged\n'); git('add', '--', 'README.md');
    fs.writeFileSync(path.join(root, 'README.md'), 'session unstaged\n');
    const result = await executeAutoCommit(root, 'Commit staged session only', false, snapshot);
    expect(result.success).toBe(true);
    expect(git('show', 'HEAD:README.md')).toBe('session staged');
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toBe('session unstaged\n');
    expect(git('diff', '--cached', '--name-only')).toBe('notes.txt');
  });

  it('does not finish a pre-existing merge operation', async () => {
    const snapshot = captureAutoCommitSnapshot(root);
    fs.writeFileSync(path.join(root, 'feature.ts'), 'session\n');
    fs.writeFileSync(path.join(root, '.git', 'MERGE_HEAD'), git('rev-parse', 'HEAD') + '\n');
    expect(getAutoCommitInfo(root, snapshot).canCommit).toBe(false);
    expect((await executeAutoCommit(root, 'Must not commit', true, snapshot)).success).toBe(false);
  });

});
