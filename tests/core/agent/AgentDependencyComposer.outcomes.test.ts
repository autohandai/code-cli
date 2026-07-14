/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutohandAgent } from '../../../src/core/agent.js';
import type { FileActionManager } from '../../../src/actions/filesystem.js';
import {
  EXIT_PLAN_MODE_TOOL_DEFINITION,
  type ToolManager,
} from '../../../src/core/toolManager.js';
import { CommunitySkillsCache } from '../../../src/skills/CommunitySkillsCache.js';
import { GitHubRegistryFetcher } from '../../../src/skills/GitHubRegistryFetcher.js';
import * as communityInstaller from '../../../src/skills/communityInstaller.js';
import { getPlanModeManager } from '../../../src/commands/plan.js';
import type {
  AgentAction,
  AgentOutputEvent,
  AgentRuntime,
  LLMProvider,
  ToolActionOutcome,
  ToolExecutionContext,
} from '../../../src/types.js';

interface AgentOutcomeInternals {
  conversation: {
    addSystemNote: ReturnType<typeof vi.fn>;
  };
  actionExecutor: {
    executeForTool(action: AgentAction, context?: ToolExecutionContext): Promise<ToolActionOutcome>;
  };
  hookManager: {
    executeHooks: ReturnType<typeof vi.fn>;
  };
  telemetryManager: {
    trackToolUse: ReturnType<typeof vi.fn>;
  };
  delegator: {
    delegateTask: ReturnType<typeof vi.fn>;
    delegateTaskForTool: ReturnType<typeof vi.fn>;
  };
  mcpManager: {
    callTool: ReturnType<typeof vi.fn>;
  };
  skillsRegistry: {
    activateSkill: ReturnType<typeof vi.fn>;
    deactivateSkill: ReturnType<typeof vi.fn>;
    findSimilar: ReturnType<typeof vi.fn>;
    getSkill: ReturnType<typeof vi.fn>;
    isSkillInstalled: ReturnType<typeof vi.fn>;
  };
  toolManager: ToolManager;
}

function createAgent(
  options: AgentRuntime['options'] = {},
): { agent: AutohandAgent; internals: AgentOutcomeInternals } {
  const llm = {
    generate: vi.fn(),
    generateStream: vi.fn(),
    getModel: vi.fn().mockReturnValue('test-model'),
  } as unknown as LLMProvider;
  const files = {
    root: '/test/workspace',
    readFile: vi.fn().mockResolvedValue('original contents'),
    writeFile: vi.fn(),
  } as unknown as FileActionManager;
  const runtime = {
    config: {
      provider: 'openrouter',
      openrouter: { model: 'test-model' },
      permissions: { mode: 'unrestricted' },
      ui: { useInkRenderer: false },
    },
    workspaceRoot: '/test/workspace',
    options,
  } as AgentRuntime;
  const agent = new AutohandAgent(llm, files, runtime);
  return {
    agent,
    internals: agent as unknown as AgentOutcomeInternals,
  };
}

describe('AgentDependencyComposer typed tool outcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPlanModeManager().restore({ enabled: false, plan: null, phase: 'planning' });
  });

  it('uses one typed failure for telemetry, post-tool hooks, output, and manager result', async () => {
    const { agent, internals } = createAgent();
    const failure: ToolActionOutcome = {
      success: false,
      kind: 'command',
      error: 'Command exited with code 7.',
      output: 'partial stdout',
      exitCode: 7,
    };
    internals.actionExecutor.executeForTool = vi.fn().mockResolvedValue(failure);
    internals.hookManager.executeHooks = vi.fn().mockResolvedValue([]);
    internals.telemetryManager.trackToolUse = vi.fn().mockResolvedValue(undefined);
    const outputListener = vi.fn<(event: AgentOutputEvent) => void>();
    agent.setOutputListener(outputListener);

    const [result] = await internals.toolManager.execute([{
      id: 'stable-tool-id',
      tool: 'read_file',
      args: { path: 'src/index.ts' },
    }]);

    expect(result).toEqual({ tool: 'read_file', ...failure });
    expect(internals.telemetryManager.trackToolUse).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'read_file',
      success: false,
      error: failure.error,
    }));
    expect(internals.hookManager.executeHooks).toHaveBeenCalledWith('post-tool', expect.objectContaining({
      tool: 'read_file',
      toolCallId: 'stable-tool-id',
      success: false,
      output: 'partial stdout',
    }));
    expect(outputListener).toHaveBeenCalledWith({
      type: 'tool_end',
      toolId: 'stable-tool-id',
      toolName: 'read_file',
      toolSuccess: false,
      toolOutput: 'partial stdout',
      toolError: failure.error,
    });
  });

  it('preserves a typed delegation failure without inspecting its display text', async () => {
    const { internals } = createAgent();
    internals.delegator.delegateTask = vi.fn().mockResolvedValue('legacy false-success string');
    internals.delegator.delegateTaskForTool = vi.fn().mockResolvedValue({
      success: false,
      kind: 'operational',
      error: 'Agent reviewer was not found.',
    });
    internals.hookManager.executeHooks = vi.fn().mockResolvedValue([]);
    internals.telemetryManager.trackToolUse = vi.fn().mockResolvedValue(undefined);

    const [result] = await internals.toolManager.execute([{
      id: 'delegate-failed',
      tool: 'delegate_task',
      args: { agent_name: 'reviewer', task: 'Review this change' },
    }]);

    expect(internals.delegator.delegateTaskForTool).toHaveBeenCalledWith(
      'reviewer',
      'Review this change',
    );
    expect(result).toEqual({
      tool: 'delegate_task',
      success: false,
      kind: 'operational',
      error: 'Agent reviewer was not found.',
    });
  });

  it('maps an MCP protocol error result to an operational failure', async () => {
    const { internals } = createAgent();
    internals.toolManager.register({
      name: 'mcp__filesystem__read' as AgentAction['type'],
      description: 'Read through MCP',
      parameters: { type: 'object', properties: {} },
    });
    internals.mcpManager.callTool = vi.fn().mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'MCP read failed' }],
    });
    internals.hookManager.executeHooks = vi.fn().mockResolvedValue([]);
    internals.telemetryManager.trackToolUse = vi.fn().mockResolvedValue(undefined);

    const [result] = await internals.toolManager.execute([{
      id: 'mcp-failed',
      tool: 'mcp__filesystem__read' as AgentAction['type'],
      args: {},
    }]);

    expect(result).toEqual({
      tool: 'mcp__filesystem__read',
      success: false,
      kind: 'operational',
      error: 'MCP read failed',
      output: JSON.stringify({
        isError: true,
        content: [{ type: 'text', text: 'MCP read failed' }],
      }),
    });
  });

  it('forwards the active signal through pre-tool and post-tool hooks', async () => {
    const { internals } = createAgent();
    const controller = new AbortController();
    internals.hookManager.executeHooks = vi.fn().mockResolvedValue([]);
    internals.telemetryManager.trackToolUse = vi.fn().mockResolvedValue(undefined);
    internals.actionExecutor.executeForTool = vi.fn().mockResolvedValue({
      success: true,
      output: 'contents',
    });

    await internals.toolManager.execute(
      [{ id: 'signal-hooks', tool: 'read_file', args: { path: 'README.md' } }],
      undefined,
      { signal: controller.signal },
    );

    expect(internals.hookManager.executeHooks).toHaveBeenCalledWith(
      'pre-tool',
      expect.objectContaining({ toolCallId: 'signal-hooks' }),
      { signal: controller.signal },
    );
    expect(internals.hookManager.executeHooks).toHaveBeenCalledWith(
      'post-tool',
      expect.objectContaining({ toolCallId: 'signal-hooks', success: true }),
      { signal: controller.signal },
    );
  });

  it('forwards the active signal to MCP and preserves its typed abort outcome', async () => {
    const { internals } = createAgent();
    const controller = new AbortController();
    internals.toolManager.register({
      name: 'mcp__filesystem__read' as AgentAction['type'],
      description: 'Read through MCP',
      parameters: { type: 'object', properties: {} },
    });
    internals.mcpManager.callTool = vi.fn().mockRejectedValue(
      Object.assign(new Error('MCP request aborted.'), { name: 'AbortError' }),
    );
    internals.hookManager.executeHooks = vi.fn().mockResolvedValue([]);
    internals.telemetryManager.trackToolUse = vi.fn().mockResolvedValue(undefined);

    const [result] = await internals.toolManager.execute(
      [{
        id: 'mcp-aborted',
        tool: 'mcp__filesystem__read' as AgentAction['type'],
        args: {},
      }],
      undefined,
      { signal: controller.signal },
    );

    expect(internals.mcpManager.callTool).toHaveBeenCalledWith(
      'filesystem',
      'read',
      expect.objectContaining({ type: 'mcp__filesystem__read' }),
      { signal: controller.signal },
    );
    expect(result).toEqual({
      tool: 'mcp__filesystem__read',
      success: false,
      kind: 'aborted',
      error: 'MCP request aborted.',
    });
  });

  it('reports exit_plan_mode validation errors as typed failures everywhere', async () => {
    getPlanModeManager().restore({ enabled: true, plan: null, phase: 'planning' });
    const { internals } = createAgent();
    internals.toolManager.register(EXIT_PLAN_MODE_TOOL_DEFINITION);
    internals.hookManager.executeHooks = vi.fn().mockResolvedValue([]);
    internals.telemetryManager.trackToolUse = vi.fn().mockResolvedValue(undefined);

    const [result] = await internals.toolManager.execute([{
      id: 'exit-plan-invalid',
      tool: 'exit_plan_mode',
      args: {},
    }]);

    expect(result).toEqual({
      tool: 'exit_plan_mode',
      success: false,
      kind: 'validation',
      error: 'No plan has been created yet. Call the `plan` tool first to create a plan before calling `exit_plan_mode`.',
    });
    expect(internals.telemetryManager.trackToolUse).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'exit_plan_mode',
      success: false,
      error: expect.stringContaining('No plan has been created'),
    }));
    expect(internals.hookManager.executeHooks).toHaveBeenCalledWith('post-tool', expect.objectContaining({
      tool: 'exit_plan_mode',
      success: false,
      output: expect.stringContaining('No plan has been created'),
    }));
    getPlanModeManager().restore({ enabled: false, plan: null, phase: 'planning' });
  });

  it('preserves a successful non-interactive plan acceptance as a typed success', async () => {
    getPlanModeManager().restore({
      enabled: true,
      phase: 'planning',
      plan: {
        id: 'typed-plan',
        rawText: '1. Validate the outcome',
        createdAt: Date.now(),
        steps: [{ number: 1, description: 'Validate the outcome', status: 'pending' }],
      },
    });
    const { internals } = createAgent({ yes: true });
    internals.toolManager.register(EXIT_PLAN_MODE_TOOL_DEFINITION);
    internals.conversation = { addSystemNote: vi.fn() };
    internals.hookManager.executeHooks = vi.fn().mockResolvedValue([]);
    internals.telemetryManager.trackToolUse = vi.fn().mockResolvedValue(undefined);

    const [result] = await internals.toolManager.execute([{
      id: 'exit-plan-success',
      tool: 'exit_plan_mode',
      args: {},
    }]);

    expect(result).toMatchObject({
      tool: 'exit_plan_mode',
      success: true,
      output: expect.stringContaining('Plan accepted with option: auto_accept'),
    });
    expect(internals.telemetryManager.trackToolUse).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'exit_plan_mode',
      success: true,
    }));
  });

  it('reports missing skills and failed activation as typed failures', async () => {
    const { internals } = createAgent();
    internals.hookManager.executeHooks = vi.fn().mockResolvedValue([]);
    internals.telemetryManager.trackToolUse = vi.fn().mockResolvedValue(undefined);
    internals.skillsRegistry.getSkill = vi.fn().mockReturnValue(undefined);
    internals.skillsRegistry.findSimilar = vi.fn().mockReturnValue([]);

    const [missing] = await internals.toolManager.execute([{
      id: 'skill-missing',
      tool: 'skill',
      args: { command: 'info', name: 'does-not-exist' },
    }]);

    expect(missing).toEqual({
      tool: 'skill',
      success: false,
      kind: 'validation',
      error: 'Skill "does-not-exist" not found.',
    });

    internals.skillsRegistry.getSkill = vi.fn().mockReturnValue({
      name: 'cannot-activate',
      description: 'Activation failure fixture',
      source: 'test',
      isActive: false,
    });
    internals.skillsRegistry.activateSkill = vi.fn().mockReturnValue(false);

    const [activation] = await internals.toolManager.execute([{
      id: 'skill-activation-failed',
      tool: 'skill',
      args: { command: 'activate', name: 'cannot-activate' },
    }]);

    expect(activation).toEqual({
      tool: 'skill',
      success: false,
      kind: 'operational',
      error: 'Failed to activate skill: cannot-activate',
    });
    expect(internals.telemetryManager.trackToolUse).toHaveBeenLastCalledWith(expect.objectContaining({
      tool: 'skill',
      success: false,
      error: 'Failed to activate skill: cannot-activate',
    }));

    internals.skillsRegistry.activateSkill = vi.fn().mockReturnValue(true);
    const [activated] = await internals.toolManager.execute([{
      id: 'skill-activation-succeeded',
      tool: 'skill',
      args: { command: 'activate', name: 'cannot-activate' },
    }]);

    expect(activated).toMatchObject({
      tool: 'skill',
      success: true,
      output: expect.stringContaining('Activated skill: cannot-activate'),
    });
  });

  it('activates an installed community skill by catalog ID while retaining its display name', async () => {
    const { internals } = createAgent();
    const skill = {
      id: 'display-skill-id',
      name: 'Display Skill',
      description: 'A display name distinct from its filesystem ID.',
      category: 'testing',
      directory: 'skills/display-skill-id',
      files: ['SKILL.md'],
    };
    vi.spyOn(CommunitySkillsCache.prototype, 'getRegistry').mockResolvedValue({
      version: '1.0.0',
      updatedAt: '2026-07-14T00:00:00.000Z',
      categories: [],
      skills: [skill],
    });
    vi.spyOn(GitHubRegistryFetcher.prototype, 'findSkill').mockReturnValue(skill);
    vi.spyOn(communityInstaller, 'installSkillWithSecurity').mockResolvedValue(
      'Installed skill: Display Skill'
    );
    internals.skillsRegistry.activateSkill = vi.fn().mockReturnValue(true);
    internals.skillsRegistry.isSkillInstalled = vi.fn().mockResolvedValue(true);
    internals.hookManager.executeHooks = vi.fn().mockResolvedValue([]);
    internals.telemetryManager.trackToolUse = vi.fn().mockResolvedValue(undefined);

    const [result] = await internals.toolManager.execute([{
      id: 'install-skill',
      tool: 'install_agent_skill',
      args: { name: 'Display Skill', activate: true },
    }]);

    expect(internals.skillsRegistry.activateSkill).toHaveBeenCalledWith('display-skill-id');
    expect(result).toMatchObject({
      success: true,
      output: expect.stringContaining('Activated skill: Display Skill'),
    });
    expect(internals.telemetryManager.trackToolUse).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'install_agent_skill',
      success: true,
    }));
  });
});
