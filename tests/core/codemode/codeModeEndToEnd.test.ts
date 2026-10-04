/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPlanModeManager } from '../../../src/commands/plan.js';
import { CODE_MODE_TOOL_NAME, runCodeModeScript } from '../../../src/core/agent/CodeModeRunner.js';
import type { HookExecutionResult } from '../../../src/core/HookManager.js';
import {
  CODE_MODE_TOOL_DEFINITION,
  DEFAULT_TOOL_DEFINITIONS,
  ToolManager,
  type PreToolHookContext,
  type ToolDefinition,
} from '../../../src/core/toolManager.js';
import { PermissionManager } from '../../../src/permissions/PermissionManager.js';
import type { AgentAction, ToolActionOutcome, ToolExecutionContext } from '../../../src/types.js';

const builtin = (name: string): ToolDefinition => {
  const definition = DEFAULT_TOOL_DEFINITIONS.find((candidate) => candidate.name === name);
  if (!definition) throw new Error(`Missing default tool definition for ${name}`);
  return definition;
};

const hookAllows = (): HookExecutionResult => ({ hook: { event: 'pre-tool', command: 'true' }, success: true, duration: 1 });
const hookDenies = (reason: string): HookExecutionResult => ({
  ...hookAllows(),
  response: { decision: 'deny', reason },
});

/**
 * The real ToolManager and the real QuickJS sandbox, with an executor that
 * dispatches `run_tool_script` the way the agent does and fakes the file system.
 */
function createAgentTools(options: {
  approve?: boolean;
  preToolHook?: (context: PreToolHookContext) => HookExecutionResult[];
} = {}) {
  const files = new Map<string, string>([
    ['a.ts', 'export const a = 1; // TODO tidy'],
    ['b.ts', 'export const b = 2;'],
    ['c.ts', 'export const c = 3; // TODO remove'],
  ]);
  const executed: Array<{ tool: string; id?: string; parent?: string; modelVisible?: boolean }> = [];
  const confirmApproval = vi.fn(async () => ({ decision: options.approve === false ? 'deny_once' : 'allow_once' }) as never);
  const runPreToolHooks = vi.fn(async (context: PreToolHookContext) => options.preToolHook?.(context) ?? [hookAllows()]);

  const manager: ToolManager = new ToolManager({
    confirmApproval,
    definitions: [CODE_MODE_TOOL_DEFINITION, builtin('read_file'), builtin('write_file'), builtin('delegate_task')],
    authorization: { permissionManager: new PermissionManager({ mode: 'interactive' }), runPreToolHooks },
    executor: async (action: AgentAction, context?: ToolExecutionContext): Promise<ToolActionOutcome> => {
      executed.push({ tool: action.type, id: context?.toolCallId, parent: context?.parentToolCallId, modelVisible: context?.modelVisible });
      if (action.type === CODE_MODE_TOOL_NAME) {
        return runCodeModeScript(manager, {
          script: action.script,
          timeoutMs: action.timeout_ms,
          toolCallId: context?.toolCallId ?? 'script',
          signal: context?.signal,
        });
      }
      if (action.type === 'read_file') {
        const body = files.get(action.path);
        return body === undefined
          ? { success: false, kind: 'operational', error: `ENOENT: ${action.path}` }
          : { success: true, output: body };
      }
      if (action.type === 'write_file') {
        files.set(action.path, String(action.contents ?? ''));
        return { success: true, output: `wrote ${action.path}` };
      }
      return { success: true, output: 'ok' };
    },
  });

  const runScript = async (script: string, signal?: AbortSignal) => {
    const [result] = await manager.execute(
      [{ id: 'script-1', tool: CODE_MODE_TOOL_NAME, args: { script } }],
      undefined,
      signal ? { signal } : {},
    );
    return result;
  };
  const summary = (output: string | undefined) => JSON.parse(output ?? '{}') as {
    result: unknown; logs: string; calls: { total: number; failed: number; byTool: Record<string, number> };
  };

  return { runScript, summary, files, executed, confirmApproval, runPreToolHooks };
}

describe('run_tool_script end to end', () => {
  afterEach(() => {
    getPlanModeManager().disable();
  });

  it('aggregates across parallel reads and returns only the answer', async () => {
    const { runScript, summary, executed, runPreToolHooks, confirmApproval } = createAgentTools();

    const result = await runScript(`
      const reads = await Promise.all(['a.ts', 'b.ts', 'c.ts'].map((path) => tools.read_file({ path })));
      console.log('read', reads.length);
      return reads.filter((read) => read.ok && read.output.includes('TODO')).length;
    `);

    expect(result.success).toBe(true);
    const report = summary(result.success ? result.output : undefined);
    expect(report.result).toBe(2);
    expect(report.logs).toBe('read 3');
    expect(report.calls).toEqual({ total: 3, failed: 0, byTool: { read_file: 3 } });
    expect(result.success ? result.output : '').not.toContain('export const');

    expect(executed.filter(({ tool }) => tool === 'read_file')).toEqual([
      { tool: 'read_file', id: 'script-1:0', parent: 'script-1', modelVisible: false },
      { tool: 'read_file', id: 'script-1:1', parent: 'script-1', modelVisible: false },
      { tool: 'read_file', id: 'script-1:2', parent: 'script-1', modelVisible: false },
    ]);
    expect(runPreToolHooks.mock.calls.map(([context]) => [context.tool, context.parentToolCallId])).toEqual([
      [CODE_MODE_TOOL_NAME, undefined],
      ['read_file', 'script-1'],
      ['read_file', 'script-1'],
      ['read_file', 'script-1'],
    ]);
    expect(confirmApproval).not.toHaveBeenCalled();
  });

  it('hands an ordinary failure to the script as a value', async () => {
    const { runScript, summary } = createAgentTools();

    const result = await runScript(`
      const missing = await tools.read_file({ path: 'nope.ts' });
      return missing.ok ? 'found' : missing.error;
    `);

    expect(summary(result.success ? result.output : undefined)).toMatchObject({
      result: 'ENOENT: nope.ts',
      calls: { total: 1, failed: 1 },
    });
  });

  it('asks for approval for a nested write exactly as for a direct one, and writes when approved', async () => {
    const { runScript, files, confirmApproval } = createAgentTools({ approve: true });

    const result = await runScript(`
      const written = await tools.write_file({ path: 'out.ts', contents: 'generated' });
      return written.ok;
    `);

    expect(result.success).toBe(true);
    expect(confirmApproval).toHaveBeenCalledOnce();
    expect(files.get('out.ts')).toBe('generated');
  });

  it('stops the script at a denied write and does not run what came after it', async () => {
    const { runScript, files, executed, confirmApproval } = createAgentTools({ approve: false });

    const result = await runScript(`
      await tools.write_file({ path: 'first.ts', contents: 'one' });
      await tools.write_file({ path: 'second.ts', contents: 'two' });
      return 'finished';
    `);

    expect(result).toMatchObject({ success: false, kind: 'authorization' });
    expect(confirmApproval).toHaveBeenCalledOnce();
    expect(files.has('first.ts')).toBe(false);
    expect(files.has('second.ts')).toBe(false);
    expect(executed.filter(({ tool }) => tool === 'write_file')).toEqual([]);
  });

  it('lets a pre-tool hook block one nested call, which ends the script', async () => {
    const { runScript, files } = createAgentTools({
      preToolHook: (context) => [context.tool === 'write_file' ? hookDenies('writes are frozen') : hookAllows()],
    });

    const result = await runScript(`
      const read = await tools.read_file({ path: 'a.ts' });
      await tools.write_file({ path: 'a.ts', contents: read.output + ' // changed' });
      return 'finished';
    `);

    expect(result).toMatchObject({ success: false, kind: 'authorization' });
    expect(result.success ? '' : result.error).toContain('writes are frozen');
    expect(files.get('a.ts')).toBe('export const a = 1; // TODO tidy');
  });

  it('lets a pre-tool hook veto the script itself before anything runs', async () => {
    const { runScript, executed } = createAgentTools({
      preToolHook: (context) => [context.tool === CODE_MODE_TOOL_NAME ? hookDenies('no scripts here') : hookAllows()],
    });

    const result = await runScript(`return await tools.read_file({ path: 'a.ts' });`);

    expect(result).toMatchObject({ success: false, kind: 'authorization' });
    expect(executed).toEqual([]);
  });

  it('keeps plan mode read-only: a nested read works, a nested write ends the script', async () => {
    getPlanModeManager().enable();
    const { runScript, summary, files } = createAgentTools();

    const reading = await runScript(`return (await tools.read_file({ path: 'b.ts' })).output;`);
    expect(summary(reading.success ? reading.output : undefined).result).toBe('export const b = 2;');

    const writing = await runScript(`await tools.write_file({ path: 'b.ts', contents: 'x' }); return 'finished';`);
    expect(writing).toMatchObject({ success: false, kind: 'authorization' });
    expect(writing.success ? '' : writing.error).toContain('plan mode');
    expect(files.get('b.ts')).toBe('export const b = 2;');
  });

  it.each([
    ['another script', `tools.${CODE_MODE_TOOL_NAME}({ script: 'return 1' })`],
    ['a delegated agent', `tools.delegate_task({ agent_name: 'helper', task: 'do it' })`],
    ['a tool that does not exist', `tools.launch_missiles({})`],
  ])('cannot start %s', async (_name, call) => {
    const { runScript, summary, executed } = createAgentTools();

    const result = await runScript(`
      try { await ${call}; return 'called'; } catch (error) { return 'refused: ' + error.message; }
    `);

    expect(String(summary(result.success ? result.output : undefined).result)).toMatch(/^refused: /u);
    expect(executed.map(({ tool }) => tool)).toEqual([CODE_MODE_TOOL_NAME]);
  });

  it('has no ambient access to the host', async () => {
    const { runScript, summary } = createAgentTools();

    const result = await runScript(`
      return [typeof process, typeof require, typeof fetch, typeof Bun, typeof setTimeout, typeof globalThis.tools];
    `);

    expect(summary(result.success ? result.output : undefined).result).toEqual([
      'undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'object',
    ]);
  });

  it('reports a script error with the logs printed before it', async () => {
    const { runScript } = createAgentTools();

    const result = await runScript(`console.log('step 1'); throw new Error('bad input');`);

    expect(result).toMatchObject({ success: false, kind: 'validation' });
    expect(result.success ? '' : result.error).toContain('bad input');
    expect(result.success ? '' : result.output).toContain('step 1');
  });

  it('is cancelled with the turn', async () => {
    const controller = new AbortController();
    controller.abort();
    const { runScript, executed } = createAgentTools();

    const result = await runScript(`return await tools.read_file({ path: 'a.ts' });`, controller.signal);

    expect(result).toMatchObject({ success: false, kind: 'aborted' });
    expect(executed.filter(({ tool }) => tool === 'read_file')).toEqual([]);
  });
});
