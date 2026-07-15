/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_TOOL_DEFINITIONS,
  GOAL_TOOL_DEFINITIONS,
  PLAN_TOOL_DEFINITION,
  ToolManager,
  type ToolDefinition,
  type ToolManagerOptions,
} from '../src/core/toolManager.js';
import { PermissionManager } from '../src/permissions/PermissionManager.js';
import type { HookExecutionResult } from '../src/core/HookManager.js';

const noopDefinitions = [
  { name: 'read_file', description: 'read file' },
  { name: 'delete_path', description: 'delete file', requiresApproval: true }
] as const;

/** Helper: create a delayed executor that optionally tracks in-flight count */
function createDelayedExecutor(delayMs: number, tracker?: { current: number; max: number }) {
  return async () => {
    if (tracker) {
      tracker.current++;
      tracker.max = Math.max(tracker.max, tracker.current);
    }
    await new Promise(r => setTimeout(r, delayMs));
    if (tracker) {
      tracker.current--;
    }
    return { success: true as const, output: 'ok' };
  };
}

function successfulOutcome(output?: string) {
  return output === undefined
    ? { success: true as const }
    : { success: true as const, output };
}

function hookResult(overrides: Partial<HookExecutionResult> = {}): HookExecutionResult {
  return {
    hook: { event: 'pre-tool', command: 'true' },
    success: true,
    duration: 1,
    ...overrides,
  };
}

function defaultToolDefinition(name: ToolDefinition['name']): ToolDefinition {
  const definition = DEFAULT_TOOL_DEFINITIONS.find(candidate => candidate.name === name);
  if (!definition) {
    throw new Error(`Missing default tool definition for ${name}`);
  }
  return definition;
}

describe('ToolManager', () => {
  it('exposes delegation, team coordination, and tool discovery tools by default', () => {
    const names = new Set(DEFAULT_TOOL_DEFINITIONS.map((tool) => tool.name));

    expect(names.has('tool_search')).toBe(true);
    expect(names.has('notebook_edit')).toBe(true);
    expect(names.has('delegate_task')).toBe(true);
    expect(names.has('delegate_parallel')).toBe(true);
    expect(names.has('create_team')).toBe(true);
    expect(names.has('add_teammate')).toBe(true);
    expect(names.has('create_task')).toBe(true);
    expect(names.has('task_get')).toBe(true);
    expect(names.has('task_list')).toBe(true);
    expect(names.has('task_update')).toBe(true);
    expect(names.has('task_stop')).toBe(true);
    expect(names.has('task_output')).toBe(true);
    expect(names.has('team_status')).toBe(true);
    expect(names.has('send_team_message')).toBe(true);
  });

  it('does NOT include plan tool in DEFAULT_TOOL_DEFINITIONS', () => {
    const names = new Set(DEFAULT_TOOL_DEFINITIONS.map((tool) => tool.name));
    expect(names.has('plan')).toBe(false);
  });

  it('keeps goal tools out of DEFAULT_TOOL_DEFINITIONS until slash_goal is enabled by the runtime', () => {
    const defaultNames = new Set(DEFAULT_TOOL_DEFINITIONS.map((tool) => tool.name));
    const goalNames = new Set(GOAL_TOOL_DEFINITIONS.map((tool) => tool.name));

    expect(goalNames.has('create_goal')).toBe(true);
    expect(defaultNames.has('create_goal')).toBe(false);
    expect(defaultNames.has('get_goal')).toBe(false);
  });

  it('exposes fff search tools instead of deprecated find and glob by default', () => {
    const names = new Set(DEFAULT_TOOL_DEFINITIONS.map((tool) => tool.name));

    expect(names.has('fff_grep')).toBe(true);
    expect(names.has('fff_find')).toBe(true);
    expect(names.has('find')).toBe(false);
    expect(names.has('glob')).toBe(false);
  });

  it('does not expose legacy multi_file_edit by default', () => {
    const names = new Set(DEFAULT_TOOL_DEFINITIONS.map((tool) => tool.name));

    expect(names.has('apply_patch')).toBe(true);
    expect(names.has('multi_file_edit')).toBe(false);
  });

  it('exports PLAN_TOOL_DEFINITION as standalone constant', () => {
    expect(PLAN_TOOL_DEFINITION).toBeDefined();
    expect(PLAN_TOOL_DEFINITION.name).toBe('plan');
    expect(PLAN_TOOL_DEFINITION.description).toContain('structured implementation plan');
    expect(PLAN_TOOL_DEFINITION.parameters).toBeDefined();
    expect(PLAN_TOOL_DEFINITION.parameters?.properties).toHaveProperty('notes');
  });

  it('executes tool calls via the provided executor', async () => {
    const executor = vi.fn().mockResolvedValue(successfulOutcome('file contents'));
    const confirm = vi.fn().mockResolvedValue(true);
    const manager = new ToolManager({ executor, confirmApproval: confirm, definitions: noopDefinitions as any });

    const results = await manager.execute([{ tool: 'read_file', args: { path: 'src/index.ts' } }]);

    expect(executor).toHaveBeenCalledWith(
      { type: 'read_file', path: 'src/index.ts' },
      expect.objectContaining({ tool: 'read_file' })
    );
    expect(results[0]).toMatchObject({ tool: 'read_file', success: true, output: 'file contents' });
  });

  it('preserves a resolved typed failure and completes it exactly once', async () => {
    const executor = vi.fn().mockResolvedValue({
      success: false,
      kind: 'command',
      error: 'Command exited with code 23.',
      output: 'partial stdout',
      exitCode: 23,
    });
    const onToolComplete = vi.fn();
    const manager = new ToolManager({
      executor,
      confirmApproval: vi.fn().mockResolvedValue(true),
      definitions: noopDefinitions as unknown as ToolDefinition[],
    });

    const results = await manager.execute(
      [{ id: 'typed-failure', tool: 'read_file', args: { path: 'src/index.ts' } }],
      onToolComplete,
    );

    expect(results).toEqual([{
      tool: 'read_file',
      success: false,
      kind: 'command',
      error: 'Command exited with code 23.',
      output: 'partial stdout',
      exitCode: 23,
    }]);
    expect(onToolComplete).toHaveBeenCalledTimes(1);
    expect(onToolComplete).toHaveBeenCalledWith(0, results[0]);
  });

  it('keeps a typed success with empty output successful', async () => {
    const manager = new ToolManager({
      executor: vi.fn().mockResolvedValue({ success: true }),
      confirmApproval: vi.fn().mockResolvedValue(true),
      definitions: noopDefinitions as unknown as ToolDefinition[],
    });

    const [result] = await manager.execute([
      { id: 'empty-success', tool: 'read_file', args: { path: 'src/empty.ts' } },
    ]);

    expect(result).toEqual({ tool: 'read_file', success: true });
  });

  it('rejects invalid required arguments as validation before authorization or execution', async () => {
    const executor = vi.fn();
    const permissionManager = new PermissionManager({ mode: 'unrestricted' });
    const manager = new ToolManager({
      executor,
      confirmApproval: vi.fn().mockResolvedValue(true),
      definitions: [defaultToolDefinition('run_command')],
      authorization: { permissionManager },
    });

    const [result] = await manager.execute([{
      id: 'missing-command',
      tool: 'run_command',
      args: {},
    }]);

    expect(result).toMatchObject({
      success: false,
      kind: 'validation',
      error: expect.stringContaining('missing required field'),
    });
    expect(executor).not.toHaveBeenCalled();
  });

  it('rejects model-emitted schema keys as unavailable tools before execution', async () => {
    const executor = vi.fn().mockResolvedValue('should not run');
    const confirm = vi.fn().mockResolvedValue(true);
    const manager = new ToolManager({ executor, confirmApproval: confirm, definitions: noopDefinitions as any });

    const results = await manager.execute([
      { tool: 'toolCalls' as any, args: {} },
      { tool: 'finalResponse' as any, args: {} },
    ]);

    expect(executor).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(results).toEqual([
      expect.objectContaining({
        tool: 'toolCalls',
        success: false,
        error: expect.stringContaining("Tool 'toolCalls' is not available"),
      }),
      expect.objectContaining({
        tool: 'finalResponse',
        success: false,
        error: expect.stringContaining("Tool 'finalResponse' is not available"),
      }),
    ]);
  });

  it('enforces approval for dangerous tools', async () => {
    const executor = vi.fn();
    const confirm = vi.fn().mockResolvedValue(false);
    const manager = new ToolManager({ executor, confirmApproval: confirm, definitions: noopDefinitions as any });

    const results = await manager.execute([{ tool: 'delete_path', args: { path: 'dist' } }]);

    expect(confirm).toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ tool: 'delete_path', success: false });
  });

  describe('canonical authorization preflight', () => {
    it.each([
      ['--yes', 'interactive'],
      ['YOLO', 'interactive'],
      ['unrestricted mode', 'unrestricted'],
      ['RPC confirmation', 'interactive'],
      ['ACP full-access', 'interactive'],
    ] as const)('blocks immutable-blacklist commands before %s approval', async (_name, mode) => {
      const permissionManager = new PermissionManager({ mode });
      const executor = vi.fn().mockResolvedValue('should not run');
      const confirmApproval = vi.fn().mockResolvedValue({ decision: 'allow_once' });
      const manager = new ToolManager({
        executor,
        confirmApproval,
        definitions: [{ name: 'run_command', description: 'run', requiresApproval: true }],
        authorization: { permissionManager },
      });

      const [result] = await manager.execute([
        { id: 'blocked-command', tool: 'run_command', args: { command: 'printenv' } },
      ]);

      expect(result).toMatchObject({ tool: 'run_command', success: false });
      expect(executor).not.toHaveBeenCalled();
      expect(confirmApproval).not.toHaveBeenCalled();
    });

    it.each([
      ['write_file', { path: '.env', contents: 'secret' }],
      ['append_file', { path: '.env', contents: 'secret' }],
      ['apply_patch', { path: '.env', patch: 'secret' }],
      ['notebook_edit', { path: '.env', edit_mode: 'delete' }],
      ['search_replace', { path: '.env', blocks: 'secret' }],
      ['format_file', { path: '.env', formatter: 'prettier' }],
      ['multi_file_edit', { file_path: '.env', edits: [] }],
    ] as const)('blocks immutable sensitive paths for the %s write capability', async (tool, args) => {
      const executor = vi.fn().mockResolvedValue(successfulOutcome('should not run'));
      const confirmApproval = vi.fn().mockResolvedValue({ decision: 'allow_once' });
      const definition = tool === 'multi_file_edit'
        ? {
            name: tool,
            description: 'edit multiple ranges',
            parameters: {
              type: 'object' as const,
              properties: {
                file_path: { type: 'string', description: 'file path' },
                edits: { type: 'array', description: 'edits' },
              },
              required: ['file_path', 'edits'],
            },
          }
        : defaultToolDefinition(tool);
      const manager = new ToolManager({
        executor,
        confirmApproval,
        definitions: [definition],
        authorization: { permissionManager: new PermissionManager({ mode: 'unrestricted' }) },
      });

      const [result] = await manager.execute([{ tool, args }]);

      expect(result).toMatchObject({ tool, success: false, kind: 'authorization' });
      expect(executor).not.toHaveBeenCalled();
      expect(confirmApproval).not.toHaveBeenCalled();
    });

    it.each(['rename_path', 'copy_path'] as const)(
      'reauthorizes the %s destination as a write capability',
      async (tool) => {
        const executor = vi.fn().mockResolvedValue(successfulOutcome('should not run'));
        const confirmApproval = vi.fn().mockResolvedValue({ decision: 'allow_once' });
        const manager = new ToolManager({
          executor,
          confirmApproval,
          definitions: [defaultToolDefinition(tool)],
          authorization: { permissionManager: new PermissionManager({ mode: 'unrestricted' }) },
        });

        const [result] = await manager.execute([
          { tool, args: { from: 'safe.txt', to: '.env' } },
        ]);

        expect(result).toMatchObject({ tool, success: false, kind: 'authorization' });
        expect(executor).not.toHaveBeenCalled();
        expect(confirmApproval).not.toHaveBeenCalled();
      },
    );

    it('authorizes custom commands as the effective run_command capability', async () => {
      const executor = vi.fn().mockResolvedValue(successfulOutcome('should not run'));
      const confirmApproval = vi.fn().mockResolvedValue({ decision: 'allow_once' });
      const manager = new ToolManager({
        executor,
        confirmApproval,
        definitions: [defaultToolDefinition('custom_command')],
        authorization: { permissionManager: new PermissionManager({ mode: 'unrestricted' }) },
      });

      const [result] = await manager.execute([
        { tool: 'custom_command', args: { name: 'secrets', command: 'printenv' } },
      ]);

      expect(result).toMatchObject({ tool: 'custom_command', success: false, kind: 'authorization' });
      expect(executor).not.toHaveBeenCalled();
      expect(confirmApproval).not.toHaveBeenCalled();
    });

    it.each([
      ['code_review', { scope: 'file', path: '.env' }],
      ['git_diff', { path: '.env' }],
      ['git_checkout', { path: '.env' }],
      ['fff_grep', { query: 'SECRET', path: '.env' }],
      ['find', { query: 'SECRET', path: '.env' }],
      ['checksum', { path: '.env' }],
    ] as const)('applies sensitive-file policy to the %s adapter', async (tool, args) => {
      const executor = vi.fn().mockResolvedValue(successfulOutcome('should not run'));
      const definition = tool === 'find'
        ? {
            name: tool,
            description: 'legacy content search',
            parameters: {
              type: 'object' as const,
              properties: {
                query: { type: 'string', description: 'query' },
                path: { type: 'string', description: 'path' },
              },
              required: ['query'],
            },
          }
        : defaultToolDefinition(tool);
      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue({ decision: 'allow_once' }),
        definitions: [definition],
        authorization: { permissionManager: new PermissionManager({ mode: 'unrestricted' }) },
      });

      const [result] = await manager.execute([{ tool, args }]);

      expect(result).toMatchObject({ tool, success: false, kind: 'authorization' });
      expect(executor).not.toHaveBeenCalled();
    });

    it('applies command policy to worktree parallel execution', async () => {
      const executor = vi.fn().mockResolvedValue(successfulOutcome('should not run'));
      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue({ decision: 'allow_once' }),
        definitions: [defaultToolDefinition('git_worktree_run_parallel')],
        authorization: { permissionManager: new PermissionManager({ mode: 'unrestricted' }) },
      });

      const [result] = await manager.execute([{
        tool: 'git_worktree_run_parallel',
        args: { command: 'printenv' },
      }]);

      expect(result).toMatchObject({
        tool: 'git_worktree_run_parallel',
        success: false,
        kind: 'authorization',
      });
      expect(executor).not.toHaveBeenCalled();
    });

    it.each(['add_dependency', 'remove_dependency'] as const)(
      'applies package-manifest write policy to %s',
      async (tool) => {
        const executor = vi.fn().mockResolvedValue(successfulOutcome('should not run'));
        const manager = new ToolManager({
          executor,
          confirmApproval: vi.fn().mockResolvedValue({ decision: 'allow_once' }),
          definitions: [defaultToolDefinition(tool)],
          authorization: {
            permissionManager: new PermissionManager({
              mode: 'unrestricted',
              denyPatterns: [{ kind: 'write_file', argument: 'package.json' }],
            }),
          },
        });

        const [result] = await manager.execute([{
          tool,
          args: { name: 'blocked-package', version: '1.0.0' },
        }]);

        expect(result).toMatchObject({ tool, success: false, kind: 'authorization' });
        expect(executor).not.toHaveBeenCalled();
      },
    );

    it('keeps the requested write tool visible to hooks after capability normalization', async () => {
      const permissionManager = new PermissionManager({ mode: 'interactive' });
      const checkPermission = vi.spyOn(permissionManager, 'checkPermission');
      const runPreToolHooks = vi.fn().mockResolvedValue([hookResult({ response: { decision: 'allow' } })]);
      const executor = vi.fn().mockResolvedValue(successfulOutcome('updated'));
      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn(),
        definitions: [defaultToolDefinition('append_file')],
        authorization: { permissionManager, runPreToolHooks },
      });

      const [result] = await manager.execute([
        { id: 'append-call', tool: 'append_file', args: { path: 'notes.txt', contents: 'next' } },
      ]);

      expect(result.success).toBe(true);
      expect(checkPermission).toHaveBeenCalledWith(
        expect.objectContaining({ tool: 'write_file', path: 'notes.txt' }),
      );
      expect(runPreToolHooks).toHaveBeenCalledWith(
        expect.objectContaining({ tool: 'append_file', toolCallId: 'append-call', path: 'notes.txt' }),
      );
    });

    it('builds permission contexts for every file, command, and meta-tool family', async () => {
      const permissionManager = new PermissionManager({ mode: 'interactive' });
      const checkPermission = vi.spyOn(permissionManager, 'checkPermission');
      const executor = vi.fn().mockResolvedValue(successfulOutcome('ok'));
      const definitions: ToolDefinition[] = [
        { name: 'write_file', description: 'write_file', requiresApproval: false },
        { name: 'append_file', description: 'append_file', requiresApproval: false },
        { name: 'apply_patch', description: 'apply_patch', requiresApproval: false },
        { name: 'notebook_edit', description: 'notebook_edit', requiresApproval: false },
        { name: 'delete_path', description: 'delete_path', requiresApproval: false },
        { name: 'read_file', description: 'read_file', requiresApproval: false },
        { name: 'multi_file_edit', description: 'multi_file_edit', requiresApproval: false },
        { name: 'run_command', description: 'run_command', requiresApproval: false },
        { name: 'shell', description: 'shell', requiresApproval: false },
        { name: 'tools_registry', description: 'meta', requiresApproval: false },
      ];
      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue({ decision: 'allow_once' }),
        definitions,
        authorization: {
          permissionManager,
          resolvePermissionContext: (action) => action.type === 'tools_registry'
            ? { tool: 'run_command', command: 'printf', args: ['safe'] }
            : undefined,
        },
      });

      await manager.execute([
        { tool: 'write_file', args: { path: 'existing.ts', contents: 'next' } },
        { tool: 'append_file', args: { path: 'append.ts', contents: 'next' } },
        { tool: 'apply_patch', args: { path: 'patch.ts', patch: 'diff' } },
        { tool: 'notebook_edit', args: { path: 'book.ipynb', edit_mode: 'delete' } },
        { tool: 'delete_path', args: { path: 'old.txt' } },
        { tool: 'read_file', args: { path: 'read.txt' } },
        { tool: 'multi_file_edit', args: { file_path: 'multi.ts', edits: [] } },
        { tool: 'run_command', args: { command: 'printf', args: ['safe'] } },
        { tool: 'shell', args: { command: 'echo', args: ['safe'] } },
        { tool: 'tools_registry', args: {} },
      ]);

      expect(checkPermission.mock.calls.map(([context]) => context)).toEqual([
        expect.objectContaining({ tool: 'write_file', path: 'existing.ts' }),
        expect.objectContaining({ tool: 'write_file', path: 'append.ts' }),
        expect.objectContaining({ tool: 'write_file', path: 'patch.ts' }),
        expect.objectContaining({ tool: 'write_file', path: 'book.ipynb' }),
        expect.objectContaining({ tool: 'write_file', path: 'old.txt' }),
        expect.objectContaining({ tool: 'read_file', path: 'read.txt' }),
        expect.objectContaining({ tool: 'write_file', path: 'multi.ts' }),
        expect.objectContaining({ tool: 'run_command', command: 'printf', args: ['safe'] }),
        expect.objectContaining({ tool: 'shell', command: 'echo', args: ['safe'] }),
        expect.objectContaining({ tool: 'run_command', command: 'printf', args: ['safe'] }),
      ]);
      expect(executor).toHaveBeenCalledTimes(10);
    });

    it('requires delete authorization only when autoresearch pruning will be applied', async () => {
      const permissionManager = new PermissionManager({ mode: 'interactive' });
      const checkPermission = vi.spyOn(permissionManager, 'checkPermission');
      const executor = vi.fn().mockResolvedValue(successfulOutcome('ok'));
      const confirmApproval = vi.fn().mockResolvedValue({ decision: 'allow_once' });
      const manager = new ToolManager({
        executor,
        confirmApproval,
        definitions: [{ name: 'analyze_experiments', description: 'analyze experiments' }],
        authorization: { permissionManager },
      });

      const results = await manager.execute([
        { tool: 'analyze_experiments', args: { operation: 'history' } },
        { tool: 'analyze_experiments', args: { operation: 'prune', yes: false } },
        { tool: 'analyze_experiments', args: { operation: 'prune', yes: true, dryRun: true } },
        { tool: 'analyze_experiments', args: { operation: 'prune', yes: true } },
      ]);

      expect(results.every((result) => result.success)).toBe(true);
      expect(checkPermission.mock.calls.map(([context]) => context.tool)).toEqual([
        'analyze_experiments',
        'analyze_experiments',
        'analyze_experiments',
        'delete_path',
      ]);
      expect(confirmApproval).toHaveBeenCalledTimes(1);
      expect(executor).toHaveBeenCalledTimes(4);
    });

    it('does not prompt or execute after an explicit pattern denial', async () => {
      const permissionManager = new PermissionManager({
        mode: 'interactive',
        denyPatterns: [{ kind: 'write_file', argument: 'blocked.ts' }],
      });
      const executor = vi.fn().mockResolvedValue('should not run');
      const confirmApproval = vi.fn().mockResolvedValue({ decision: 'allow_once' });
      const manager = new ToolManager({
        executor,
        confirmApproval,
        definitions: [{ name: 'write_file', description: 'write', requiresApproval: true }],
        authorization: { permissionManager },
      });

      const [result] = await manager.execute([
        { tool: 'write_file', args: { path: 'blocked.ts', contents: 'nope' } },
      ]);

      expect(result.success).toBe(false);
      expect(confirmApproval).not.toHaveBeenCalled();
      expect(executor).not.toHaveBeenCalled();
    });

    it('keeps safe default-policy tools prompt-free', async () => {
      const permissionManager = new PermissionManager({ mode: 'interactive' });
      const executor = vi.fn().mockResolvedValue(successfulOutcome('contents'));
      const confirmApproval = vi.fn();
      const manager = new ToolManager({
        executor,
        confirmApproval,
        definitions: [{ name: 'read_file', description: 'read', requiresApproval: false }],
        authorization: { permissionManager },
      });

      const [result] = await manager.execute([
        { tool: 'read_file', args: { path: 'README.md' } },
      ]);

      expect(result.success).toBe(true);
      expect(confirmApproval).not.toHaveBeenCalled();
      expect(executor).toHaveBeenCalledOnce();
    });

    it('prompts for a default-policy mutation even when its legacy definition omits approval', async () => {
      const confirmApproval = vi.fn().mockResolvedValue({ decision: 'allow_once' });
      const executor = vi.fn().mockResolvedValue(successfulOutcome('updated'));
      const manager = new ToolManager({
        executor,
        confirmApproval,
        definitions: [{ name: 'append_file', description: 'append', requiresApproval: false }],
        authorization: { permissionManager: new PermissionManager({ mode: 'interactive' }) },
      });

      const [result] = await manager.execute([
        { tool: 'append_file', args: { path: 'notes.txt', contents: 'next' } },
      ]);

      expect(result.success).toBe(true);
      expect(confirmApproval).toHaveBeenCalledOnce();
      expect(executor).toHaveBeenCalledOnce();
    });

    it('fails closed when policy evaluation throws', async () => {
      const permissionManager = new PermissionManager({ mode: 'interactive' });
      vi.spyOn(permissionManager, 'checkPermission').mockImplementation(() => {
        throw new Error('policy unavailable');
      });
      const executor = vi.fn().mockResolvedValue('should not run');
      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn(),
        definitions: [{ name: 'read_file', description: 'read' }],
        authorization: { permissionManager },
      });

      const [result] = await manager.execute([{ tool: 'read_file', args: { path: 'README.md' } }]);

      expect(result).toMatchObject({ success: false, error: expect.stringContaining('policy unavailable') });
      expect(executor).not.toHaveBeenCalled();
    });

    it('fails closed when policy evaluation returns an unknown reason', async () => {
      const permissionManager = new PermissionManager({ mode: 'interactive' });
      vi.spyOn(permissionManager, 'checkPermission').mockReturnValue({
        allowed: true,
        reason: 'future_policy_reason',
      } as unknown as ReturnType<PermissionManager['checkPermission']>);
      const executor = vi.fn().mockResolvedValue('should not run');
      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn(),
        definitions: [{ name: 'read_file', description: 'read' }],
        authorization: { permissionManager },
      });

      const [result] = await manager.execute([{ tool: 'read_file', args: { path: 'README.md' } }]);

      expect(result.success).toBe(false);
      expect(executor).not.toHaveBeenCalled();
    });

    it.each([
      ['exit code 2', hookResult({ success: false, exitCode: 2, blockingError: true, error: 'blocked' })],
      ['deny', hookResult({ response: { decision: 'deny', reason: 'denied' } })],
      ['block', hookResult({ response: { decision: 'block', reason: 'blocked' } })],
      ['continue false', hookResult({ response: { continue: false, stopReason: 'stop now' } })],
      ['unknown decision', hookResult({
        response: { decision: 'later' } as unknown as HookExecutionResult['response'],
      })],
      ['malformed response', hookResult({
        response: null as unknown as HookExecutionResult['response'],
      })],
      ['malformed JSON output', hookResult({ stdout: '{not-json' })],
    ])('honors pre-tool hook %s before execution', async (_name, result) => {
      const executor = vi.fn().mockResolvedValue('should not run');
      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue({ decision: 'allow_once' }),
        definitions: [{ name: 'read_file', description: 'read' }],
        authorization: {
          permissionManager: new PermissionManager({ mode: 'interactive' }),
          runPreToolHooks: vi.fn().mockResolvedValue([result]),
        },
      });

      const [executionResult] = await manager.execute([
        { tool: 'read_file', args: { path: 'README.md' } },
      ]);

      expect(executionResult.success).toBe(false);
      expect(executor).not.toHaveBeenCalled();
    });

    it('fails closed when pre-tool hook execution throws', async () => {
      const executor = vi.fn().mockResolvedValue('should not run');
      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn(),
        definitions: [{ name: 'read_file', description: 'read' }],
        authorization: {
          permissionManager: new PermissionManager({ mode: 'interactive' }),
          runPreToolHooks: vi.fn().mockRejectedValue(new Error('hook unavailable')),
        },
      });

      const [result] = await manager.execute([{ tool: 'read_file', args: { path: 'README.md' } }]);

      expect(result).toMatchObject({ success: false, error: expect.stringContaining('hook unavailable') });
      expect(executor).not.toHaveBeenCalled();
    });

    it('lets a pre-tool ask decision invoke and persist the existing confirmation result', async () => {
      const permissionManager = new PermissionManager({ mode: 'interactive' });
      const applyPromptDecision = vi.spyOn(permissionManager, 'applyPromptDecision');
      const confirmApproval = vi.fn().mockResolvedValue({ decision: 'allow_session' });
      const executor = vi.fn().mockResolvedValue(successfulOutcome('ok'));
      const manager = new ToolManager({
        executor,
        confirmApproval,
        definitions: [{ name: 'read_file', description: 'read' }],
        authorization: {
          permissionManager,
          runPreToolHooks: vi.fn().mockResolvedValue([
            hookResult({ response: { decision: 'ask' } }),
          ]),
        },
      });

      const [result] = await manager.execute([{ tool: 'read_file', args: { path: 'README.md' } }]);

      expect(result.success).toBe(true);
      expect(confirmApproval).toHaveBeenCalledOnce();
      expect(applyPromptDecision).toHaveBeenCalledWith(
        expect.objectContaining({ tool: 'read_file', path: 'README.md' }),
        { decision: 'allow_session' },
      );
    });

    it('reauthorizes hook-updated input and blocks a newly blacklisted command', async () => {
      const permissionManager = new PermissionManager({ mode: 'interactive' });
      const checkPermission = vi.spyOn(permissionManager, 'checkPermission');
      const executor = vi.fn().mockResolvedValue('should not run');
      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue({ decision: 'allow_once' }),
        definitions: [defaultToolDefinition('run_command')],
        authorization: {
          permissionManager,
          runPreToolHooks: vi.fn().mockResolvedValue([
            hookResult({ response: { updatedInput: { command: 'printenv' } } }),
          ]),
        },
      });

      const [result] = await manager.execute([
        { tool: 'run_command', args: { command: 'echo', args: ['safe'] } },
      ]);

      expect(result.success).toBe(false);
      expect(checkPermission).toHaveBeenCalledTimes(2);
      expect(executor).not.toHaveBeenCalled();
    });

    it('passes valid hook-updated input to the executor with the original tool type', async () => {
      const executor = vi.fn().mockResolvedValue(successfulOutcome('ok'));
      const confirmApproval = vi.fn().mockResolvedValue({ decision: 'allow_once' });
      const manager = new ToolManager({
        executor,
        confirmApproval,
        definitions: [defaultToolDefinition('run_command')],
        authorization: {
          permissionManager: new PermissionManager({ mode: 'interactive' }),
          runPreToolHooks: vi.fn().mockResolvedValue([
            hookResult({ response: { decision: 'allow', updatedInput: { command: 'echo updated', args: [] } } }),
          ]),
        },
      });

      const [result] = await manager.execute([
        { tool: 'run_command', args: { command: 'echo original' } },
      ]);

      expect(result.success).toBe(true);
      expect(executor).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'run_command', command: 'echo updated' }),
        expect.objectContaining({ approvalHandled: true }),
      );
      expect(confirmApproval).not.toHaveBeenCalled();
    });

    it('fails closed when hook-updated input attempts to change the tool type', async () => {
      const executor = vi.fn().mockResolvedValue('should not run');
      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn(),
        definitions: [defaultToolDefinition('run_command')],
        authorization: {
          permissionManager: new PermissionManager({ mode: 'interactive' }),
          runPreToolHooks: vi.fn().mockResolvedValue([
            hookResult({ response: { updatedInput: { type: 'write_file', command: 'echo' } } }),
          ]),
        },
      });

      const [result] = await manager.execute([{ tool: 'run_command', args: { command: 'echo' } }]);

      expect(result.success).toBe(false);
      expect(executor).not.toHaveBeenCalled();
    });

    it('preserves the requested tool type when original arguments contain a type field', async () => {
      const executor = vi.fn().mockResolvedValue(successfulOutcome('contents'));
      const confirmApproval = vi.fn();
      const manager = new ToolManager({
        executor,
        confirmApproval,
        definitions: [{ name: 'read_file', description: 'read' }],
        authorization: { permissionManager: new PermissionManager({ mode: 'interactive' }) },
      });

      const [result] = await manager.execute([
        { tool: 'read_file', args: { path: 'README.md', type: 'delete_path' } },
      ]);

      expect(result.success).toBe(true);
      expect(confirmApproval).not.toHaveBeenCalled();
      expect(executor).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'read_file', path: 'README.md' }),
        expect.objectContaining({ approvalHandled: true }),
      );
    });

    it('fails closed when hook-updated input introduces an unsupported field', async () => {
      const executor = vi.fn().mockResolvedValue('should not run');
      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn(),
        definitions: [defaultToolDefinition('read_file')],
        authorization: {
          permissionManager: new PermissionManager({ mode: 'interactive' }),
          runPreToolHooks: vi.fn().mockResolvedValue([
            hookResult({ response: { updatedInput: { unexpected: true } } }),
          ]),
        },
      });

      const [result] = await manager.execute([
        { tool: 'read_file', args: { path: 'README.md' } },
      ]);

      expect(result.success).toBe(false);
      expect(executor).not.toHaveBeenCalled();
    });

    it('routes additional hook context and preserves one stable tool-call ID', async () => {
      const runPreToolHooks = vi.fn().mockResolvedValue([
        hookResult({ response: { additionalContext: 'Treat this file as generated.' } }),
      ]);
      const onAdditionalContext = vi.fn();
      const lifecycle: Array<{ event: 'start' | 'end'; toolCallId?: string }> = [];
      const executor = vi.fn<ToolManagerOptions['executor']>(async (_action, context) => {
        lifecycle.push({ event: 'start', toolCallId: context?.toolCallId });
        lifecycle.push({ event: 'end', toolCallId: context?.toolCallId });
        return successfulOutcome('ok');
      });
      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn(),
        definitions: [{ name: 'read_file', description: 'read' }],
        authorization: {
          permissionManager: new PermissionManager({ mode: 'interactive' }),
          runPreToolHooks,
          onAdditionalContext,
        },
      });

      await manager.execute([
        { id: 'stable-call-id', tool: 'read_file', args: { path: 'README.md' } },
      ]);

      expect(runPreToolHooks).toHaveBeenCalledWith(expect.objectContaining({
        toolCallId: 'stable-call-id',
        tool: 'read_file',
      }));
      expect(executor).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ toolCallId: 'stable-call-id' }),
      );
      expect(onAdditionalContext).toHaveBeenCalledWith('Treat this file as generated.');
      expect(lifecycle).toEqual([
        { event: 'start', toolCallId: 'stable-call-id' },
        { event: 'end', toolCallId: 'stable-call-id' },
      ]);
    });

    it('reauthorizes a user-provided alternative before execution', async () => {
      const permissionManager = new PermissionManager({ mode: 'interactive' });
      const applyPromptDecision = vi.spyOn(permissionManager, 'applyPromptDecision');
      const executor = vi.fn().mockResolvedValue('should not run');
      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue({ decision: 'alternative', alternative: 'printenv' }),
        definitions: [defaultToolDefinition('run_command')],
        authorization: { permissionManager },
      });

      const [result] = await manager.execute([
        { tool: 'run_command', args: { command: 'echo safe' } },
      ]);

      expect(result.success).toBe(false);
      expect(applyPromptDecision).toHaveBeenCalledOnce();
      expect(executor).not.toHaveBeenCalled();
    });
  });

  it('lists registered tool names', () => {
    const manager = new ToolManager({
      executor: vi.fn(),
      confirmApproval: vi.fn(),
      definitions: noopDefinitions as any
    });

    expect(manager.listToolNames()).toEqual(['read_file', 'delete_path']);
  });

  it('unregister removes a tool definition by name', () => {
    const manager = new ToolManager({
      executor: vi.fn(),
      confirmApproval: vi.fn(),
      definitions: noopDefinitions as any
    });

    expect(manager.listToolNames()).toContain('read_file');
    expect(manager.listToolNames()).toContain('delete_path');

    const removed = manager.unregister('read_file');
    expect(removed).toBe(true);
    expect(manager.listToolNames()).not.toContain('read_file');
    expect(manager.listToolNames()).toContain('delete_path');
  });

  it('unregister returns false for non-existent tool', () => {
    const manager = new ToolManager({
      executor: vi.fn(),
      confirmApproval: vi.fn(),
      definitions: noopDefinitions as any
    });

    const removed = manager.unregister('nonexistent_tool');
    expect(removed).toBe(false);
  });

  it('plan tool can be dynamically registered and unregistered', () => {
    const manager = new ToolManager({
      executor: vi.fn(),
      confirmApproval: vi.fn(),
      definitions: [{ name: 'read_file', description: 'read file' }] as any
    });

    // Plan should not be in default tools
    expect(manager.listToolNames()).not.toContain('plan');

    // Register plan tool dynamically
    manager.register(PLAN_TOOL_DEFINITION);
    expect(manager.listToolNames()).toContain('plan');

    // Unregister plan tool
    manager.unregister('plan');
    expect(manager.listToolNames()).not.toContain('plan');

    // Re-register should work
    manager.register(PLAN_TOOL_DEFINITION);
    expect(manager.listToolNames()).toContain('plan');
  });

  it('replaces MCP tools without touching other tools', () => {
    const manager = new ToolManager({
      executor: vi.fn(),
      confirmApproval: vi.fn(),
      definitions: [{ name: 'read_file', description: 'read file' }] as any
    });

    manager.registerMetaTools([
      { name: 'mcp__old__tool', description: 'old mcp tool' },
      { name: 'custom_meta_tool', description: 'custom tool' }
    ] as any);

    manager.replaceMcpTools([
      { name: 'mcp__new__tool', description: 'new mcp tool' }
    ] as any);

    const names = manager.listAllDefinitions().map(def => def.name);

    expect(names).toContain('read_file');
    expect(names).toContain('custom_meta_tool');
    expect(names).toContain('mcp__new__tool');
    expect(names).not.toContain('mcp__old__tool');
  });

  it('replaces runtime meta-tools without leaving stale definitions or removing MCP tools', () => {
    const manager = new ToolManager({
      executor: vi.fn(),
      confirmApproval: vi.fn(),
      definitions: [{ name: 'read_file', description: 'read file' }] as any
    });
    manager.registerMetaTools([{ name: 'mcp__server__tool', description: 'mcp tool' }] as any);

    manager.replaceRuntimeMetaTools([
      { name: 'extension_old', description: 'old extension tool' },
      { name: 'mcp__server__tool', description: 'attempted runtime override' }
    ] as any);
    manager.replaceRuntimeMetaTools([
      { name: 'extension_new', description: 'new extension tool' }
    ] as any);

    const names = manager.listAllDefinitions().map((definition) => definition.name);
    expect(names).toContain('read_file');
    expect(names).toContain('mcp__server__tool');
    expect(names).toContain('extension_new');
    expect(names).not.toContain('extension_old');
    expect(manager.listAllDefinitions().find((definition) => definition.name === 'mcp__server__tool'))
      .toMatchObject({ description: 'mcp tool' });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Parallel Execution Tests
  // ═══════════════════════════════════════════════════════════════════

  describe('parallel execution', () => {
    const threeDefs = [
      { name: 'read_file', description: 'read file' },
      { name: 'search_files', description: 'search files' },
      { name: 'git_status', description: 'git status' }
    ] as const;

    it('executes independent tools in parallel (total time ~1x delay, not 3x)', async () => {
      const delay = 50;
      const executor = createDelayedExecutor(delay);
      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: threeDefs as any,
        maxConcurrency: 5
      });

      const start = Date.now();
      const results = await manager.execute([
        { tool: 'read_file', args: { path: 'a.ts' } },
        { tool: 'search_files', args: { query: 'foo' } },
        { tool: 'git_status', args: {} }
      ]);
      const elapsed = Date.now() - start;

      expect(results).toHaveLength(3);
      expect(results.every(r => r.success)).toBe(true);
      // Should complete in ~1x delay, not 3x. Allow generous margin for CI variability.
      expect(elapsed).toBeLessThan(delay * 2.5);
    });

    it('respects concurrency limit (maxConcurrency: 2, 5 calls)', async () => {
      const delay = 50;
      const tracker = { current: 0, max: 0 };
      const executor = createDelayedExecutor(delay, tracker);

      const fiveDefs = [
        { name: 'read_file', description: 'read file' },
        { name: 'search_files', description: 'search files' },
        { name: 'git_status', description: 'git status' },
        { name: 'list_files', description: 'list files' },
        { name: 'web_search', description: 'web search' }
      ] as const;

      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: fiveDefs as any,
        maxConcurrency: 2
      });

      await manager.execute([
        { tool: 'read_file', args: {} },
        { tool: 'search_files', args: {} },
        { tool: 'git_status', args: {} },
        { tool: 'list_files', args: {} },
        { tool: 'web_search', args: {} }
      ]);

      expect(tracker.max).toBeLessThanOrEqual(2);
    });

    it('isolates errors — failing tool does not affect others', async () => {
      const executor = vi.fn()
        .mockResolvedValueOnce(successfulOutcome('result-0'))
        .mockRejectedValueOnce(new Error('tool 2 broke'))
        .mockResolvedValueOnce(successfulOutcome('result-2'));

      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: threeDefs as any,
        maxConcurrency: 5
      });

      const results = await manager.execute([
        { tool: 'read_file', args: {} },
        { tool: 'search_files', args: {} },
        { tool: 'git_status', args: {} }
      ]);

      expect(results[0]).toMatchObject({ tool: 'read_file', success: true, output: 'result-0' });
      expect(results[1]).toMatchObject({ tool: 'search_files', success: false, error: 'tool 2 broke' });
      expect(results[2]).toMatchObject({ tool: 'git_status', success: true, output: 'result-2' });
    });

    it('preserves result order regardless of completion order', async () => {
      // Tool 0: 100ms, Tool 1: 10ms, Tool 2: 50ms — complete out of order
      const executor = vi.fn()
        .mockImplementationOnce(async () => { await new Promise(r => setTimeout(r, 100)); return successfulOutcome('slow'); })
        .mockImplementationOnce(async () => { await new Promise(r => setTimeout(r, 10)); return successfulOutcome('fast'); })
        .mockImplementationOnce(async () => { await new Promise(r => setTimeout(r, 50)); return successfulOutcome('medium'); });

      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: threeDefs as any,
        maxConcurrency: 5
      });

      const results = await manager.execute([
        { tool: 'read_file', args: {} },
        { tool: 'search_files', args: {} },
        { tool: 'git_status', args: {} }
      ]);

      // Results must match input order, not completion order
      expect(results[0]).toMatchObject({ tool: 'read_file', output: 'slow' });
      expect(results[1]).toMatchObject({ tool: 'search_files', output: 'fast' });
      expect(results[2]).toMatchObject({ tool: 'git_status', output: 'medium' });
    });

    it('keeps approval prompts sequential (not overlapping)', async () => {
      const timestamps: number[] = [];
      const confirm = vi.fn().mockImplementation(async () => {
        timestamps.push(Date.now());
        await new Promise(r => setTimeout(r, 30));
        timestamps.push(Date.now());
        return true;
      });

      const twoDangerousDefs = [
        { name: 'delete_path', description: 'delete', requiresApproval: true },
        { name: 'write_file', description: 'write', requiresApproval: true }
      ] as const;

      const manager = new ToolManager({
        executor: vi.fn().mockResolvedValue(successfulOutcome('ok')),
        confirmApproval: confirm,
        definitions: twoDangerousDefs as any,
        maxConcurrency: 5
      });

      await manager.execute([
        { tool: 'delete_path', args: { path: 'a' } },
        { tool: 'write_file', args: { path: 'b' } }
      ]);

      // Approval 1: timestamps[0]..timestamps[1], Approval 2: timestamps[2]..timestamps[3]
      // Second approval must start after first ends (sequential)
      expect(timestamps).toHaveLength(4);
      expect(timestamps[2]).toBeGreaterThanOrEqual(timestamps[1]);
    });

    it('executes mutating tools sequentially even when concurrency allows parallel reads', async () => {
      const tracker = { current: 0, max: 0 };
      const executor = createDelayedExecutor(25, tracker);

      const mutatingDefs = [
        { name: 'write_file', description: 'write' },
        { name: 'delete_path', description: 'delete' },
        { name: 'search_replace', description: 'replace' }
      ] as const;

      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: mutatingDefs as any,
        maxConcurrency: 5
      });

      await manager.execute([
        { tool: 'write_file', args: { path: 'a.ts', contents: 'a' } },
        { tool: 'delete_path', args: { path: 'b.ts' } },
        { tool: 'search_replace', args: { path: 'c.ts', blocks: 'SEARCH\nold\nREPLACE\nnew' } }
      ]);

      expect(tracker.max).toBe(1);
    });

    it('uses mutating tools as barriers between parallel read batches', async () => {
      const events: Array<{ phase: 'start' | 'end'; tool: string }> = [];
      const tracker = { current: 0, max: 0 };
      const executor = async (action: { type: string }) => {
        tracker.current++;
        tracker.max = Math.max(tracker.max, tracker.current);
        events.push({ phase: 'start', tool: action.type });
        await new Promise(r => setTimeout(r, 25));
        events.push({ phase: 'end', tool: action.type });
        tracker.current--;
        return successfulOutcome(action.type);
      };

      const defs = [
        { name: 'read_file', description: 'read' },
        { name: 'search_files', description: 'search' },
        { name: 'write_file', description: 'write' },
        { name: 'git_status', description: 'git status' },
        { name: 'list_files', description: 'list' }
      ] as const;

      const manager = new ToolManager({
        executor: executor as any,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: defs as any,
        maxConcurrency: 5
      });

      await manager.execute([
        { tool: 'read_file', args: { path: 'a.ts' } },
        { tool: 'search_files', args: { query: 'needle' } },
        { tool: 'write_file', args: { path: 'a.ts', contents: 'new' } },
        { tool: 'git_status', args: {} },
        { tool: 'list_files', args: {} }
      ]);

      const position = (phase: 'start' | 'end', tool: string) =>
        events.findIndex(event => event.phase === phase && event.tool === tool);

      const writeStart = position('start', 'write_file');
      const writeEnd = position('end', 'write_file');

      expect(tracker.max).toBe(2);
      expect(writeStart).toBeGreaterThan(position('end', 'read_file'));
      expect(writeStart).toBeGreaterThan(position('end', 'search_files'));
      expect(position('start', 'git_status')).toBeGreaterThan(writeEnd);
      expect(position('start', 'list_files')).toBeGreaterThan(writeEnd);
    });

    it('executes shell tools sequentially because commands can mutate arbitrary state', async () => {
      const tracker = { current: 0, max: 0 };
      const executor = createDelayedExecutor(25, tracker);

      const shellDefs = [
        { name: 'run_command', description: 'run command' },
        { name: 'shell', description: 'shell' },
        { name: 'custom_command', description: 'custom command' }
      ] as const;

      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: shellDefs as any,
        maxConcurrency: 5
      });

      await manager.execute([
        { tool: 'run_command', args: { command: 'echo one' } },
        { tool: 'shell', args: { command: 'echo two' } },
        { tool: 'custom_command', args: { name: 'three', command: 'echo three' } }
      ]);

      expect(tracker.max).toBe(1);
    });

    it('handles mixed denied + approved tools correctly', async () => {
      const confirm = vi.fn()
        .mockResolvedValueOnce(false)  // deny first
        .mockResolvedValueOnce(true);  // approve second

      const twoDangerousDefs = [
        { name: 'delete_path', description: 'delete', requiresApproval: true },
        { name: 'write_file', description: 'write', requiresApproval: true }
      ] as const;

      const executor = vi.fn().mockResolvedValue(successfulOutcome('written'));

      const manager = new ToolManager({
        executor,
        confirmApproval: confirm,
        definitions: twoDangerousDefs as any,
        maxConcurrency: 5
      });

      const results = await manager.execute([
        { tool: 'delete_path', args: { path: 'a' } },
        { tool: 'write_file', args: { path: 'b' } }
      ]);

      expect(results[0]).toMatchObject({ tool: 'delete_path', success: false, output: 'Tool execution skipped by user.' });
      expect(results[1]).toMatchObject({ tool: 'write_file', success: true, output: 'written' });
    });

    it('maxConcurrency: 1 behaves sequentially', async () => {
      const delay = 30;
      const tracker = { current: 0, max: 0 };
      const executor = createDelayedExecutor(delay, tracker);

      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: threeDefs as any,
        maxConcurrency: 1
      });

      const start = Date.now();
      await manager.execute([
        { tool: 'read_file', args: {} },
        { tool: 'search_files', args: {} },
        { tool: 'git_status', args: {} }
      ]);
      const elapsed = Date.now() - start;

      // Sequential: should take ~3x delay
      expect(tracker.max).toBe(1);
      expect(elapsed).toBeGreaterThanOrEqual(delay * 2.5);
    });

    it('defaults to maxConcurrency 5 when not specified', async () => {
      const delay = 30;
      const tracker = { current: 0, max: 0 };
      const executor = createDelayedExecutor(delay, tracker);

      const fiveDefs = [
        { name: 'read_file', description: 'r' },
        { name: 'search_files', description: 's' },
        { name: 'git_status', description: 'g' },
        { name: 'list_files', description: 'l' },
        { name: 'web_search', description: 'w' }
      ] as const;

      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: fiveDefs as any
        // No maxConcurrency specified — should default to 5
      });

      await manager.execute([
        { tool: 'read_file', args: {} },
        { tool: 'search_files', args: {} },
        { tool: 'git_status', args: {} },
        { tool: 'list_files', args: {} },
        { tool: 'web_search', args: {} }
      ]);

      // All 5 should run concurrently (default max = 5)
      expect(tracker.max).toBe(5);
    });

    it('onToolComplete callback fires per-tool with correct index and result', async () => {
      const executor = vi.fn()
        .mockImplementationOnce(async () => { await new Promise(r => setTimeout(r, 30)); return successfulOutcome('a'); })
        .mockImplementationOnce(async () => { await new Promise(r => setTimeout(r, 10)); return successfulOutcome('b'); })
        .mockImplementationOnce(async () => { await new Promise(r => setTimeout(r, 20)); return successfulOutcome('c'); });

      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: threeDefs as any,
        maxConcurrency: 5
      });

      const callbacks: Array<{ index: number; result: { tool: string; success: boolean; output?: string } }> = [];

      await manager.execute(
        [
          { tool: 'read_file', args: {} },
          { tool: 'search_files', args: {} },
          { tool: 'git_status', args: {} }
        ],
        (index, result) => {
          callbacks.push({ index, result });
        }
      );

      // Should fire exactly 3 times
      expect(callbacks).toHaveLength(3);

      // Each index should appear once
      const indices = callbacks.map(c => c.index).sort();
      expect(indices).toEqual([0, 1, 2]);

      // Verify correct tool-to-index mapping
      const byIndex = Object.fromEntries(callbacks.map(c => [c.index, c.result]));
      expect(byIndex[0]).toMatchObject({ tool: 'read_file', success: true, output: 'a' });
      expect(byIndex[1]).toMatchObject({ tool: 'search_files', success: true, output: 'b' });
      expect(byIndex[2]).toMatchObject({ tool: 'git_status', success: true, output: 'c' });
    });

    it('onToolComplete fires for rejected and denied tools too', async () => {
      // Use a tool not in definitions to trigger context rejection
      const defs = [
        { name: 'read_file', description: 'read' },
        { name: 'delete_path', description: 'delete', requiresApproval: true }
      ] as const;

      const confirm = vi.fn().mockResolvedValue(false); // deny approval
      const executor = vi.fn().mockResolvedValue(successfulOutcome('ok'));

      const manager = new ToolManager({
        executor,
        confirmApproval: confirm,
        definitions: defs as any,
        maxConcurrency: 5
      });

      const callbacks: Array<{ index: number; result: { tool: string; success: boolean } }> = [];

      await manager.execute(
        [
          { tool: 'read_file', args: {} },           // will execute normally
          { tool: 'delete_path', args: { path: 'x' } } // will be denied by user
        ],
        (index, result) => {
          callbacks.push({ index, result });
        }
      );

      // Both should fire callback
      expect(callbacks).toHaveLength(2);

      const byIndex = Object.fromEntries(callbacks.map(c => [c.index, c.result]));
      expect(byIndex[0]).toMatchObject({ tool: 'read_file', success: true });
      expect(byIndex[1]).toMatchObject({ tool: 'delete_path', success: false });
    });

    it('single tool call works correctly through parallel engine', async () => {
      const executor = vi.fn().mockResolvedValue(successfulOutcome('single result'));
      const callback = vi.fn();

      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: [{ name: 'read_file', description: 'read' }] as any,
        maxConcurrency: 5
      });

      const results = await manager.execute(
        [{ tool: 'read_file', args: { path: 'one.ts' } }],
        callback
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ tool: 'read_file', success: true, output: 'single result' });
      expect(executor).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(0, expect.objectContaining({ tool: 'read_file', success: true }));
    });

    it('aborts every call before authorization when the signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const confirmApproval = vi.fn();
      const executor = vi.fn().mockResolvedValue(successfulOutcome('should not run'));
      const onToolComplete = vi.fn();
      const manager = new ToolManager({
        executor,
        confirmApproval,
        definitions: [defaultToolDefinition('run_command')],
      });

      const results = await manager.execute([
        { tool: 'run_command', args: { command: 'echo one' } },
        { tool: 'run_command', args: { command: 'echo two' } },
      ], onToolComplete, { signal: controller.signal });

      expect(results).toEqual([
        expect.objectContaining({ tool: 'run_command', success: false, kind: 'aborted' }),
        expect.objectContaining({ tool: 'run_command', success: false, kind: 'aborted' }),
      ]);
      expect(confirmApproval).not.toHaveBeenCalled();
      expect(executor).not.toHaveBeenCalled();
      expect(onToolComplete).toHaveBeenCalledTimes(2);
    });

    it('does not execute after cancellation arrives during approval', async () => {
      const controller = new AbortController();
      let resolveApproval!: (decision: { decision: 'allow_once' }) => void;
      const confirmApproval = vi.fn(() => new Promise<{ decision: 'allow_once' }>((resolve) => {
        resolveApproval = resolve;
      }));
      const executor = vi.fn().mockResolvedValue(successfulOutcome('should not run'));
      const manager = new ToolManager({
        executor,
        confirmApproval,
        definitions: [defaultToolDefinition('run_command')],
        authorization: { permissionManager: new PermissionManager({ mode: 'interactive' }) },
      });

      const execution = manager.execute([
        { tool: 'run_command', args: { command: 'echo approval' } },
      ], undefined, { signal: controller.signal });
      await vi.waitFor(() => expect(confirmApproval).toHaveBeenCalledOnce());

      controller.abort();
      resolveApproval({ decision: 'allow_once' });

      await expect(execution).resolves.toEqual([
        expect.objectContaining({ success: false, kind: 'aborted' }),
      ]);
      expect(executor).not.toHaveBeenCalled();
    });

    it('awaits started parallel work and aborts every not-yet-started call exactly once', async () => {
      const controller = new AbortController();
      const started: string[] = [];
      const pendingResolvers: Array<() => void> = [];
      const executor = vi.fn<ToolManagerOptions['executor']>(async (action, context) => {
        started.push(action.type);
        expect(context?.signal).toBe(controller.signal);
        if (started.length <= 2) {
          await new Promise<void>((resolve) => pendingResolvers.push(resolve));
        }
        return successfulOutcome('done');
      });
      const onToolComplete = vi.fn();
      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn(),
        definitions: [
          { name: 'read_file', description: 'read' },
          { name: 'git_status', description: 'status' },
          { name: 'fff_find', description: 'find' },
        ],
        maxConcurrency: 2,
        authorization: { permissionManager: new PermissionManager({ mode: 'unrestricted' }) },
      });

      let settled = false;
      const execution = manager.execute([
        { tool: 'read_file', args: {} },
        { tool: 'git_status', args: {} },
        { tool: 'fff_find', args: {} },
      ], onToolComplete, { signal: controller.signal }).finally(() => {
        settled = true;
      });
      await vi.waitFor(() => expect(executor).toHaveBeenCalledTimes(2));

      controller.abort();
      await Promise.resolve();
      expect(settled).toBe(false);
      pendingResolvers.forEach(resolve => resolve());

      const results = await execution;
      expect(executor).toHaveBeenCalledTimes(2);
      expect(results).toEqual([
        expect.objectContaining({ success: false, kind: 'aborted' }),
        expect.objectContaining({ success: false, kind: 'aborted' }),
        expect.objectContaining({ success: false, kind: 'aborted' }),
      ]);
      expect(onToolComplete).toHaveBeenCalledTimes(3);
      expect(onToolComplete.mock.calls.map(([index]) => index).sort()).toEqual([0, 1, 2]);
    });

    it('does not cross a sequential barrier after a parallel batch is aborted', async () => {
      const controller = new AbortController();
      let resolveRead!: () => void;
      const executor = vi.fn<ToolManagerOptions['executor']>(async (action) => {
        if (action.type === 'read_file') {
          await new Promise<void>((resolve) => {
            resolveRead = resolve;
          });
        }
        return successfulOutcome('done');
      });
      const manager = new ToolManager({
        executor,
        confirmApproval: vi.fn(),
        definitions: [
          { name: 'read_file', description: 'read' },
          { name: 'write_file', description: 'write' },
        ],
        authorization: { permissionManager: new PermissionManager({ mode: 'unrestricted' }) },
      });

      const execution = manager.execute([
        { tool: 'read_file', args: {} },
        { tool: 'write_file', args: {} },
      ], undefined, { signal: controller.signal });
      await vi.waitFor(() => expect(executor).toHaveBeenCalledOnce());

      controller.abort();
      resolveRead();

      const results = await execution;
      expect(executor).toHaveBeenCalledOnce();
      expect(results).toEqual([
        expect.objectContaining({ success: false, kind: 'aborted' }),
        expect.objectContaining({ success: false, kind: 'aborted' }),
      ]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Performance Benchmarks
  // ═══════════════════════════════════════════════════════════════════

  describe('performance benchmarks', () => {
    const fiveDefs = [
      { name: 'read_file', description: 'r' },
      { name: 'search_files', description: 's' },
      { name: 'git_status', description: 'g' },
      { name: 'list_files', description: 'l' },
      { name: 'web_search', description: 'w' }
    ] as const;

    it('parallel is significantly faster than sequential for I/O-bound tools', async () => {
      const ioDelay = 50; // Simulate 50ms I/O per tool (realistic for file reads)
      const toolCount = 5;
      const executor = createDelayedExecutor(ioDelay);

      // Sequential (maxConcurrency: 1)
      const seqManager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: fiveDefs as any,
        maxConcurrency: 1
      });

      const calls = [
        { tool: 'read_file', args: {} },
        { tool: 'search_files', args: {} },
        { tool: 'git_status', args: {} },
        { tool: 'list_files', args: {} },
        { tool: 'web_search', args: {} }
      ];

      const seqStart = Date.now();
      await seqManager.execute(calls as any);
      const seqTime = Date.now() - seqStart;

      // Parallel (maxConcurrency: 5)
      const parManager = new ToolManager({
        executor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: fiveDefs as any,
        maxConcurrency: 5
      });

      const parStart = Date.now();
      await parManager.execute(calls as any);
      const parTime = Date.now() - parStart;

      const speedup = seqTime / parTime;

      // Sequential should take ~5x delay, parallel ~1x delay → speedup >= 2x
      expect(seqTime).toBeGreaterThanOrEqual(ioDelay * (toolCount - 1)); // at least 200ms
      expect(parTime).toBeLessThan(ioDelay * 2.5);                       // under 125ms
      expect(speedup).toBeGreaterThanOrEqual(2);                          // at least 2x faster

      // Log for visibility in test output
      console.log(`  [perf] Sequential: ${seqTime}ms | Parallel: ${parTime}ms | Speedup: ${speedup.toFixed(1)}x`);
    });

    it('speedup scales with tool count (3 vs 5 vs 10 tools)', async () => {
      const ioDelay = 30;
      const results: Array<{
        count: number;
        seqMs: number;
        parMs: number;
        speedup: number;
        sequentialMaxConcurrency: number;
        parallelMaxConcurrency: number;
      }> = [];

      for (const count of [3, 5, 10]) {
        // Build definitions and calls for this count
        const defs = Array.from({ length: count }, (_, i) => ({
          name: `tool_${i}`, description: `tool ${i}`
        }));
        const calls = defs.map(d => ({ tool: d.name, args: {} }));

        const sequentialTracker = { current: 0, max: 0 };
        const parallelTracker = { current: 0, max: 0 };

        // Sequential
        const seqManager = new ToolManager({
          executor: createDelayedExecutor(ioDelay, sequentialTracker),
          confirmApproval: vi.fn().mockResolvedValue(true),
          definitions: defs as any,
          maxConcurrency: 1
        });
        const seqStart = Date.now();
        await seqManager.execute(calls as any);
        const seqMs = Date.now() - seqStart;

        // Parallel
        const parManager = new ToolManager({
          executor: createDelayedExecutor(ioDelay, parallelTracker),
          confirmApproval: vi.fn().mockResolvedValue(true),
          definitions: defs as any,
          maxConcurrency: 5
        });
        const parStart = Date.now();
        await parManager.execute(calls as any);
        const parMs = Date.now() - parStart;

        const speedup = seqMs / parMs;
        results.push({
          count,
          seqMs,
          parMs,
          speedup,
          sequentialMaxConcurrency: sequentialTracker.max,
          parallelMaxConcurrency: parallelTracker.max,
        });
      }

      // Print benchmark table
      console.log('\n  [perf] Parallel Speedup by Tool Count');
      console.log('  ┌────────┬────────────┬────────────┬──────────┐');
      console.log('  │ Tools  │ Sequential │  Parallel  │ Speedup  │');
      console.log('  ├────────┼────────────┼────────────┼──────────┤');
      for (const r of results) {
        console.log(`  │ ${String(r.count).padStart(5)} │ ${String(r.seqMs + 'ms').padStart(9)} │ ${String(r.parMs + 'ms').padStart(9)} │ ${r.speedup.toFixed(1).padStart(6)}x │`);
      }
      console.log('  └────────┴────────────┴────────────┴──────────┘');

      expect(results[0].sequentialMaxConcurrency).toBe(1);
      expect(results[1].sequentialMaxConcurrency).toBe(1);
      expect(results[2].sequentialMaxConcurrency).toBe(1);

      expect(results[0].parallelMaxConcurrency).toBe(3);
      expect(results[1].parallelMaxConcurrency).toBe(5);
      expect(results[2].parallelMaxConcurrency).toBe(5);

      for (const result of results) {
        expect(result.parMs).toBeLessThan(result.seqMs);
      }
    });

    it('real file I/O: parallel reads are faster than sequential', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');

      // Use actual project files for realistic I/O
      const testFiles = [
        'src/index.ts',
        'src/types.ts',
        'src/core/toolManager.ts',
        'src/core/agent.ts',
        'src/core/agents/SubAgent.ts'
      ];

      const realExecutor = async (action: any) => {
        const filePath = path.resolve(action.path || action.type);
        return successfulOutcome(await fs.readFile(filePath, 'utf-8'));
      };

      const defs = [{ name: 'read_file', description: 'read' }] as any;
      const calls = testFiles.map(f => ({ tool: 'read_file', args: { path: f } }));

      // Sequential
      const seqManager = new ToolManager({
        executor: realExecutor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: defs,
        maxConcurrency: 1
      });
      const seqStart = Date.now();
      const seqResults = await seqManager.execute(calls as any);
      const seqMs = Date.now() - seqStart;

      // Parallel
      const parManager = new ToolManager({
        executor: realExecutor,
        confirmApproval: vi.fn().mockResolvedValue(true),
        definitions: defs,
        maxConcurrency: 5
      });
      const parStart = Date.now();
      const parResults = await parManager.execute(calls as any);
      const parMs = Date.now() - parStart;

      // Both should succeed and return the same content
      expect(seqResults.every(r => r.success)).toBe(true);
      expect(parResults.every(r => r.success)).toBe(true);
      for (let i = 0; i < testFiles.length; i++) {
        expect(seqResults[i].output).toBe(parResults[i].output);
      }

      // Calculate total bytes read
      const totalBytes = parResults.reduce((sum, r) => sum + (r.output?.length ?? 0), 0);
      const totalKB = (totalBytes / 1024).toFixed(0);

      console.log(`  [perf] Real file I/O (${testFiles.length} files, ${totalKB} KB total)`);
      console.log(`         Sequential: ${seqMs}ms | Parallel: ${parMs}ms`);

      // Real file I/O may not show huge speedup on fast SSDs with warm cache,
      // but parallel should never be significantly slower than sequential
      expect(parMs).toBeLessThanOrEqual(seqMs + 50); // parallel <= sequential + generous margin
    });
  });
});
