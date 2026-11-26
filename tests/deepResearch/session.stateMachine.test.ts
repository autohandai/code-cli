/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEEP_RESEARCH_RUN_LIFECYCLE,
  DEEP_RESEARCH_STATUS_PATH,
  finalizeDeepResearchRun,
  markDeepResearchRunStarted,
  readDeepResearchRun,
  type DeepResearchRun,
  type DeepResearchRunStatus,
} from '../../src/deepResearch/session.js';
import { reachableStates, StateMachine, terminalStates } from '../../src/utils/stateMachine.js';
import { randomEventWalk } from '../helpers/stateMachineProperties.js';

const STATUSES: DeepResearchRunStatus[] = ['queued', 'running', 'incomplete', 'completed'];
const EVENTS = ['start', 'complete', 'block'] as const;

describe('deep research run lifecycle table', () => {
  it('declares every persisted status, reaches each from a new run, and ends only at completed', () => {
    expect(Object.keys(DEEP_RESEARCH_RUN_LIFECYCLE.transitions).sort()).toEqual([...STATUSES].sort());
    expect([...reachableStates(DEEP_RESEARCH_RUN_LIFECYCLE)].sort()).toEqual([...STATUSES].sort());
    expect(terminalStates(DEEP_RESEARCH_RUN_LIFECYCLE)).toEqual(['completed']);
  });

  it.each(['queued', 'running', 'incomplete'] as const)('lets a %s run start, complete or be blocked', (from) => {
    const machine = new StateMachine(DEEP_RESEARCH_RUN_LIFECYCLE, { initial: from });
    expect(EVENTS.every(event => machine.can(event))).toBe(true);
    expect(new StateMachine(DEEP_RESEARCH_RUN_LIFECYCLE, { initial: from }).send('complete')).toBe('completed');
    expect(new StateMachine(DEEP_RESEARCH_RUN_LIFECYCLE, { initial: from }).send('block')).toBe('incomplete');
    expect(new StateMachine(DEEP_RESEARCH_RUN_LIFECYCLE, { initial: from }).send('start')).toBe('running');
  });

  it.each(EVENTS)('rejects %s on a completed run', (event) => {
    const machine = new StateMachine(DEEP_RESEARCH_RUN_LIFECYCLE, { initial: 'completed' });
    expect(machine.trySend(event)).toBe(false);
    expect(machine.state).toBe('completed');
  });

  it('accepts exactly the table edges under random event sequences', () => {
    randomEventWalk(DEEP_RESEARCH_RUN_LIFECYCLE, EVENTS, { seeds: 50, steps: 40 });
  });
});

describe('deep research run persistence guards', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-deep-research-sm-'));
  });

  afterEach(async () => {
    await fs.remove(workspaceRoot);
  });

  async function writeRun(status: DeepResearchRunStatus): Promise<DeepResearchRun> {
    const run: DeepResearchRun = {
      id: `run-${status}`, topic: 'Topic', reportPath: '.autohand/research/topic.md', status,
      queuedAt: '2026-11-25T00:00:00.000Z', updatedAt: '2026-11-25T00:00:00.000Z', blockers: [],
      ...(status === 'completed' ? { completedAt: '2026-11-25T01:00:00.000Z' } : {}),
    };
    await fs.outputJson(path.join(workspaceRoot, DEEP_RESEARCH_STATUS_PATH), run);
    return run;
  }

  it.each(['queued', 'running', 'incomplete'] as const)('starts a %s run', async (status) => {
    const run = await writeRun(status);
    await expect(markDeepResearchRunStarted(workspaceRoot, run.id)).resolves.toMatchObject({ status: 'running' });
  });

  it.each(['queued', 'running', 'incomplete'] as const)('blocks a %s run whose turn failed', async (status) => {
    const run = await writeRun(status);
    const result = await finalizeDeepResearchRun({ workspaceRoot, runId: run.id, turnSucceeded: false, qualityPassed: true, finalResponse: '', messages: [] });
    expect(result.completed).toBe(false);
    await expect(readDeepResearchRun(workspaceRoot)).resolves.toMatchObject({ status: 'incomplete' });
  });

  it('leaves a completed run untouched by start and finalize', async () => {
    const run = await writeRun('completed');
    await expect(markDeepResearchRunStarted(workspaceRoot, run.id)).resolves.toBeNull();
    await expect(finalizeDeepResearchRun({ workspaceRoot, runId: run.id, turnSucceeded: false, qualityPassed: false, finalResponse: '', messages: [] }))
      .resolves.toEqual({ completed: true, blockers: [] });
    await expect(readDeepResearchRun(workspaceRoot)).resolves.toEqual(run);
  });

  it('ignores a run id that is not the current run', async () => {
    await writeRun('running');
    await expect(markDeepResearchRunStarted(workspaceRoot, 'other')).resolves.toBeNull();
    await expect(finalizeDeepResearchRun({ workspaceRoot, runId: 'other', turnSucceeded: true, qualityPassed: true, finalResponse: '', messages: [] }))
      .resolves.toEqual({ completed: false, blockers: ['The deep research run could not be found.'] });
  });
});
