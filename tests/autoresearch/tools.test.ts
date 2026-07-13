/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';

import {
  initExperiment,
  runExperiment,
  logExperiment,
  MAX_LOG_OUTPUT_CHARS,
} from '../../src/autoresearch/tools.js';
import { AutoResearchManager } from '../../src/autoresearch/manager.js';
import { readConfigJson, readLogEntries, readMeasureSh, readPromptMd } from '../../src/autoresearch/session.js';

describe('autoresearch tools', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-tools-'));
  });

  it('init_experiment writes config, measure script, and prompt', async () => {
    const result = await initExperiment(workspaceRoot, {
      name: 'test-speed',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\necho "METRIC total_ms=42"',
      maxIterations: 20,
    });

    expect(result.success).toBe(true);

    const config = await readConfigJson(workspaceRoot);
    expect(config).toEqual({
      name: 'test-speed',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      maxIterations: 20,
      timeoutMs: 600000,
    });

    const measure = await readMeasureSh(workspaceRoot);
    expect(measure).toContain('METRIC total_ms=42');

    const prompt = await readPromptMd(workspaceRoot);
    expect(prompt?.metricName).toBe('total_ms');
  });

  it('init_experiment records requested subagent delegation phases', async () => {
    await initExperiment(workspaceRoot, {
      name: 'test-speed',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\necho "METRIC total_ms=42"',
      subagents: {
        ideaGeneration: true,
        measurementAnalysis: true,
        finalization: true,
      },
    });

    const config = await readConfigJson(workspaceRoot);
    expect(config?.subagents).toEqual({
      ideaGeneration: true,
      measurementAnalysis: true,
      finalization: true,
    });

    const prompt = await readPromptMd(workspaceRoot);
    expect(prompt?.subagentPlan).toEqual([
      'Use delegate_task or delegate_parallel for idea generation before selecting an experiment.',
      'Use delegate_task for measurement analysis when benchmark results are noisy or surprising.',
      'Use delegate_task during finalization to review kept runs and branch grouping recommendations.',
    ]);
  });

  it('init_experiment writes optional scope and checks script', async () => {
    await initExperiment(workspaceRoot, {
      name: 'test-speed',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\necho "METRIC total_ms=42"',
      filesInScope: ['src', 'tests'],
      checksScript: '#!/bin/bash\nbun run lint',
    });

    const prompt = await readPromptMd(workspaceRoot);
    expect(prompt?.filesInScope).toEqual(['src', 'tests']);
    expect(await fs.readFile(path.join(workspaceRoot, '.auto', 'checks.sh'), 'utf-8')).toContain('bun run lint');
  });

  it('run_experiment executes the benchmark and extracts the metric', async () => {
    await initExperiment(workspaceRoot, {
      name: 'test-speed',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\necho "METRIC total_ms=123"',
    });

    const result = await runExperiment(workspaceRoot, 'baseline run');

    expect(result.success).toBe(true);
    expect(result.metric).toBe(123);
    expect(result.output).toContain('METRIC total_ms=123');
  });

  it('run_experiment extracts signed and scientific notation metrics', async () => {
    await initExperiment(workspaceRoot, {
      name: 'score',
      metricName: 'delta_score',
      metricUnit: 'points',
      direction: 'higher',
      measureScript: '#!/bin/bash\necho "METRIC delta_score=-1.25e+3"',
    });

    const result = await runExperiment(workspaceRoot, 'score run');

    expect(result.success).toBe(true);
    expect(result.metric).toBe(-1250);
  });

  it('run_experiment fails gracefully when metric is missing', async () => {
    await initExperiment(workspaceRoot, {
      name: 'test-speed',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\necho "no metric here"',
    });

    const result = await runExperiment(workspaceRoot, 'bad run');

    expect(result.success).toBe(false);
    expect(result.error).toContain('METRIC total_ms');
  });

  it('run_experiment fails fast when the benchmark exceeds the configured timeout', async () => {
    await initExperiment(workspaceRoot, {
      name: 'test-speed',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\nsleep 1\necho "METRIC total_ms=123"',
      timeoutMs: 50,
    });

    const startedAt = Date.now();
    const result = await runExperiment(workspaceRoot, 'slow run');
    const durationMs = Date.now() - startedAt;

    expect(result.success).toBe(false);
    expect(result.error).toContain('Benchmark timed out after 50ms');
    expect(durationMs).toBeLessThan(900);
  });

  it('log_experiment appends an entry with an auto-incremented run number', async () => {
    await initExperiment(workspaceRoot, {
      name: 'test-speed',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\necho "METRIC total_ms=100"',
    });

    await logExperiment(workspaceRoot, {
      metric: 100,
      status: 'kept',
      description: 'baseline',
    });

    await logExperiment(workspaceRoot, {
      metric: 90,
      status: 'kept',
      description: 'improvement',
      hypothesis: 'faster loop',
      learned: 'loop unrolling helps',
    });

    const entries = await readLogEntries(workspaceRoot);
    expect(entries).toHaveLength(2);
    expect(entries[0].run).toBe(1);
    expect(entries[1].run).toBe(2);
    expect(entries[1].hypothesis).toBe('faster loop');
  });

  it('log_experiment advances the persisted session iteration count', async () => {
    await initExperiment(workspaceRoot, {
      name: 'test-speed',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\necho "METRIC total_ms=100"',
      maxIterations: 10,
    });
    const manager = new AutoResearchManager(workspaceRoot);
    await manager.start('optimize test runtime', 10);

    await logExperiment(workspaceRoot, {
      metric: 100,
      status: 'kept',
      description: 'baseline',
    });
    await logExperiment(workspaceRoot, {
      metric: 95,
      status: 'discarded',
      description: 'second run',
    });

    const state = await manager.getState();
    expect(state?.iteration).toBe(2);
    await expect(manager.getStatus()).resolves.toContain('Iterations: 2 / 10');
  });

  it('log_experiment records commit hashes and truncated output excerpts', async () => {
    await initExperiment(workspaceRoot, {
      name: 'test-speed',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\necho "METRIC total_ms=100"',
    });
    const output = `start\n${'x'.repeat(MAX_LOG_OUTPUT_CHARS + 1000)}\nend`;

    await logExperiment(workspaceRoot, {
      metric: 100,
      status: 'kept',
      description: 'baseline',
      commit: 'abc1234',
      output,
    });

    const entries = await readLogEntries(workspaceRoot);
    expect(entries[0].commit).toBe('abc1234');
    expect(entries[0].outputExcerpt).toContain('start');
    expect(entries[0].outputExcerpt).toContain('end');
    expect(entries[0].outputExcerpt).toContain('truncated');
    expect(entries[0].outputExcerpt?.length).toBeLessThanOrEqual(MAX_LOG_OUTPUT_CHARS);
  });

  it('log_experiment returns a stats summary', async () => {
    await initExperiment(workspaceRoot, {
      name: 'test-speed',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\necho "METRIC total_ms=100"',
    });

    const result = await logExperiment(workspaceRoot, {
      metric: 100,
      status: 'kept',
      description: 'baseline',
    });

    expect(result.success).toBe(true);
    expect(result.summary).toContain('baseline');
    expect(result.summary).toContain('100');
  });

  it('run_experiment reports backpressure check failures', async () => {
    await initExperiment(workspaceRoot, {
      name: 'test-speed',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\necho "METRIC total_ms=80"',
    });

    await fs.writeFile(
      path.join(workspaceRoot, '.auto', 'checks.sh'),
      '#!/bin/bash\necho "check failed" >&2\nexit 1',
      { mode: 0o755 }
    );

    const result = await runExperiment(workspaceRoot, 'with failing checks');

    expect(result.success).toBe(true);
    expect(result.metric).toBe(80);
    expect(result.checksFailed).toBe(true);
    expect(result.output).toContain('Backpressure checks failed');
  });

  it('run_experiment reports backpressure check success', async () => {
    await initExperiment(workspaceRoot, {
      name: 'test-speed',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\necho "METRIC total_ms=80"',
    });

    await fs.writeFile(
      path.join(workspaceRoot, '.auto', 'checks.sh'),
      '#!/bin/bash\necho "all good"',
      { mode: 0o755 }
    );

    const result = await runExperiment(workspaceRoot, 'with passing checks');

    expect(result.success).toBe(true);
    expect(result.metric).toBe(80);
    expect(result.checksFailed).toBeUndefined();
    expect(result.output).toContain('Backpressure checks passed');
  });

  it('run_experiment runs local before and after hooks around the benchmark', async () => {
    await initExperiment(workspaceRoot, {
      name: 'test-speed',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\necho measure >> hook-order.txt\necho "METRIC total_ms=80"',
    });

    const hooksDir = path.join(workspaceRoot, '.auto', 'hooks');
    await fs.ensureDir(hooksDir);
    await fs.writeFile(
      path.join(hooksDir, 'before.sh'),
      '#!/bin/bash\necho before >> hook-order.txt\necho "before hook ran"',
      { mode: 0o755 }
    );
    await fs.writeFile(
      path.join(hooksDir, 'after.sh'),
      '#!/bin/bash\necho after >> hook-order.txt\necho "after hook ran"',
      { mode: 0o755 }
    );

    const result = await runExperiment(workspaceRoot, 'with local hooks');

    expect(result.success).toBe(true);
    expect(result.metric).toBe(80);
    expect(result.output).toContain('Before hook output');
    expect(result.output).toContain('before hook ran');
    expect(result.output).toContain('After hook output');
    expect(result.output).toContain('after hook ran');

    const hookOrder = await fs.readFile(path.join(workspaceRoot, 'hook-order.txt'), 'utf-8');
    expect(hookOrder.trim().split('\n')).toEqual(['before', 'measure', 'after']);
  });
});
