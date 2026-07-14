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
  compareExperiments,
  getAutoresearchHistory,
  getParetoExperiments,
  pinExperiment,
  pruneArtifacts,
  rescoreExperiments,
} from '../../src/autoresearch/analysis.js';
import { LedgerStore, createLedgerId, loadLedgerEvents } from '../../src/autoresearch/ledger.js';
import { appendLogEntry, readConfigJson, writeConfigJson } from '../../src/autoresearch/session.js';
import { initExperiment, logExperiment, runExperiment } from '../../src/autoresearch/tools.js';
import { exportDashboard } from '../../src/autoresearch/export.js';
import { finalizeSession } from '../../src/autoresearch/finalize.js';

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execFileAsync('git', args, { cwd, encoding: 'utf8' })).stdout;
}

async function createRepository(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-analysis-'));
  roots.push(root);
  await git(root, ['init']);
  await git(root, ['config', 'user.email', 'tests@autohand.ai']);
  await git(root, ['config', 'user.name', 'Autohand Tests']);
  await fs.writeFile(path.join(root, 'value.txt'), '100\n');
  await git(root, ['add', 'value.txt']);
  await git(root, ['commit', '-m', 'baseline']);
  return root;
}

async function createRejectedAttempt(root: string, value: number): Promise<string> {
  await fs.writeFile(path.join(root, 'value.txt'), `${value}\n`);
  const result = await runExperiment(root, `try ${value}`);
  expect(result.decision?.outcome).toBe('rejected');
  return result.attemptId!;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.remove(root)));
});

describe('autoresearch history and analysis', { timeout: 120_000 }, () => {
  it('marks legacy summary-only sessions as non-replayable', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-legacy-history-'));
    roots.push(root);
    await appendLogEntry(root, {
      run: 1,
      status: 'discarded',
      metric: 42,
      description: 'legacy attempt',
      timestamp: '2026-07-15T00:00:00.000Z',
    });

    const history = await getAutoresearchHistory(root);

    expect(history.attempts).toEqual([
      expect.objectContaining({ attemptId: 'legacy-run-1', replayable: false, legacy: true }),
    ]);
  });

  it('compares samples and aggregates, appends rescoring decisions, and preserves materialization', async () => {
    const root = await createRepository();
    const initialized = await initExperiment(root, {
      name: 'runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      filesInScope: ['value.txt'],
    });
    const rejectedId = await createRejectedAttempt(root, 120);

    const comparison = await compareExperiments(root, initialized.baselineAttemptId!, rejectedId);
    expect(comparison.left.aggregates.total_ms.median).toBe(100);
    expect(comparison.right.samples.map((sample) => sample.metrics.total_ms)).toEqual([120, 120, 120]);
    expect(comparison.right.decision?.outcome).toBe('rejected');

    const rescored = await rescoreExperiments(root, { attemptId: rejectedId });
    expect(rescored.decisions).toEqual([
      expect.objectContaining({ attemptId: rejectedId, source: 'rescore', outcome: 'rejected', materialized: false }),
    ]);
    const decisions = (await loadLedgerEvents(root)).filter((event) =>
      event.type === 'decision' && event.attemptId === rejectedId
    );
    expect(decisions).toHaveLength(2);
    expect(decisions[0]).toMatchObject({ source: 'original', materialized: false });
    expect(decisions[1]).toMatchObject({ source: 'rescore', materialized: false });
  });

  it('does not promote stored measurements that are below the current minimum sample policy', async () => {
    const root = await createRepository();
    await initExperiment(root, {
      name: 'runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      filesInScope: ['value.txt'],
    });
    const rejectedId = await createRejectedAttempt(root, 120);
    const config = await readConfigJson(root);
    await writeConfigJson(root, {
      ...config!,
      sampling: { minSamples: 5, maxSamples: 9, confidenceThreshold: 2 },
    });

    const rescored = await rescoreExperiments(root, { attemptId: rejectedId });

    expect(rescored.decisions[0]).toMatchObject({
      outcome: 'inconclusive',
      source: 'rescore',
      materialized: false,
    });
    expect(rescored.decisions[0].explanation).toMatch(/minimum.*5.*3 samples/i);
  });

  it('lists only non-dominated, constraint-passing candidates', async () => {
    const root = await createRepository();
    const initialized = await initExperiment(root, {
      name: 'runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      filesInScope: ['value.txt'],
    });
    await createRejectedAttempt(root, 120);

    const pareto = await getParetoExperiments(root);

    expect(pareto.attemptIds).toEqual([initialized.baselineAttemptId]);
  });

  it('excludes a baseline that violates the current hard constraints from Pareto results', async () => {
    const root = await createRepository();
    await initExperiment(root, {
      name: 'constrained runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      secondaryObjectives: [{ name: 'memory_mb', unit: 'MB', direction: 'lower' }],
      constraints: [{ metricName: 'memory_mb', operator: '<=', threshold: 50 }],
      measureScript: '#!/bin/bash\necho "METRIC total_ms=100"\necho "METRIC memory_mb=60"',
    });

    await expect(getParetoExperiments(root)).resolves.toEqual({ attemptIds: [] });
  });

  it('pins artifacts and prunes only eligible bulky objects after an explicit apply', async () => {
    const root = await createRepository();
    await initExperiment(root, {
      name: 'runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      filesInScope: ['value.txt'],
    });
    const pinnedId = await createRejectedAttempt(root, 120);
    const prunableId = await createRejectedAttempt(root, 130);
    await pinExperiment(root, pinnedId, true);
    const config = await readConfigJson(root);
    await writeConfigJson(root, { ...config!, retention: { maxArtifactBytes: 0 } });

    const preview = await pruneArtifacts(root, { dryRun: true, includeProtected: false });
    expect(preview.applied).toBe(false);
    expect(preview.candidates.map((candidate) => candidate.attemptId)).toContain(prunableId);
    expect(preview.candidates.map((candidate) => candidate.attemptId)).not.toContain(pinnedId);
    const store = new LedgerStore(root);
    const prunable = (await loadLedgerEvents(root)).find((event) =>
      event.type === 'candidate' && event.attemptId === prunableId
    );
    expect(prunable?.type).toBe('candidate');
    const patchObject = prunable?.type === 'candidate' ? prunable.patchObject : null;
    expect(patchObject && await fs.pathExists(store.objectPath(patchObject))).toBe(true);

    const applied = await pruneArtifacts(root, { dryRun: false, includeProtected: false });
    expect(applied.applied).toBe(true);
    expect(patchObject && await fs.pathExists(store.objectPath(patchObject))).toBe(false);
    expect((await loadLedgerEvents(root)).some((event) =>
      event.type === 'artifact_pruned' && event.attemptId === prunableId
    )).toBe(true);

    const history = await getAutoresearchHistory(root);
    expect(history.attempts.find((attempt) => attempt.attemptId === pinnedId)).toMatchObject({
      pinned: true,
      replayable: true,
    });
    expect(history.attempts.find((attempt) => attempt.attemptId === prunableId)).toMatchObject({
      replayable: false,
    });
  });

  it('can prune remaining candidate artifacts after an earlier output-only prune record', async () => {
    const root = await createRepository();
    await initExperiment(root, {
      name: 'runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      filesInScope: ['value.txt'],
    });
    const attemptId = await createRejectedAttempt(root, 120);
    const store = new LedgerStore(root);
    const events = await loadLedgerEvents(root);
    const evaluation = events.find((event) =>
      event.type === 'evaluation' && event.attemptId === attemptId
    );
    const candidate = events.find((event) =>
      event.type === 'candidate' && event.attemptId === attemptId
    );
    expect(evaluation?.type).toBe('evaluation');
    expect(candidate?.type).toBe('candidate');
    const outputObject = evaluation?.type === 'evaluation' ? evaluation.samples[0].outputObject : '';
    await fs.remove(store.objectPath(outputObject));
    await store.append({
      schemaVersion: 1,
      type: 'artifact_pruned',
      id: createLedgerId('event'),
      attemptId,
      timestamp: new Date().toISOString(),
      context: {},
      objects: [outputObject],
      bytesFreed: 0,
      reason: 'earlier output limit',
    });
    const config = await readConfigJson(root);
    await writeConfigJson(root, { ...config!, retention: { maxArtifactBytes: 0 } });

    const preview = await pruneArtifacts(root, { dryRun: true, includeProtected: false });

    expect(preview.candidates).toEqual([
      expect.objectContaining({
        attemptId,
        objects: expect.arrayContaining([candidate?.type === 'candidate' ? candidate.patchObject : '']),
      }),
    ]);
    expect(preview.candidates[0].objects.length).toBeGreaterThan(0);
  });

  it('never automatically selects accepted artifacts even when retention is over budget', async () => {
    const root = await createRepository();
    const initialized = await initExperiment(root, {
      name: 'runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\necho "METRIC total_ms=100"',
      retention: { maxArtifactBytes: 0 },
    });
    const config = await readConfigJson(root);
    await writeConfigJson(root, { ...config!, retention: { maxArtifactBytes: 0 } });

    const preview = await pruneArtifacts(root, { dryRun: true, includeProtected: false });

    expect(preview.candidates.map((candidate) => candidate.attemptId))
      .not.toContain(initialized.baselineAttemptId);
  });

  it('shows protected attempts in explicit previews when shared objects would affect them', async () => {
    const root = await createRepository();
    const initialized = await initExperiment(root, {
      name: 'runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      filesInScope: ['value.txt'],
    });
    await createRejectedAttempt(root, 120);
    const config = await readConfigJson(root);
    await writeConfigJson(root, { ...config!, retention: { maxArtifactBytes: 0 } });

    const preview = await pruneArtifacts(root, { dryRun: true, includeProtected: true });
    const baselineCandidate = (await loadLedgerEvents(root)).find((event) =>
      event.type === 'candidate' && event.attemptId === initialized.baselineAttemptId
    );

    expect(preview.candidates).toContainEqual(expect.objectContaining({
      attemptId: initialized.baselineAttemptId,
      protected: true,
      objects: expect.any(Array),
    }));
    expect(preview.candidates.find((candidate) =>
      candidate.attemptId === initialized.baselineAttemptId
    )?.objects).toContain(
      baselineCandidate?.type === 'candidate' ? baselineCandidate.evaluator.measureObject : ''
    );
  });

  it('renders full ledger history and advisory Pareto recommendations in dashboard and finalization output', async () => {
    const root = await createRepository();
    await initExperiment(root, {
      name: 'runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      filesInScope: ['value.txt'],
    });
    await fs.writeFile(path.join(root, 'value.txt'), '80\n');
    const accepted = await runExperiment(root, 'faster candidate');
    await git(root, ['add', 'value.txt']);
    await git(root, ['commit', '-m', 'retain faster candidate']);
    const commit = (await git(root, ['rev-parse', 'HEAD'])).trim();
    await logExperiment(root, {
      attemptId: accepted.attemptId,
      description: 'faster candidate',
      commit,
    });

    const dashboard = await exportDashboard(root);
    const html = await fs.readFile(dashboard.filePath!, 'utf8');
    expect(html).toContain('Full ledger history');
    expect(html).toContain(accepted.attemptId);
    expect(html).toContain('Pareto candidate');
    expect(html).toContain('Replay drift');
    expect(html).toContain('advisory');

    const finalized = await finalizeSession(root);
    const report = await fs.readFile(finalized.filePath!, 'utf8');
    expect(report).toContain('Ledger History');
    expect(report).toContain('Pareto Recommendations');
    expect(report).toContain(accepted.attemptId);
    expect(report).toContain('not automatically committed winners');
  });
});
