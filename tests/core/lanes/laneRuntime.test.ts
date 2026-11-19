/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { AgentRunStore } from '../../../src/core/agents/AgentRunStore.js';
import type { PendingAgentInstruction, QueuedAgentInstruction } from '../../../src/core/agent/PostTurnActionCoordinator.js';
import type { Lane } from '../../../src/core/lanes/LaneManager.js';
import { areLanesAvailable, createLaneRuntime, type LaneRuntimeHost } from '../../../src/core/lanes/laneRuntime.js';
import { ToolManager } from '../../../src/core/toolManager.js';
import type { LoadedConfig, ToolActionOutcome } from '../../../src/types.js';

const config = (cliLanes?: boolean): LoadedConfig =>
  ({ configPath: '/fixture/config.json', features: cliLanes === undefined ? {} : { cliLanes } }) as LoadedConfig;

function harness(environment: { config: LoadedConfig; isCommandMode?: boolean; isRpcMode?: boolean }) {
  const settle: Array<(outcome: ToolActionOutcome) => void> = [];
  const delegateTaskForTool = vi.fn((_agentName: string, _task: string, _options?: { subagentId?: string; signal?: AbortSignal }) =>
    new Promise<ToolActionOutcome>(resolve => { settle.push(resolve); }));
  const lanes: Lane[][] = [];
  const notifications: string[] = [];
  const wake = vi.fn();
  const shutdown = new AbortController();
  const host: LaneRuntimeHost = {
    delegator: { delegateTaskForTool },
    agentRunStore: new AgentRunStore(),
    toolManager: new ToolManager({
      executor: async () => ({ success: true }), confirmApproval: vi.fn(),
    } as unknown as ConstructorParameters<typeof ToolManager>[0]),
    inkRenderer: { setLanes: value => { lanes.push(value); }, addNotification: message => { notifications.push(message); } },
    pendingInkInstructions: [] as PendingAgentInstruction[],
    inkInstructionResolver: wake,
    runtimeResourceShutdownController: shutdown,
  };
  const runtime = createLaneRuntime(host, environment);
  const laneOption = () => (host.toolManager as ToolManager).toFunctionDefinitions()
    .find(tool => tool.name === 'delegate_task')?.parameters?.properties.lane_name;
  return { runtime, host, settle, delegateTaskForTool, lanes, notifications, wake, shutdown, laneOption };
}

const request = { agent_name: 'implementer', task: 'Fix it', lane_name: 'fix-it', lane_description: 'Fix the thing' };

describe('areLanesAvailable', () => {
  it('needs the experiment on and an interactive session', () => {
    expect(areLanesAvailable({ config: config() })).toBe(false);
    expect(areLanesAvailable({ config: config(false) })).toBe(false);
    expect(areLanesAvailable({ config: config(true) })).toBe(true);
    expect(areLanesAvailable({ config: config(true), isCommandMode: true })).toBe(false);
    expect(areLanesAvailable({ config: config(true), isRpcMode: true })).toBe(false);
  });
});

describe('lane runtime', () => {
  it('changes nothing while the experiment is off', () => {
    const h = harness({ config: config() });
    expect(h.laneOption()).toBeUndefined();
    expect(h.runtime.accepts(request)).toBe(false);
    expect(h.lanes.flat()).toEqual([]);
    expect(h.delegateTaskForTool).not.toHaveBeenCalled();
  });

  it('keeps lanes out of one-shot command mode even with the experiment on', () => {
    const h = harness({ config: config(true), isCommandMode: true });
    expect(h.laneOption()).toBeUndefined();
    expect(h.runtime.accepts(request)).toBe(false);
  });

  it('advertises the lane option and follows a mid-session toggle in both directions', () => {
    const environment = { config: config(true) };
    const h = harness(environment);
    expect(h.laneOption()).toBeDefined();
    h.runtime.open(request);
    expect(h.lanes.at(-1)?.map(lane => lane.name)).toEqual(['fix-it']);

    environment.config.features = { cliLanes: false };
    h.runtime.sync();
    expect(h.laneOption()).toBeUndefined();
    expect(h.runtime.accepts(request)).toBe(false);
    expect(h.lanes.at(-1)).toEqual([]);

    environment.config.features = { cliLanes: true };
    h.runtime.sync();
    expect(h.laneOption()).toBeDefined();
    expect(h.lanes.at(-1)?.map(lane => lane.name)).toEqual(['fix-it']);
  });

  it('runs the lane through the delegator on the session signal under the lane id', () => {
    const h = harness({ config: config(true) });
    expect(h.runtime.open(request).success).toBe(true);
    expect(h.delegateTaskForTool).toHaveBeenCalledTimes(1);
    const [agentName, task, options] = h.delegateTaskForTool.mock.calls[0];
    expect([agentName, task]).toEqual(['implementer', 'Fix it']);
    expect(options?.signal).toBe(h.shutdown.signal);
    expect(options?.subagentId).toBe(h.lanes.at(-1)?.[0].id);
  });

  it('hands a finished lane back to the main conversation as a queued, unechoed turn and wakes the idle loop', async () => {
    const h = harness({ config: config(true) });
    h.runtime.open(request);
    h.settle[0]({ success: true, output: 'Patched src/a.ts', status: 'completed' });
    await vi.waitFor(() => expect(h.host.pendingInkInstructions).toHaveLength(1));

    const queued = h.host.pendingInkInstructions[0] as QueuedAgentInstruction;
    expect(queued.echoInTranscript).toBe(false);
    expect(queued.executionPolicy).toEqual({ environmentBootstrap: 'skip' });
    expect(queued.text).toContain('Lane "fix-it"');
    expect(queued.text).toContain('Patched src/a.ts');
    expect(h.wake).toHaveBeenCalledTimes(1);
    expect(h.host.inkInstructionResolver).toBeNull();
    expect(h.notifications).toEqual(['Lane fix-it completed.']);
    expect(h.lanes.at(-1)?.[0].status).toBe('completed');
  });

  it('reports a failed lane as failed', async () => {
    const h = harness({ config: config(true) });
    h.runtime.open(request);
    h.settle[0]({ success: false, kind: 'validation', error: "Agent 'implementer' not found." });
    await vi.waitFor(() => expect(h.host.pendingInkInstructions).toHaveLength(1));
    expect((h.host.pendingInkInstructions[0] as QueuedAgentInstruction).text).toContain("Agent 'implementer' not found.");
    expect(h.notifications).toEqual(['Lane fix-it failed.']);
  });

  it('queues nothing for lanes that end because the session is shutting down', async () => {
    const h = harness({ config: config(true) });
    h.runtime.open(request);
    h.shutdown.abort();
    h.settle[0]({ success: false, kind: 'aborted', error: 'aborted' });
    await vi.waitFor(() => expect(h.lanes.at(-1)?.[0].status).toBe('cancelled'));
    expect(h.host.pendingInkInstructions).toEqual([]);
    expect(h.notifications).toEqual([]);
    expect(h.wake).not.toHaveBeenCalled();
  });
});
