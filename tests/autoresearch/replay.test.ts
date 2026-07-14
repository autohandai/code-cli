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
import { LedgerStore, createLedgerId, loadLedgerEvents } from '../../src/autoresearch/ledger.js';
import { replayExperiment } from '../../src/autoresearch/replay.js';
import { initExperiment, runExperiment } from '../../src/autoresearch/tools.js';

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execFileAsync('git', args, { cwd, encoding: 'utf8' })).stdout;
}

async function createRepository(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-replay-'));
  roots.push(root);
  await git(root, ['init']);
  await git(root, ['config', 'user.email', 'tests@autohand.ai']);
  await git(root, ['config', 'user.name', 'Autohand Tests']);
  await fs.writeFile(path.join(root, 'value.txt'), '100\n');
  await git(root, ['add', 'value.txt']);
  await git(root, ['commit', '-m', 'baseline']);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.remove(root)));
});

describe('isolated autoresearch replay', { timeout: 120_000 }, () => {
  it('rejects unknown evaluator modes before reading or executing ledger artifacts', async () => {
    const result = await replayExperiment('/missing-autoresearch-workspace', 'attempt_invalid', {
      evaluator: 'future' as 'original',
    });

    expect(result).toMatchObject({
      success: false,
      attemptId: 'attempt_invalid',
      error: expect.stringMatching(/evaluator.*original.*current/i),
    });
  });

  it('reconstructs and evaluates a rejected candidate without changing the user branch or worktree', async () => {
    const root = await createRepository();
    await initExperiment(root, {
      name: 'runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      filesInScope: ['value.txt'],
    });
    await fs.writeFile(path.join(root, 'value.txt'), '120\n');
    const original = await runExperiment(root, 'regression');
    const headBefore = (await git(root, ['rev-parse', 'HEAD'])).trim();
    const statusBefore = await git(root, ['status', '--porcelain=v1', '--', '.', ':(exclude).auto']);
    const worktreesBefore = await git(root, ['worktree', 'list', '--porcelain']);

    const replayed = await replayExperiment(root, original.attemptId!, { evaluator: 'original' });

    expect(replayed).toMatchObject({
      success: true,
      attemptId: original.attemptId,
      evaluatorMode: 'original',
      metrics: { total_ms: 120 },
      decision: { outcome: 'rejected', materialized: false },
    });
    expect((await git(root, ['rev-parse', 'HEAD'])).trim()).toBe(headBefore);
    expect(await git(root, ['status', '--porcelain=v1', '--', '.', ':(exclude).auto'])).toBe(statusBefore);
    expect(await git(root, ['worktree', 'list', '--porcelain'])).toBe(worktreesBefore);

    const events = await loadLedgerEvents(root);
    expect(events.filter((event) => event.attemptId === original.attemptId).map((event) => event.type))
      .toEqual(['candidate', 'evaluation', 'decision', 'evaluation', 'decision']);
  }, 120_000);

  it('uses the current evaluator when requested and records environment drift warnings', async () => {
    const root = await createRepository();
    await initExperiment(root, {
      name: 'runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      filesInScope: ['value.txt'],
    });
    await fs.writeFile(path.join(root, 'value.txt'), '120\n');
    const original = await runExperiment(root, 'regression');
    await fs.writeFile(path.join(root, '.auto', 'measure.sh'), '#!/bin/bash\necho "METRIC total_ms=77"');

    const replayed = await replayExperiment(root, original.attemptId!, { evaluator: 'current' });

    expect(replayed.metrics).toEqual({ total_ms: 77 });
    expect(replayed.driftWarnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/evaluator.*changed/i),
    ]));
  }, 120_000);

  it('remains replayable when retention prunes only historical benchmark output', async () => {
    const root = await createRepository();
    await initExperiment(root, {
      name: 'runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      filesInScope: ['value.txt'],
    });
    await fs.writeFile(path.join(root, 'value.txt'), '120\n');
    const original = await runExperiment(root, 'regression');
    const store = new LedgerStore(root);
    const evaluation = (await loadLedgerEvents(root)).find((event) =>
      event.type === 'evaluation' && event.attemptId === original.attemptId
    );
    expect(evaluation?.type).toBe('evaluation');
    const outputObject = evaluation?.type === 'evaluation' ? evaluation.samples[0].outputObject : '';
    const bytes = (await fs.stat(store.objectPath(outputObject))).size;
    await fs.remove(store.objectPath(outputObject));
    await store.append({
      schemaVersion: 1,
      type: 'artifact_pruned',
      id: createLedgerId('event'),
      attemptId: original.attemptId!,
      timestamp: new Date().toISOString(),
      context: {},
      objects: [outputObject],
      bytesFreed: bytes,
      reason: 'historical output retention test',
    });

    const replayed = await replayExperiment(root, original.attemptId!);

    expect(replayed).toMatchObject({ success: true, metrics: { total_ms: 120 } });
  });

  it('always removes the temporary worktree after evaluator failure', async () => {
    const root = await createRepository();
    await initExperiment(root, {
      name: 'runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      filesInScope: ['value.txt'],
    });
    await fs.writeFile(path.join(root, 'value.txt'), '120\n');
    const original = await runExperiment(root, 'regression');
    await fs.writeFile(path.join(root, '.auto', 'measure.sh'), '#!/bin/bash\nexit 7');
    const worktreesBefore = await git(root, ['worktree', 'list', '--porcelain']);

    const replayed = await replayExperiment(root, original.attemptId!, { evaluator: 'current' });

    expect(replayed.success).toBe(false);
    expect(replayed.error).toMatch(/exit code 7/i);
    expect(await git(root, ['worktree', 'list', '--porcelain'])).toBe(worktreesBefore);
  });

  it('propagates cancellation and still removes the temporary worktree', async () => {
    const root = await createRepository();
    await initExperiment(root, {
      name: 'runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      filesInScope: ['value.txt'],
    });
    await fs.writeFile(path.join(root, 'value.txt'), '120\n');
    const original = await runExperiment(root, 'regression');
    await fs.writeFile(
      path.join(root, '.auto', 'measure.sh'),
      '#!/bin/bash\nsleep 5\necho "METRIC total_ms=77"'
    );
    const worktreesBefore = await git(root, ['worktree', 'list', '--porcelain']);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    await expect(replayExperiment(root, original.attemptId!, {
      evaluator: 'current',
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });

    expect(await git(root, ['worktree', 'list', '--porcelain'])).toBe(worktreesBefore);
  });
});
