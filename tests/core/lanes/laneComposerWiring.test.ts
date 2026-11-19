/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import type { FileActionManager } from '../../../src/actions/filesystem.js';
import { AutohandAgent } from '../../../src/core/agent.js';
import type { PendingAgentInstruction, QueuedAgentInstruction } from '../../../src/core/agent/PostTurnActionCoordinator.js';
import type { ToolManager } from '../../../src/core/toolManager.js';
import type { AgentRuntime, LLMProvider, ToolActionOutcome } from '../../../src/types.js';

interface AgentInternals {
  toolManager: ToolManager;
  delegator: { delegateTaskForTool: ReturnType<typeof vi.fn> };
  hookManager: { executeHooks: ReturnType<typeof vi.fn> };
  telemetryManager: { trackToolUse: ReturnType<typeof vi.fn> };
  pendingInkInstructions: PendingAgentInstruction[];
}

function createAgent(features: Record<string, unknown>, runtimeOverrides: Partial<AgentRuntime> = {}) {
  const llm = { generate: vi.fn(), generateStream: vi.fn(), getModel: vi.fn().mockReturnValue('test-model') } as unknown as LLMProvider;
  const files = { root: '/test/workspace', setTurnProvider: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() } as unknown as FileActionManager;
  const runtime = {
    config: {
      provider: 'openrouter', openrouter: { model: 'test-model' },
      permissions: { mode: 'unrestricted' }, ui: { useInkRenderer: false },
      features: { automaticSpecialists: false, ...features },
    },
    workspaceRoot: '/test/workspace', options: {}, ...runtimeOverrides,
  } as AgentRuntime;
  const internals = new AutohandAgent(llm, files, runtime) as unknown as AgentInternals;
  internals.hookManager.executeHooks = vi.fn().mockResolvedValue([]);
  internals.telemetryManager.trackToolUse = vi.fn().mockResolvedValue(undefined);
  return { internals, runtime };
}

const laneCall = {
  id: 'open-lane', tool: 'delegate_task' as const,
  args: { agent_name: 'implementer', task: 'Fix the highlight', lane_name: 'selection-highlight', lane_description: 'Fix invisible selection highlight' },
};

const advertisedLaneOption = (internals: AgentInternals) =>
  internals.toolManager.toFunctionDefinitions().find(tool => tool.name === 'delegate_task')?.parameters?.properties.lane_name;

describe('lanes in the agent runtime', () => {
  it('opens a lane without waiting for the delegated run, then queues its report for the lead', async () => {
    const { internals } = createAgent({ cliLanes: true });
    let finish: (outcome: ToolActionOutcome) => void = () => {};
    internals.delegator.delegateTaskForTool = vi.fn(() => new Promise<ToolActionOutcome>(resolve => { finish = resolve; }));

    expect(advertisedLaneOption(internals)).toBeDefined();
    const [result] = await internals.toolManager.execute([laneCall]);

    expect(result.success).toBe(true);
    expect(result.output).toContain('Lane "selection-highlight" is open and running in the background');
    expect(internals.delegator.delegateTaskForTool).toHaveBeenCalledOnce();
    const [agentName, task, options] = internals.delegator.delegateTaskForTool.mock.calls[0] as [string, string, { subagentId: string; signal?: AbortSignal }];
    expect([agentName, task]).toEqual(['implementer', 'Fix the highlight']);
    expect(options.subagentId).toMatch(/^subagent-/);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(internals.pendingInkInstructions).toEqual([]);

    finish({ success: true, output: 'Highlight fixed in src/ui/selection.ts', status: 'completed' });
    await vi.waitFor(() => expect(internals.pendingInkInstructions).toHaveLength(1));
    const report = internals.pendingInkInstructions[0] as QueuedAgentInstruction;
    expect(report.echoInTranscript).toBe(false);
    expect(report.text).toContain('Lane "selection-highlight" (Fix invisible selection highlight) completed');
    expect(report.text).toContain('Highlight fixed in src/ui/selection.ts');
  });

  it.each([
    ['the experiment is off', { cliLanes: false }, {}],
    ['the experiment is unset', {}, {}],
    ['the session is a protocol session', { cliLanes: true }, { isRpcMode: true }],
  ])('delegates synchronously and advertises no lane option when %s', async (_label, features, runtimeOverrides) => {
    const { internals } = createAgent(features, runtimeOverrides);
    internals.delegator.delegateTaskForTool = vi.fn().mockResolvedValue({ success: true, output: 'ran inline', status: 'completed' });

    expect(advertisedLaneOption(internals)).toBeUndefined();
    const [result] = await internals.toolManager.execute([laneCall]);

    expect(result.output).toBe('ran inline');
    expect(internals.delegator.delegateTaskForTool.mock.calls[0]?.[2]).not.toHaveProperty('subagentId');
    expect(internals.pendingInkInstructions).toEqual([]);
  });
});
