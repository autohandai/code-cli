/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyCandidateToWorktree,
  assertCleanReplayableBaseline,
  captureCandidate,
  createEnvironmentFingerprint,
  restoreCandidateWorkingTree,
} from '../../src/autoresearch/candidate.js';
import { LedgerStore } from '../../src/autoresearch/ledger.js';

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
  return result.stdout;
}

async function createRepository(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-candidate-'));
  tempRoots.push(root);
  await git(root, ['init']);
  await git(root, ['config', 'user.email', 'tests@autohand.ai']);
  await git(root, ['config', 'user.name', 'Autohand Tests']);
  await fs.outputFile(path.join(root, 'text.txt'), 'before\n');
  await fs.outputFile(path.join(root, 'delete.txt'), 'delete me\n');
  await fs.outputFile(path.join(root, 'rename.txt'), 'rename me\n');
  await fs.outputFile(path.join(root, 'script.sh'), '#!/bin/sh\necho before\n', { mode: 0o644 });
  await fs.outputFile(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2, 3]));
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'baseline']);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
});

describe('autoresearch candidate capture', { timeout: 120_000 }, () => {
  it('requires a clean repository and reports dirty baseline paths', async () => {
    const root = await createRepository();
    await expect(assertCleanReplayableBaseline(root)).resolves.toMatchObject({
      baseCommit: expect.stringMatching(/^[a-f0-9]{40}$/),
    });

    await fs.writeFile(path.join(root, 'text.txt'), 'dirty\n');
    await expect(assertCleanReplayableBaseline(root)).rejects.toThrow(/clean Git working tree.*text\.txt/i);
  });

  it('round-trips text, binary, deletion, rename, executable, untracked, and symlink changes', async () => {
    const root = await createRepository();
    const baseline = await assertCleanReplayableBaseline(root);
    const store = new LedgerStore(root);
    await fs.writeFile(path.join(root, 'text.txt'), 'after\n');
    await fs.remove(path.join(root, 'delete.txt'));
    await git(root, ['mv', 'rename.txt', 'renamed.txt']);
    await fs.chmod(path.join(root, 'script.sh'), 0o755);
    await fs.writeFile(path.join(root, 'binary.bin'), Buffer.from([9, 0, 8, 7]));
    await fs.writeFile(path.join(root, 'untracked.txt'), 'untracked\n');
    await fs.symlink('../outside-target', path.join(root, 'untracked-link'));

    const candidate = await captureCandidate(root, {
      description: 'exercise every Git change kind',
      expectedBaseCommit: baseline.baseCommit,
      parentAttemptId: null,
      filesInScope: ['**'],
      evaluator: {
        config: { metricName: 'total_ms' },
        measureScript: 'echo "METRIC total_ms=1"',
      },
      environmentAllowlist: [],
    });

    expect(candidate.patchObject).toMatch(/^[a-f0-9]{64}$/);
    expect(candidate.untrackedFiles.map((file) => [file.path, file.kind])).toEqual([
      ['untracked-link', 'symlink'],
      ['untracked.txt', 'file'],
    ]);
    expect(candidate.changedPaths.map((file) => file.path)).toEqual(expect.arrayContaining([
      'binary.bin', 'delete.txt', 'rename.txt', 'renamed.txt', 'script.sh', 'text.txt',
      'untracked-link', 'untracked.txt',
    ]));

    const replayRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-candidate-replay-'));
    tempRoots.push(replayRoot);
    await fs.remove(replayRoot);
    await git(root, ['worktree', 'add', '--detach', replayRoot, baseline.baseCommit]);
    await applyCandidateToWorktree(replayRoot, candidate, store);

    expect(await fs.readFile(path.join(replayRoot, 'text.txt'), 'utf8')).toBe('after\n');
    expect(await fs.pathExists(path.join(replayRoot, 'delete.txt'))).toBe(false);
    expect(await fs.readFile(path.join(replayRoot, 'renamed.txt'), 'utf8')).toBe('rename me\n');
    expect(await fs.readFile(path.join(replayRoot, 'binary.bin'))).toEqual(Buffer.from([9, 0, 8, 7]));
    expect((await fs.stat(path.join(replayRoot, 'script.sh'))).mode & 0o111).not.toBe(0);
    expect(await fs.readFile(path.join(replayRoot, 'untracked.txt'), 'utf8')).toBe('untracked\n');
    expect(await fs.readlink(path.join(replayRoot, 'untracked-link'))).toBe('../outside-target');
  });

  it('blocks edits outside the configured scope before storing a candidate', async () => {
    const root = await createRepository();
    const baseline = await assertCleanReplayableBaseline(root);
    await fs.writeFile(path.join(root, 'text.txt'), 'outside scope\n');

    await expect(captureCandidate(root, {
      description: 'unsafe scope',
      expectedBaseCommit: baseline.baseCommit,
      parentAttemptId: null,
      filesInScope: ['src/**'],
      evaluator: { config: {}, measureScript: 'echo "METRIC total_ms=1"' },
      environmentAllowlist: [],
    })).rejects.toThrow(/outside the configured autoresearch scope.*text\.txt/i);
  });

  it('restores only captured candidate paths and preserves later unrelated edits', async () => {
    const root = await createRepository();
    const baseline = await assertCleanReplayableBaseline(root);
    await fs.writeFile(path.join(root, 'text.txt'), 'candidate\n');
    const candidate = await captureCandidate(root, {
      description: 'focused candidate',
      expectedBaseCommit: baseline.baseCommit,
      parentAttemptId: null,
      filesInScope: ['text.txt'],
      evaluator: { config: {}, measureScript: 'echo "METRIC total_ms=1"' },
      environmentAllowlist: [],
    });
    await fs.writeFile(path.join(root, 'delete.txt'), 'later unrelated edit\n');

    await restoreCandidateWorkingTree(root, candidate);

    expect(await fs.readFile(path.join(root, 'text.txt'), 'utf8')).toBe('before\n');
    expect(await fs.readFile(path.join(root, 'delete.txt'), 'utf8')).toBe('later unrelated edit\n');
  });

  it('blocks HEAD drift before candidate artifacts are persisted', async () => {
    const root = await createRepository();
    const baseline = await assertCleanReplayableBaseline(root);
    await fs.writeFile(path.join(root, 'text.txt'), 'new committed base\n');
    await git(root, ['add', 'text.txt']);
    await git(root, ['commit', '-m', 'advance head']);
    await fs.writeFile(path.join(root, 'text.txt'), 'candidate\n');

    await expect(captureCandidate(root, {
      description: 'stale lineage',
      expectedBaseCommit: baseline.baseCommit,
      parentAttemptId: null,
      evaluator: { config: {}, measureScript: 'echo "METRIC total_ms=1"' },
      environmentAllowlist: [],
    })).rejects.toThrow(/HEAD drift/i);
    expect(await fs.pathExists(path.join(root, '.auto', 'ledger', 'events.jsonl'))).toBe(false);
  });

  it('fingerprints only explicitly allowlisted non-secret environment variables', async () => {
    const root = await createRepository();
    process.env.AUTO_RESEARCH_SAFE_TEST_VALUE = 'visible';
    process.env.AUTO_RESEARCH_UNLISTED_TEST_VALUE = 'hidden';
    try {
      const fingerprint = await createEnvironmentFingerprint(
        root,
        { measure: 'echo "METRIC total_ms=1"' },
        ['AUTO_RESEARCH_SAFE_TEST_VALUE']
      );

      expect(fingerprint.allowedEnvironment).toEqual({ AUTO_RESEARCH_SAFE_TEST_VALUE: 'visible' });
      expect(JSON.stringify(fingerprint)).not.toContain('AUTO_RESEARCH_UNLISTED_TEST_VALUE');
      expect(JSON.stringify(fingerprint)).not.toContain('hidden');
    } finally {
      delete process.env.AUTO_RESEARCH_SAFE_TEST_VALUE;
      delete process.env.AUTO_RESEARCH_UNLISTED_TEST_VALUE;
    }
  });
});
