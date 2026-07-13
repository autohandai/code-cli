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
  getAutoResearchDir,
  ensureSessionDir,
  writePromptMd,
  readPromptMd,
  writeMeasureSh,
  readMeasureSh,
  writeConfigJson,
  readConfigJson,
  appendLogEntry,
  readLogEntries,
  clearSession,
  computeSessionStats,
  type PromptDocument,
  type SessionConfig,
  type ExperimentLogEntry,
} from '../../src/autoresearch/session.js';

describe('autoresearch session I/O', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-test-'));
  });

  it('resolves the session directory under .auto in the workspace', () => {
    expect(getAutoResearchDir(workspaceRoot)).toBe(path.join(workspaceRoot, '.auto'));
  });

  it('creates the .auto directory on demand', async () => {
    await ensureSessionDir(workspaceRoot);
    expect(await fs.pathExists(path.join(workspaceRoot, '.auto'))).toBe(true);
  });

  it('round-trips prompt.md as a structured document', async () => {
    const doc: PromptDocument = {
      goal: 'optimize unit test runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      filesInScope: ['vitest.config.ts', 'src/**/*.test.ts'],
      tried: ['parallelize tests'],
      deadEnds: ['increase workers caused flakiness'],
      wins: ['mock heavy database setup'],
      subagentPlan: [
        'delegate_task for idea generation',
        'delegate_parallel for measurement analysis',
      ],
    };

    await writePromptMd(workspaceRoot, doc);
    const loaded = await readPromptMd(workspaceRoot);

    expect(loaded).toEqual(doc);
  });

  it('returns null for prompt.md when the session does not exist', async () => {
    const loaded = await readPromptMd(workspaceRoot);
    expect(loaded).toBeNull();
  });

  it('round-trips measure.sh preserving shebang and content', async () => {
    const script = '#!/bin/bash\necho "METRIC total_ms=42"';
    await writeMeasureSh(workspaceRoot, script);
    expect(await readMeasureSh(workspaceRoot)).toBe(script);
  });

  it('round-trips config.json', async () => {
    const config: SessionConfig = {
      name: 'test-speed',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      maxIterations: 30,
    };

    await writeConfigJson(workspaceRoot, config);
    const loaded = await readConfigJson(workspaceRoot);
    expect(loaded).toEqual(config);
  });

  it('appends and reads experiment log entries', async () => {
    const entry1: ExperimentLogEntry = {
      run: 1,
      status: 'kept',
      metric: 42,
      description: 'baseline',
      commit: 'abc123',
      timestamp: new Date().toISOString(),
    };

    const entry2: ExperimentLogEntry = {
      run: 2,
      status: 'discarded',
      metric: 38,
      description: 'tried faster sorter',
      timestamp: new Date().toISOString(),
    };

    await appendLogEntry(workspaceRoot, entry1);
    await appendLogEntry(workspaceRoot, entry2);

    const entries = await readLogEntries(workspaceRoot);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual(entry1);
    expect(entries[1]).toEqual(entry2);
  });

  it('clears all session state except the directory itself', async () => {
    await writeConfigJson(workspaceRoot, { name: 'x', metricName: 'y', metricUnit: 'z', direction: 'lower' });
    await appendLogEntry(workspaceRoot, { run: 1, status: 'kept', metric: 1, description: 'x', timestamp: new Date().toISOString() });

    await clearSession(workspaceRoot);

    expect(await readConfigJson(workspaceRoot)).toBeNull();
    expect(await readLogEntries(workspaceRoot)).toEqual([]);
    expect(await fs.pathExists(getAutoResearchDir(workspaceRoot))).toBe(true);
  });

  describe('computeSessionStats', () => {
    it('reports baseline and best metric', () => {
      const entries: ExperimentLogEntry[] = [
        { run: 1, status: 'kept', metric: 100, description: 'baseline', timestamp: '' },
        { run: 2, status: 'kept', metric: 90, description: 'improvement', timestamp: '' },
      ];

      const stats = computeSessionStats(entries, 'lower');
      expect(stats.baselineMetric).toBe(100);
      expect(stats.bestMetric).toBe(90);
      expect(stats.bestRun).toBe(2);
    });

    it('computes confidence using MAD after three or more runs', () => {
      const entries: ExperimentLogEntry[] = [
        { run: 1, status: 'kept', metric: 100, description: 'baseline', timestamp: '' },
        { run: 2, status: 'kept', metric: 95, description: 'tweak', timestamp: '' },
        { run: 3, status: 'kept', metric: 80, description: 'win', timestamp: '' },
      ];

      const stats = computeSessionStats(entries, 'lower');
      expect(stats.confidence).toBeGreaterThan(0);
      expect(stats.mad).toBeGreaterThan(0);
      expect(stats.bestMetric).toBe(80);
    });

    it('returns undefined confidence with fewer than three entries', () => {
      const entries: ExperimentLogEntry[] = [
        { run: 1, status: 'kept', metric: 100, description: 'baseline', timestamp: '' },
        { run: 2, status: 'kept', metric: 90, description: 'improvement', timestamp: '' },
      ];

      const stats = computeSessionStats(entries, 'lower');
      expect(stats.confidence).toBeUndefined();
      expect(stats.mad).toBeUndefined();
    });

    it('prefers higher metric when direction is higher', () => {
      const entries: ExperimentLogEntry[] = [
        { run: 1, status: 'kept', metric: 10, description: 'baseline', timestamp: '' },
        { run: 2, status: 'kept', metric: 15, description: 'improvement', timestamp: '' },
      ];

      const stats = computeSessionStats(entries, 'higher');
      expect(stats.bestMetric).toBe(15);
      expect(stats.bestRun).toBe(2);
    });
  });
});
