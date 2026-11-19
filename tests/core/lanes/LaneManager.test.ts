/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { AgentRunStore } from '../../../src/core/agents/AgentRunStore.js';
import { MAX_ACTIVE_LANES, MAX_RETAINED_LANES } from '../../../src/core/lanes/feature.js';
import {
  LaneManager, formatLaneReport, toLaneName,
  type Lane, type LaneManagerOptions, type LaneTaskOptions,
} from '../../../src/core/lanes/LaneManager.js';
import type { ToolActionOutcome } from '../../../src/types.js';

interface PendingTask {
  agentName: string;
  task: string;
  options: LaneTaskOptions;
  settle: (outcome: ToolActionOutcome) => void;
  fail: (error: Error) => void;
}

function harness(overrides: Partial<LaneManagerOptions> = {}) {
  let clock = 1_000;
  let nextId = 0;
  let enabled = true;
  const tasks: PendingTask[] = [];
  const published: Lane[][] = [];
  const settled: Array<{ lane: Lane; outcome: ToolActionOutcome }> = [];
  const runs = new AgentRunStore({ now: () => clock });
  const manager = new LaneManager({
    isEnabled: () => enabled,
    runTask: (agentName, task, options) => new Promise<ToolActionOutcome>((resolve, reject) => {
      tasks.push({ agentName, task, options, settle: resolve, fail: reject });
    }),
    runs,
    onChange: lanes => { published.push(lanes); },
    onSettled: (lane, outcome) => { settled.push({ lane, outcome }); },
    now: () => clock,
    createId: () => `lane-run-${++nextId}`,
    ...overrides,
  });
  return {
    manager, tasks, published, settled, runs,
    advance: (ms: number) => { clock += ms; },
    setEnabled: (value: boolean) => { enabled = value; },
    latest: () => published.at(-1) ?? [],
  };
}

const request = (overrides: Record<string, unknown> = {}) => ({
  agent_name: 'implementer', task: 'Fix the invisible selection highlight',
  lane_name: 'selection-highlight', lane_description: 'Fix invisible selection highlight', ...overrides,
});

describe('toLaneName', () => {
  it.each([
    ['selection-highlight', 'selection-highlight'],
    ['  Fix The Usage Screen!  ', 'fix-the-usage-screen'],
    ['a__b//c', 'a-b-c'],
    ['---', ''],
    ['', ''],
  ])('normalizes %j to %j', (input, expected) => {
    expect(toLaneName(input)).toBe(expected);
  });

  it('bounds a long name without leaving a trailing separator', () => {
    const name = toLaneName(`${'word-'.repeat(20)}end`);
    expect(name.length).toBeLessThanOrEqual(32);
    expect(name.endsWith('-')).toBe(false);
  });
});

describe('LaneManager', () => {
  it('only accepts a delegation that names a lane while the experiment is on', () => {
    const h = harness();
    expect(h.manager.accepts(request())).toBe(true);
    expect(h.manager.accepts(request({ lane_name: undefined }))).toBe(false);
    expect(h.manager.accepts(request({ lane_name: '   ' }))).toBe(false);
    expect(h.manager.accepts(request({ lane_name: 42 }))).toBe(false);
    h.setEnabled(false);
    expect(h.manager.accepts(request())).toBe(false);
  });

  it('returns to the caller immediately and runs the task in the background', () => {
    const h = harness();
    const outcome = h.manager.open(request({ maxIterations: 7, research_only: true }));

    expect(outcome.success).toBe(true);
    expect(outcome.success && outcome.output).toContain('selection-highlight');
    expect(h.tasks).toHaveLength(1);
    expect(h.tasks[0].agentName).toBe('implementer');
    expect(h.tasks[0].task).toBe('Fix the invisible selection highlight');
    expect(h.tasks[0].options).toMatchObject({ subagentId: 'lane-run-1', maxIterations: 7, researchOnly: true });
    expect(h.latest()).toEqual([{
      id: 'lane-run-1', name: 'selection-highlight', description: 'Fix invisible selection highlight',
      agentName: 'implementer', status: 'running', startedAt: 1_000,
    }]);
    expect(h.settled).toEqual([]);
  });

  it('normalizes the lane name and falls back to the task for a missing description', () => {
    const h = harness();
    h.manager.open(request({ lane_name: 'Usage Screen', lane_description: undefined, task: 'Rebuild the usage screen\nwith more detail' }));
    expect(h.latest()[0]).toMatchObject({ name: 'usage-screen', description: 'Rebuild the usage screen' });
  });

  it('collapses a multi-line description into one bounded line', () => {
    const h = harness();
    h.manager.open(request({ lane_description: `first line\nsecond ${'x'.repeat(200)}` }));
    const { description } = h.latest()[0];
    expect(description).not.toContain('\n');
    expect(description.length).toBeLessThanOrEqual(80);
    expect(description.startsWith('first line second')).toBe(true);
  });

  it('rejects a lane without a usable name, agent or task', () => {
    const h = harness();
    for (const invalid of [request({ lane_name: '!!!' }), request({ agent_name: ' ' }), request({ task: '' })]) {
      const outcome = h.manager.open(invalid);
      expect(outcome.success).toBe(false);
      expect(!outcome.success && outcome.kind).toBe('validation');
    }
    expect(h.tasks).toEqual([]);
    expect(h.published).toEqual([]);
  });

  it('rejects a second running lane with the same name', () => {
    const h = harness();
    h.manager.open(request());
    const outcome = h.manager.open(request({ task: 'Something else' }));
    expect(!outcome.success && outcome.error).toContain('already running');
    expect(h.tasks).toHaveLength(1);
  });

  it('caps the number of lanes running at once and frees a slot when one settles', async () => {
    const h = harness();
    for (let index = 0; index < MAX_ACTIVE_LANES; index += 1) {
      expect(h.manager.open(request({ lane_name: `lane-${index}` })).success).toBe(true);
    }
    const refused = h.manager.open(request({ lane_name: 'one-too-many' }));
    expect(!refused.success && refused.kind).toBe('validation');
    expect(!refused.success && refused.error).toContain(String(MAX_ACTIVE_LANES));

    h.tasks[0].settle({ success: true, output: 'done' });
    await vi.waitFor(() => expect(h.settled).toHaveLength(1));
    expect(h.manager.open(request({ lane_name: 'one-too-many' })).success).toBe(true);
  });

  it('tracks token usage reported by the lane run', () => {
    const h = harness();
    h.manager.open(request());
    h.runs.start({ id: 'lane-run-1', source: 'delegate', name: 'implementer', task: 'Fix' });
    h.runs.start({ id: 'unrelated', source: 'delegate', name: 'reviewer', task: 'Review' });
    h.runs.progress('unrelated', { usage: { promptTokens: 9, completionTokens: 9, totalTokens: 18 } });
    expect(h.latest()[0].totalTokens).toBeUndefined();

    const publishedBefore = h.published.length;
    h.runs.progress('lane-run-1', { usage: { promptTokens: 100_000, completionTokens: 5_200, totalTokens: 105_200 } });
    expect(h.latest()[0].totalTokens).toBe(105_200);
    h.runs.progress('lane-run-1', { activity: 'read_file' });
    expect(h.published.length).toBe(publishedBefore + 1);
  });

  it.each<[string, ToolActionOutcome, Lane['status']]>([
    ['a finished run', { success: true, output: 'Fixed it', status: 'completed' }, 'completed'],
    ['a run that hit its iteration limit', { success: true, output: 'Half done', status: 'partial', reason: 'iteration_limit' }, 'partial'],
    ['a failed run', { success: false, kind: 'operational', error: 'boom' }, 'failed'],
    ['a cancelled run', { success: false, kind: 'aborted', error: 'aborted' }, 'cancelled'],
  ])('settles %s and reports it once', async (_label, outcome, status) => {
    const h = harness();
    h.manager.open(request());
    h.advance(126_000);
    h.tasks[0].settle(outcome);
    await vi.waitFor(() => expect(h.settled).toHaveLength(1));

    expect(h.latest()[0]).toMatchObject({ status, finishedAt: 127_000 });
    expect(h.settled[0].lane).toMatchObject({ name: 'selection-highlight', status });
    expect(h.settled[0].outcome).toEqual(outcome);
  });

  it('treats a rejected run as a failed lane instead of an unhandled rejection', async () => {
    const h = harness();
    h.manager.open(request());
    h.tasks[0].fail(new Error('provider unavailable'));
    await vi.waitFor(() => expect(h.settled).toHaveLength(1));
    expect(h.latest()[0].status).toBe('failed');
    expect(h.settled[0].outcome).toMatchObject({ success: false, error: 'provider unavailable' });
  });

  it('keeps finished lanes listed but evicts the oldest finished one past the retention bound', async () => {
    const h = harness();
    for (let index = 0; index < MAX_RETAINED_LANES + 2; index += 1) {
      h.manager.open(request({ lane_name: `lane-${index}` }));
      h.tasks[index].settle({ success: true, output: 'ok' });
      await vi.waitFor(() => expect(h.settled).toHaveLength(index + 1));
    }
    const names = h.latest().map(lane => lane.name);
    expect(names).toHaveLength(MAX_RETAINED_LANES);
    expect(names[0]).toBe('lane-2');
    expect(names.at(-1)).toBe(`lane-${MAX_RETAINED_LANES + 1}`);
  });

  it('replaces a finished lane when its name is reused', async () => {
    const h = harness();
    h.manager.open(request());
    h.tasks[0].settle({ success: true, output: 'ok' });
    await vi.waitFor(() => expect(h.settled).toHaveLength(1));
    expect(h.manager.open(request()).success).toBe(true);
    expect(h.latest().map(lane => [lane.id, lane.status])).toEqual([['lane-run-2', 'running']]);
  });

  it('publishes no lanes while the experiment is off, and restores them when it is turned back on', () => {
    const h = harness();
    h.manager.open(request());
    h.setEnabled(false);
    h.manager.refresh();
    expect(h.latest()).toEqual([]);
    h.setEnabled(true);
    h.manager.refresh();
    expect(h.latest().map(lane => lane.name)).toEqual(['selection-highlight']);
  });

  it('runs lanes on the session signal so they stop with the session, not with the turn', () => {
    const controller = new AbortController();
    const h = harness({ signal: controller.signal });
    h.manager.open(request());
    expect(h.tasks[0].options.signal).toBe(controller.signal);
  });
});

describe('formatLaneReport', () => {
  const lane: Lane = {
    id: 'lane-run-1', name: 'selection-highlight', description: 'Fix invisible selection highlight',
    agentName: 'implementer', status: 'completed', startedAt: 1_000, finishedAt: 127_000, totalTokens: 105_200,
  };

  it('hands the lead the lane identity, outcome and result', () => {
    const report = formatLaneReport(lane, { success: true, output: 'Changed src/a.ts; tests pass.' });
    expect(report).toContain('selection-highlight');
    expect(report).toContain('Fix invisible selection highlight');
    expect(report).toContain('completed');
    expect(report).toContain('2m 6s');
    expect(report).toContain('Changed src/a.ts; tests pass.');
  });

  it('reports the error of a failed lane and never claims success', () => {
    const report = formatLaneReport({ ...lane, status: 'failed' }, { success: false, kind: 'operational', error: 'Agent not found' });
    expect(report).toContain('failed');
    expect(report).toContain('Agent not found');
    expect(report).not.toContain('completed');
  });

  it('says so when a lane returned nothing', () => {
    expect(formatLaneReport(lane, { success: true })).toContain('no output');
  });

  it('bounds a very large result', () => {
    const report = formatLaneReport(lane, { success: true, output: 'x'.repeat(50_000) });
    expect(report.length).toBeLessThan(13_000);
    expect(report).toContain('truncated');
  });
});
