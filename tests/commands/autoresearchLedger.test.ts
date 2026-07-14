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
import { autoresearch, metadata } from '../../src/commands/autoresearch.js';
import { getAutoresearchHistory } from '../../src/autoresearch/analysis.js';
import { readConfigJson } from '../../src/autoresearch/session.js';
import { initExperiment, runExperiment } from '../../src/autoresearch/tools.js';
import { AutoResearchManager } from '../../src/autoresearch/manager.js';
import type { SlashCommandContext } from '../../src/core/slashCommandTypes.js';

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd, encoding: 'utf8' });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.remove(root)));
});

describe('/autoresearch replayable ledger commands', { timeout: 120_000 }, () => {
  let workspaceRoot: string;
  let ctx: SlashCommandContext;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-ledger-command-'));
    roots.push(workspaceRoot);
    await git(workspaceRoot, ['init']);
    await git(workspaceRoot, ['config', 'user.email', 'tests@autohand.ai']);
    await git(workspaceRoot, ['config', 'user.name', 'Autohand Tests']);
    await fs.writeFile(path.join(workspaceRoot, 'value.txt'), '100\n');
    await git(workspaceRoot, ['add', 'value.txt']);
    await git(workspaceRoot, ['commit', '-m', 'baseline']);
    ctx = { workspaceRoot, isNonInteractive: true } as SlashCommandContext;
  });

  it('registers the history, replay, rescore, compare, pareto, pin, unpin, and prune subcommands', () => {
    expect(metadata.subcommands?.map((subcommand) => subcommand.name)).toEqual(expect.arrayContaining([
      'history', 'replay', 'rescore', 'compare', 'pareto', 'pin', 'unpin', 'prune',
    ]));
  });

  it('parses additive objectives, constraints, sampling, retention, and safe environment flags', async () => {
    const result = await autoresearch(ctx, [
      'optimize', 'runtime',
      '--metric', 'total_ms', '--unit', 'ms', '--direction', 'lower',
      '--secondary-objective', 'memory_mb:MB:lower',
      '--constraint', 'memory_mb:<=:60',
      '--measure', 'echo "METRIC total_ms=100"; echo "METRIC memory_mb=50"',
      '--min-samples', '3', '--max-samples', '7', '--confidence', '2.5',
      '--max-artifact-bytes', '4096', '--max-artifact-age-days', '30',
      '--allow-env', 'CI', '--scope', 'value.txt',
    ]);

    expect(result).toContain('Initialized replayable benchmark config');
    expect(await readConfigJson(workspaceRoot)).toMatchObject({
      secondaryObjectives: [{ name: 'memory_mb', unit: 'MB', direction: 'lower' }],
      constraints: [{ metricName: 'memory_mb', operator: '<=', threshold: 60 }],
      sampling: { minSamples: 3, maxSamples: 7, confidenceThreshold: 2.5 },
      retention: { maxArtifactBytes: 4096, maxArtifactAgeDays: 30 },
      environmentAllowlist: ['CI'],
    });
  });

  it('renders history, compare, Pareto, replay, rescore, and pin state without changing the branch', async () => {
    const initialized = await initExperiment(workspaceRoot, {
      name: 'runtime', metricName: 'total_ms', metricUnit: 'ms', direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      filesInScope: ['value.txt'],
    });
    await fs.writeFile(path.join(workspaceRoot, 'value.txt'), '120\n');
    const candidate = await runExperiment(workspaceRoot, 'regression');
    const branchBefore = (await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: workspaceRoot, encoding: 'utf8',
    })).stdout.trim();

    expect(await autoresearch(ctx, ['history'])).toContain(candidate.attemptId);
    expect(await autoresearch(ctx, ['compare', initialized.baselineAttemptId!, candidate.attemptId!]))
      .toContain('total_ms');
    expect(await autoresearch(ctx, ['pareto'])).toContain(initialized.baselineAttemptId);
    expect(await autoresearch(ctx, ['replay', candidate.attemptId!, '--evaluator', 'original']))
      .toContain('replayed');
    expect(await autoresearch(ctx, ['rescore', candidate.attemptId!])).toContain('rescored');
    expect(await autoresearch(ctx, ['pin', candidate.attemptId!])).toContain('pinned');
    expect((await getAutoresearchHistory(workspaceRoot)).attempts
      .find((attempt) => attempt.attemptId === candidate.attemptId)).toMatchObject({ pinned: true });
    expect(await autoresearch(ctx, ['unpin', candidate.attemptId!])).toContain('unpinned');

    const branchAfter = (await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: workspaceRoot, encoding: 'utf8',
    })).stdout.trim();
    expect(branchAfter).toBe(branchBefore);
  });

  it('previews prune by default and applies only with --yes', async () => {
    await initExperiment(workspaceRoot, {
      name: 'runtime', metricName: 'total_ms', metricUnit: 'ms', direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      filesInScope: ['value.txt'],
    });
    await fs.writeFile(path.join(workspaceRoot, 'value.txt'), '120\n');
    await runExperiment(workspaceRoot, 'regression');
    const config = await readConfigJson(workspaceRoot);
    await fs.writeJson(path.join(workspaceRoot, '.auto', 'config.json'), {
      ...config,
      retention: { maxArtifactBytes: 0 },
    });

    const preview = await autoresearch(ctx, ['prune']);
    const applied = await autoresearch(ctx, ['prune', '--yes']);
    expect(preview).toContain('preview');
    expect(applied).toContain('pruned');
    expect(preview?.match(/(\d+) candidate/)?.[1]).toBe(applied?.match(/pruned (\d+) candidate/)?.[1]);
  });

  it('does not leave a resumable manager state when clean-baseline initialization fails', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'value.txt'), 'dirty\n');

    const result = await autoresearch(ctx, [
      'optimize', 'runtime',
      '--metric', 'total_ms', '--unit', 'ms', '--direction', 'lower',
      '--measure', 'echo "METRIC total_ms=100"',
    ]);

    expect(result).toContain('initialization failed');
    await expect(new AutoResearchManager(workspaceRoot).canResume()).resolves.toBe(false);
  });
});
