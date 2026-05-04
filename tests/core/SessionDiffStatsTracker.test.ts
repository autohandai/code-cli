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

async function createRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-session-diff-'));
  tmpDirs.push(dir);
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  await fs.writeFile(path.join(dir, 'tracked.txt'), 'one\ntwo\nthree\n');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: dir, stdio: 'ignore' });
  execFileSync(
    'git',
    ['-c', 'user.email=test@example.com', '-c', 'user.name=Test User', 'commit', '-m', 'init'],
    { cwd: dir, stdio: 'ignore' }
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
