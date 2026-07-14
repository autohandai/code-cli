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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadLedgerEvents } from '../../src/autoresearch/ledger.js';
import { rescoreExperiments } from '../../src/autoresearch/analysis.js';
import { initExperiment, logExperiment, runExperiment } from '../../src/autoresearch/tools.js';
import { readConfigJson, readLogEntries } from '../../src/autoresearch/session.js';

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execFileAsync('git', args, { cwd, encoding: 'utf8' })).stdout;
}

async function createRepository(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-ledger-tools-'));
  roots.push(root);
  await git(root, ['init']);
  await git(root, ['config', 'user.email', 'tests@autohand.ai']);
  await git(root, ['config', 'user.name', 'Autohand Tests']);
  await fs.writeFile(path.join(root, 'value.txt'), '100\n');
  await git(root, ['add', 'value.txt']);
  await git(root, ['commit', '-m', 'baseline']);
  return root;
}

async function waitForPath(filePath: string, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fs.pathExists(filePath)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return fs.pathExists(filePath);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.remove(root)));
});

describe('ledger-backed autoresearch tools', { timeout: 120_000 }, () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await createRepository();
  });

  it('captures a three-sample zero-diff baseline during initialization', async () => {
    const initialized = await initExperiment(workspaceRoot, {
      name: 'runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      filesInScope: ['value.txt'],
    });

    expect(initialized).toMatchObject({ success: true, baselineAttemptId: expect.any(String) });
    const config = await readConfigJson(workspaceRoot);
    expect(config).toMatchObject({
      ledgerVersion: 1,
      baselineCommit: expect.stringMatching(/^[a-f0-9]{40}$/),
      materializedCommit: expect.stringMatching(/^[a-f0-9]{40}$/),
      sampling: { minSamples: 3, maxSamples: 9, confidenceThreshold: 2 },
    });

    const events = await loadLedgerEvents(workspaceRoot);
    expect(events.map((event) => event.type)).toEqual(['candidate', 'evaluation', 'decision']);
    const baselineEvaluation = events.find((event) => event.type === 'evaluation');
    expect(baselineEvaluation?.samples).toHaveLength(3);
    expect(baselineEvaluation?.aggregates.total_ms).toEqual({ median: 100, mad: 0, sampleCount: 3 });
  }, 120_000);

  it('rejects symlinked session storage without touching its external target', async () => {
    const external = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-external-storage-'));
    roots.push(external);
    await fs.ensureDir(path.join(external, 'ledger'));
    const sentinel = path.join(external, 'ledger', 'sentinel.txt');
    await fs.writeFile(sentinel, 'keep me\n');
    await fs.symlink(external, path.join(workspaceRoot, '.auto'));

    const initialized = await initExperiment(workspaceRoot, {
      name: 'unsafe storage',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\necho "METRIC total_ms=100"',
    });

    expect(initialized.success).toBe(false);
    expect(initialized.message).toMatch(/unsafe.*\.auto|symbolic link/i);
    expect(await fs.readFile(sentinel, 'utf8')).toBe('keep me\n');
    expect(await fs.pathExists(path.join(external, 'config.json'))).toBe(false);
  }, 120_000);

  it('captures and accepts a stable candidate, returning vectors, samples, and the engine decision', async () => {
    await initExperiment(workspaceRoot, {
      name: 'runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      filesInScope: ['value.txt'],
    });
    await fs.writeFile(path.join(workspaceRoot, 'value.txt'), '80\n');

    const result = await runExperiment(workspaceRoot, 'make it faster');

    expect(result).toMatchObject({
      success: true,
      attemptId: expect.any(String),
      metric: 80,
      metrics: { total_ms: 80 },
      decision: { outcome: 'accepted', materialized: true },
    });
    expect(result.samples).toHaveLength(3);
    expect(await fs.readFile(path.join(workspaceRoot, 'value.txt'), 'utf8')).toBe('80\n');
  }, 120_000);

  it('blocks another candidate until an accepted attempt advances the Git lineage', async () => {
    await initExperiment(workspaceRoot, {
      name: 'runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      filesInScope: ['value.txt'],
    });
    await fs.writeFile(path.join(workspaceRoot, 'value.txt'), '80\n');
    const accepted = await runExperiment(workspaceRoot, 'accepted but uncommitted');
    await fs.writeFile(path.join(workspaceRoot, 'value.txt'), '70\n');

    const blocked = await runExperiment(workspaceRoot, 'must not stack onto uncommitted winner');
    expect(blocked.success).toBe(false);
    expect(blocked.error).toMatch(/accepted attempt.*commit.*log_experiment/i);

    await fs.writeFile(path.join(workspaceRoot, 'value.txt'), '80\n');
    await execFileAsync('git', ['add', 'value.txt'], { cwd: workspaceRoot });
    await execFileAsync('git', ['commit', '-m', 'accepted candidate'], { cwd: workspaceRoot });
    const commit = (await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: workspaceRoot,
      encoding: 'utf8',
    })).stdout.trim();
    const logged = await logExperiment(workspaceRoot, {
      attemptId: accepted.attemptId,
      description: 'accepted candidate',
      commit,
    });
    expect(logged.success).toBe(true);
  }, 120_000);

  it('keeps rescored decisions from replacing the latest materialized reference', async () => {
    const initialized = await initExperiment(workspaceRoot, {
      name: 'runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      filesInScope: ['value.txt'],
    });
    await fs.writeFile(path.join(workspaceRoot, 'value.txt'), '80\n');
    const accepted = await runExperiment(workspaceRoot, 'first accepted candidate');
    await git(workspaceRoot, ['add', 'value.txt']);
    await git(workspaceRoot, ['commit', '-m', 'accept faster candidate']);
    const commit = (await git(workspaceRoot, ['rev-parse', 'HEAD'])).trim();
    await logExperiment(workspaceRoot, {
      attemptId: accepted.attemptId,
      description: 'first accepted candidate',
      commit,
    });
    await rescoreExperiments(workspaceRoot, { attemptId: initialized.baselineAttemptId });

    await fs.writeFile(path.join(workspaceRoot, 'value.txt'), '90\n');
    const next = await runExperiment(workspaceRoot, 'regresses from the materialized winner');

    expect(next.decision?.outcome).toBe('rejected');
    expect(next.decision?.primaryImprovement).toBe(-10);
    expect(await fs.readFile(path.join(workspaceRoot, 'value.txt'), 'utf8')).toBe('80\n');
  }, 120_000);

  it('requires an exact accepted commit before projecting the attempt', async () => {
    await initExperiment(workspaceRoot, {
      name: 'runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      filesInScope: ['value.txt'],
    });
    await fs.writeFile(path.join(workspaceRoot, 'value.txt'), '80\n');
    const accepted = await runExperiment(workspaceRoot, 'accepted candidate');

    const uncommitted = await logExperiment(workspaceRoot, {
      attemptId: accepted.attemptId,
      description: 'must be committed first',
    });
    expect(uncommitted.success).toBe(false);
    expect(uncommitted.error).toMatch(/accepted attempt.*commit/i);
    expect(await readLogEntries(workspaceRoot)).toEqual([]);

    await fs.writeFile(path.join(workspaceRoot, 'unexpected.txt'), 'not captured\n');
    await git(workspaceRoot, ['add', '.']);
    await git(workspaceRoot, ['commit', '-m', 'candidate plus unrelated file']);
    const commit = (await git(workspaceRoot, ['rev-parse', 'HEAD'])).trim();
    const mismatched = await logExperiment(workspaceRoot, {
      attemptId: accepted.attemptId,
      description: 'must match the captured tree',
      commit,
    });
    expect(mismatched.success).toBe(false);
    expect(mismatched.error).toMatch(/captured candidate|candidate tree/i);
    expect(await readLogEntries(workspaceRoot)).toEqual([]);
  }, 120_000);

  it('allows session metadata alongside the exact accepted candidate commit', async () => {
    await initExperiment(workspaceRoot, {
      name: 'runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      filesInScope: ['value.txt'],
    });
    await fs.writeFile(path.join(workspaceRoot, 'value.txt'), '80\n');
    const accepted = await runExperiment(workspaceRoot, 'accepted candidate');
    await git(workspaceRoot, ['add', 'value.txt', '.auto/config.json']);
    await git(workspaceRoot, ['commit', '-m', 'candidate with session metadata']);
    const commit = (await git(workspaceRoot, ['rev-parse', 'HEAD'])).trim();

    const logged = await logExperiment(workspaceRoot, {
      attemptId: accepted.attemptId,
      description: 'accepted candidate',
      commit,
    });

    expect(logged.success).toBe(true);
  }, 120_000);

  it('reverts a stable regression while retaining its immutable ledger records', async () => {
    await initExperiment(workspaceRoot, {
      name: 'runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      filesInScope: ['value.txt'],
    });
    await fs.writeFile(path.join(workspaceRoot, 'value.txt'), '120\n');

    const result = await runExperiment(workspaceRoot, 'make it slower');

    expect(result.decision?.outcome).toBe('rejected');
    expect(await fs.readFile(path.join(workspaceRoot, 'value.txt'), 'utf8')).toBe('100\n');
    const events = await loadLedgerEvents(workspaceRoot);
    expect(events.filter((event) => event.attemptId === result.attemptId).map((event) => event.type))
      .toEqual(['candidate', 'evaluation', 'decision']);
  }, 120_000);

  it('samples noisy overlap through the limit, records inconclusive, and reverts it', async () => {
    await initExperiment(workspaceRoot, {
      name: 'noisy runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: [
        '#!/bin/bash',
        'value=$(cat value.txt)',
        'if [ "$value" = "100" ]; then echo "METRIC total_ms=100"; exit 0; fi',
        'counter=.auto/noise-counter',
        'n=$(cat "$counter" 2>/dev/null || echo 0)',
        'n=$((n + 1))',
        'echo "$n" > "$counter"',
        'case $(((n - 1) % 3)) in 0) metric=98 ;; 1) metric=100 ;; *) metric=102 ;; esac',
        'echo "METRIC total_ms=$metric"',
      ].join('\n'),
      filesInScope: ['value.txt'],
    });
    await fs.writeFile(path.join(workspaceRoot, 'value.txt'), 'noisy\n');

    const result = await runExperiment(workspaceRoot, 'noisy overlap');

    expect(result.decision?.outcome).toBe('inconclusive');
    expect(result.samples).toHaveLength(9);
    expect(await fs.readFile(path.join(workspaceRoot, 'value.txt'), 'utf8')).toBe('100\n');
  }, 120_000);

  it('cancels during correctness checks and restores the captured candidate', async () => {
    await initExperiment(workspaceRoot, {
      name: 'cancellable checks',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      checksScript: [
        '#!/bin/bash',
        'if [ "$(cat value.txt)" = "80" ]; then',
        '  echo started > .auto/checks-started',
        '  sleep 5',
        'fi',
      ].join('\n'),
      filesInScope: ['value.txt'],
    });
    await fs.writeFile(path.join(workspaceRoot, 'value.txt'), '80\n');
    const controller = new AbortController();
    const running = runExperiment(workspaceRoot, 'cancel during checks', controller.signal);
    const marker = path.join(workspaceRoot, '.auto', 'checks-started');
    expect(await waitForPath(marker)).toBe(true);
    controller.abort();

    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(await fs.readFile(path.join(workspaceRoot, 'value.txt'), 'utf8')).toBe('100\n');
    const events = await loadLedgerEvents(workspaceRoot);
    const cancelled = events.find((event) =>
      event.type === 'evaluation' && event.execution.outcome === 'cancelled'
    );
    expect(cancelled).toBeDefined();
  }, 120_000);

  it('uses persisted decisions for ledger-backed log projection instead of model-supplied status', async () => {
    await initExperiment(workspaceRoot, {
      name: 'runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      filesInScope: ['value.txt'],
    });
    await fs.writeFile(path.join(workspaceRoot, 'value.txt'), '120\n');
    const run = await runExperiment(workspaceRoot, 'regression');

    const head = (await git(workspaceRoot, ['rev-parse', 'HEAD'])).trim();
    const logged = await logExperiment(workspaceRoot, {
      attemptId: run.attemptId,
      metric: 1,
      status: 'kept',
      description: 'model tried to override the engine',
      commit: head,
    });

    expect(logged.summary).toContain('discarded');
    const entries = await readLogEntries(workspaceRoot);
    expect(entries).toEqual([
      expect.objectContaining({
        attemptId: run.attemptId,
        status: 'discarded',
        metric: 120,
        decision: 'rejected',
        replayable: true,
      }),
    ]);
    expect(entries[0]).not.toHaveProperty('commit');
  }, 120_000);

  it('requires exactly one finite metric for every configured objective', async () => {
    const initialized = await initExperiment(workspaceRoot, {
      name: 'multi-objective',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      secondaryObjectives: [{ name: 'memory_mb', unit: 'MB', direction: 'lower' }],
      measureScript: '#!/bin/bash\necho "METRIC total_ms=100"\necho "METRIC total_ms=99"',
      filesInScope: ['value.txt'],
    });

    expect(initialized.success).toBe(false);
    expect(initialized.message).toMatch(/exactly one finite METRIC total_ms/i);
  }, 120_000);

  it('rejects secret-like environment allowlist names before persisting them', async () => {
    const initialized = await initExperiment(workspaceRoot, {
      name: 'safe environment',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\necho "METRIC total_ms=100"',
      environmentAllowlist: ['GITHUB_TOKEN'],
    });

    expect(initialized.success).toBe(false);
    expect(initialized.message).toMatch(/secret-like environment names/i);
    expect(await fs.pathExists(path.join(workspaceRoot, '.auto', 'ledger', 'events.jsonl'))).toBe(false);
  }, 120_000);
});
