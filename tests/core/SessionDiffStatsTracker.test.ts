/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionDiffStatsTracker } from '../../src/core/SessionDiffStatsTracker.js';

const tmpDirs: string[] = [];
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
};
const GIT_EXEC_OPTIONS = {
  env: GIT_ENV,
  stdio: 'ignore',
  timeout: 10_000,
} as const;

async function createRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-session-diff-'));
  tmpDirs.push(dir);
  execFileSync('git', ['init'], { cwd: dir, ...GIT_EXEC_OPTIONS });
  await fs.writeFile(path.join(dir, 'tracked.txt'), 'one\ntwo\nthree\n');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: dir, ...GIT_EXEC_OPTIONS });
  execFileSync(
    'git',
    [
      '-c', 'user.email=test@example.com',
      '-c', 'user.name=Test User',
      '-c', 'commit.gpgsign=false',
      '-c', 'core.hooksPath=/dev/null',
      'commit',
      '--no-gpg-sign',
      '--no-verify',
      '-m',
      'init',
    ],
    { cwd: dir, ...GIT_EXEC_OPTIONS }
  );
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.remove(dir)));
});

describe('SessionDiffStatsTracker', () => {
  it('computes tracked line additions and removals since the tracker baseline', async () => {
    const repo = await createRepo();
    const tracker = new SessionDiffStatsTracker(repo);

    await fs.writeFile(path.join(repo, 'tracked.txt'), 'one\nthree\nfour\nfive\n');

    expect(tracker.getStats()).toEqual({ added: 2, removed: 1 });
  });

  it('counts new untracked files created after the baseline as added lines', async () => {
    const repo = await createRepo();
    await fs.writeFile(path.join(repo, 'preexisting-untracked.txt'), 'old\n');
    const tracker = new SessionDiffStatsTracker(repo);

    await fs.writeFile(path.join(repo, 'new-untracked.txt'), 'alpha\nbeta\n');

    expect(tracker.getStats()).toEqual({ added: 2, removed: 0 });
  });

  it('excludes pre-existing dirty tracked changes from the session totals', async () => {
    const repo = await createRepo();
    await fs.writeFile(path.join(repo, 'tracked.txt'), 'one\ntwo\nthree\nbefore-session\n');
    const tracker = new SessionDiffStatsTracker(repo);

    await fs.writeFile(path.join(repo, 'tracked.txt'), 'one\ntwo\nthree\nbefore-session\nduring-session\n');

    expect(tracker.getStats()).toEqual({ added: 1, removed: 0 });
  });
});
