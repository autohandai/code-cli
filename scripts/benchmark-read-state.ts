/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fse from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { FileActionManager } from '../src/actions/filesystem.js';
import { ActionExecutor } from '../src/core/actionExecutor.js';
import { SessionManager } from '../src/session/SessionManager.js';
import type { AgentRuntime, FeatureFlagSettings } from '../src/types.js';

const ITERATIONS = 100;
const ROUNDS = 5;
const FIXTURE_NAME = 'read-state-benchmark.txt';

interface BenchmarkSample {
  elapsedMs: number;
  outputBytes: number;
}

interface BenchmarkResult {
  medianElapsedMs: number;
  outputBytes: number;
  samples: BenchmarkSample[];
}

async function main(): Promise<void> {
  const benchmarkRoot = await fse.mkdtemp(path.join(os.tmpdir(), 'autohand-read-state-benchmark-'));
  const workspaceRoot = path.join(benchmarkRoot, 'workspace');
  await fse.ensureDir(workspaceRoot);
  await fse.writeFile(path.join(workspaceRoot, FIXTURE_NAME), createFixture());

  try {
    const legacySamples: BenchmarkSample[] = [];
    const dedupSamples: BenchmarkSample[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      const order = round % 2 === 0
        ? [legacySamples, dedupSamples] as const
        : [dedupSamples, legacySamples] as const;
      for (const samples of order) {
        const dedup = samples === dedupSamples;
        samples.push(await runSample(
          workspaceRoot,
          path.join(benchmarkRoot, `sessions-${round}-${dedup ? 'dedup' : 'legacy'}`),
          dedup ? { readStateDedup: true } : {},
        ));
      }
    }

    const legacy = summarize(legacySamples);
    const dedup = summarize(dedupSamples);
    const outputImprovementPercent = improvement(legacy.outputBytes, dedup.outputBytes);
    const elapsedImprovementPercent = improvement(legacy.medianElapsedMs, dedup.medianElapsedMs);
    const passed = outputImprovementPercent > 0 && elapsedImprovementPercent > 0;

    console.log(JSON.stringify({
      fixture: {
        lines: 1_000,
        bytes: 75_000,
        iterationsPerRound: ITERATIONS,
        rounds: ROUNDS,
      },
      legacy,
      dedup,
      improvement: {
        outputBytesPercent: round(outputImprovementPercent),
        medianElapsedPercent: round(elapsedImprovementPercent),
      },
      passed,
    }, null, 2));

    if (!passed) {
      process.exitCode = 1;
    }
  } finally {
    await fse.remove(benchmarkRoot);
  }
}

async function runSample(
  workspaceRoot: string,
  sessionsRoot: string,
  features: FeatureFlagSettings,
): Promise<BenchmarkSample> {
  const sessionManager = new SessionManager(sessionsRoot);
  await sessionManager.initialize();
  await sessionManager.createSession(workspaceRoot, 'benchmark-model');
  const executor = new ActionExecutor({
    runtime: {
      workspaceRoot,
      config: { features },
      options: {},
    } as AgentRuntime,
    files: new FileActionManager(workspaceRoot),
    resolveWorkspacePath: relativePath => path.resolve(workspaceRoot, relativePath),
    confirmDangerousAction: async () => true,
    readStateStore: {
      getCurrentSession: () => sessionManager.getCurrentSession(),
    },
  });
  const action = { type: 'read_file', path: FIXTURE_NAME } as const;
  const originalLog = console.log;
  let outputBytes = 0;

  console.log = () => {};
  try {
    await executor.executeForTool(action, { approvalHandled: true });
    const startedAt = performance.now();
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      const outcome = await executor.executeForTool(action, { approvalHandled: true });
      if (!outcome.success) {
        throw new Error(outcome.error);
      }
      outputBytes += Buffer.byteLength(outcome.output, 'utf8');
    }
    return {
      elapsedMs: performance.now() - startedAt,
      outputBytes,
    };
  } finally {
    console.log = originalLog;
  }
}

function summarize(samples: BenchmarkSample[]): BenchmarkResult {
  const outputBytes = samples[0]?.outputBytes ?? 0;
  if (!samples.every(sample => sample.outputBytes === outputBytes)) {
    throw new Error('Read-state benchmark produced inconsistent output volume across rounds.');
  }
  return {
    medianElapsedMs: round(median(samples.map(sample => sample.elapsedMs))),
    outputBytes,
    samples: samples.map(sample => ({
      elapsedMs: round(sample.elapsedMs),
      outputBytes: sample.outputBytes,
    })),
  };
}

function createFixture(): string {
  return Array.from({ length: 1_000 }, (_, index) => (
    `${String(index).padStart(4, '0')}:${'x'.repeat(69)}\n`
  )).join('');
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)] ?? 0;
}

function improvement(baseline: number, candidate: number): number {
  return baseline === 0 ? 0 : ((baseline - candidate) / baseline) * 100;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

await main();
