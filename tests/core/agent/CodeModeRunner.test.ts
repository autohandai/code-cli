/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CODE_MODE_DEFAULT_TIMEOUT_MS,
  CODE_MODE_MAX_TIMEOUT_MS,
  CODE_MODE_TOOL_NAME,
  codeModeToolDefinitions,
  isScriptCallableTool,
  runCodeModeScript,
  syncCodeModeTool,
  type CodeModeToolHost,
  type SandboxRunner,
} from '../../../src/core/agent/CodeModeRunner.js';
import type { SandboxRunOptions, SandboxRunResult, SandboxToolOutcome } from '../../../src/core/codemode/QuickJsSandbox.js';
import type { LoadedConfig, ToolCallRequest, ToolExecutionContext, ToolExecutionResult } from '../../../src/types.js';

const REGISTERED = [
  'read_file', 'search', 'write_file', 'run_command', 'git_status', 'fetch_url', 'web_search', 'recall_memory',
  'mcp__github__list_issues', 'mcp__autohand-computer-use__click',
  CODE_MODE_TOOL_NAME, 'delegate_task', 'delegate_parallel', 'todo_write', 'plan', 'exit_plan_mode',
  'ask_followup_question', 'create_meta_tool', 'tools_registry', 'tool_search', 'set_lifecycle_hook', 'create_hook',
];

type ExecuteArgs = [ToolCallRequest[], undefined, Omit<ToolExecutionContext, 'toolCallId'>];

function createHost(respond: (call: ToolCallRequest) => ToolExecutionResult = (call) => ({ tool: call.tool, success: true, output: `${call.tool} ok` })) {
  const execute = vi.fn(async (...[calls]: ExecuteArgs) => calls.map(respond));
  const host: CodeModeToolHost = { execute, listToolNames: () => REGISTERED as ToolCallRequest['tool'][] };
  return { host, execute };
}

/** A stand-in sandbox: the "script" is a function that drives the tool bridge the way the guest would. */
function sandbox(
  script: (call: (calls: Array<{ tool: string; args: unknown }>) => Promise<SandboxToolOutcome[]>, options: SandboxRunOptions) => Promise<Partial<SandboxRunResult>>,
): SandboxRunner {
  return async (options) => {
    let nextId = 0;
    let toolCalls = 0;
    const call = (calls: Array<{ tool: string; args: unknown }>) => {
      toolCalls += calls.length;
      return options.executeToolCalls(calls.map((entry) => ({ id: nextId++, ...entry })));
    };
    try {
      const partial = await script(call, options);
      return { ok: true, result: 'null', logs: '', toolCalls, durationMs: 5, ...partial };
    } catch (error) {
      return { ok: false, error: (error as Error).message, errorKind: 'aborted', logs: '', toolCalls, durationMs: 5 };
    }
  };
}

const INPUT = { script: 'return 1', toolCallId: 'call-1' };

describe('isScriptCallableTool', () => {
  it.each(['read_file', 'search', 'write_file', 'run_command', 'git_status', 'fetch_url', 'web_search', 'recall_memory', 'mcp__github__list_issues'])(
    'lets a script call %s',
    (tool) => expect(isScriptCallableTool(tool)).toBe(true),
  );

  it.each([
    CODE_MODE_TOOL_NAME, 'delegate_task', 'delegate_parallel', 'todo_write', 'plan', 'exit_plan_mode', 'ask_followup_question',
    'create_meta_tool', 'tools_registry', 'tool_search', 'set_lifecycle_hook', 'create_hook', 'mcp__autohand-computer-use__click', 'made_up_tool',
  ])('keeps %s out of scripts', (tool) => expect(isScriptCallableTool(tool)).toBe(false));
});

describe('runCodeModeScript', () => {
  it('offers the sandbox only the registered tools a script may call', async () => {
    const { host } = createHost();
    const runSandbox = vi.fn(sandbox(async () => ({})));

    await runCodeModeScript(host, INPUT, runSandbox);

    const options = runSandbox.mock.calls[0]?.[0] as SandboxRunOptions;
    expect([...options.toolNames].sort()).toEqual([
      'fetch_url', 'git_status', 'mcp__github__list_issues', 'read_file', 'recall_memory', 'run_command', 'search', 'web_search', 'write_file',
    ]);
    expect(options.script).toBe('return 1');
    expect(options.timeoutMs).toBe(CODE_MODE_DEFAULT_TIMEOUT_MS);
  });

  it.each([
    [undefined, CODE_MODE_DEFAULT_TIMEOUT_MS],
    [5_000, 5_000],
    [0, CODE_MODE_DEFAULT_TIMEOUT_MS],
    [-1, CODE_MODE_DEFAULT_TIMEOUT_MS],
    [9_999_999, CODE_MODE_MAX_TIMEOUT_MS],
  ])('resolves a requested timeout of %s to %i ms', async (timeoutMs, expected) => {
    const { host } = createHost();
    const runSandbox = vi.fn(sandbox(async () => ({})));

    await runCodeModeScript(host, { ...INPUT, timeoutMs }, runSandbox);

    expect((runSandbox.mock.calls[0]?.[0] as SandboxRunOptions).timeoutMs).toBe(expected);
  });

  it('routes every nested call through the tool manager as one batch, tagged with its parent', async () => {
    const { host, execute } = createHost();
    const controller = new AbortController();

    await runCodeModeScript(host, { ...INPUT, signal: controller.signal }, sandbox(async (call) => {
      await call([{ tool: 'read_file', args: { path: 'a.ts' } }, { tool: 'read_file', args: { path: 'b.ts' } }]);
      await call([{ tool: 'search', args: { query: 'TODO' } }]);
      return {};
    }));

    expect(execute).toHaveBeenCalledTimes(2);
    const [firstBatch, onComplete, context] = execute.mock.calls[0] as ExecuteArgs;
    expect(firstBatch).toEqual([
      { id: 'call-1:0', tool: 'read_file', args: { path: 'a.ts' } },
      { id: 'call-1:1', tool: 'read_file', args: { path: 'b.ts' } },
    ]);
    expect(onComplete).toBeUndefined();
    expect(context).toEqual({ signal: controller.signal, parentToolCallId: 'call-1', modelVisible: false });
    expect(context).not.toHaveProperty('approvalHandled');
    expect((execute.mock.calls[1] as ExecuteArgs)[0]).toEqual([{ id: 'call-1:2', tool: 'search', args: { query: 'TODO' } }]);
  });

  it('passes the script call\'s own execution context on to nested calls, except its approval', async () => {
    const { host, execute } = createHost();
    const resourceCoordinator = { acquire: vi.fn() } as unknown as NonNullable<ToolExecutionContext['resourceCoordinator']>;
    const registerToolImages = vi.fn() as unknown as NonNullable<ToolExecutionContext['registerToolImages']>;

    await runCodeModeScript(host, {
      ...INPUT,
      context: { toolCallId: 'call-1', tool: 'run_tool_script', approvalHandled: true, resourceCoordinator, registerToolImages, peerAutomatic: true },
    }, sandbox(async (call) => {
      await call([{ tool: 'write_file', args: { path: 'a.ts', contents: 'x' } }]);
      return {};
    }));

    const context = (execute.mock.calls[0] as ExecuteArgs)[2];
    expect(context).toEqual({ resourceCoordinator, registerToolImages, peerAutomatic: true, parentToolCallId: 'call-1', modelVisible: false });
    expect(context).not.toHaveProperty('approvalHandled');
    expect(context).not.toHaveProperty('toolCallId');
    expect(context).not.toHaveProperty('tool');
  });

  it('gives the script successes and ordinary failures as values', async () => {
    const { host } = createHost((call) => call.tool === 'run_command'
      ? { tool: call.tool, success: false, kind: 'command', error: 'exit 1', output: 'stderr text', exitCode: 1 }
      : { tool: call.tool, success: true, output: 'file body' });
    let seen: SandboxToolOutcome[] = [];

    const outcome = await runCodeModeScript(host, INPUT, sandbox(async (call) => {
      seen = await call([{ tool: 'read_file', args: { path: 'a.ts' } }, { tool: 'run_command', args: { command: 'false' } }]);
      return { result: '"done"' };
    }));

    expect(seen).toEqual([
      { ok: true, output: 'file body' },
      { ok: false, error: 'exit 1', kind: 'command', output: 'stderr text' },
    ]);
    expect(outcome.success).toBe(true);
  });

  it('refuses a tool the script may not call without reaching the tool manager', async () => {
    const { host, execute } = createHost();
    let seen: SandboxToolOutcome[] = [];

    await runCodeModeScript(host, INPUT, sandbox(async (call) => {
      seen = await call([{ tool: 'delegate_task', args: {} }, { tool: 'read_file', args: { path: 'a.ts' } }]);
      return {};
    }));

    expect(seen[0]).toMatchObject({ ok: false, kind: 'authorization' });
    expect(seen[1]).toEqual({ ok: true, output: 'read_file ok' });
    expect((execute.mock.calls[0] as ExecuteArgs)[0]).toEqual([{ id: 'call-1:1', tool: 'read_file', args: { path: 'a.ts' } }]);
  });

  it('rejects arguments that are not an object', async () => {
    const { host, execute } = createHost();
    let seen: SandboxToolOutcome[] = [];

    await runCodeModeScript(host, INPUT, sandbox(async (call) => {
      seen = await call([{ tool: 'read_file', args: 'a.ts' }, { tool: 'read_file', args: null }, { tool: 'read_file', args: ['a.ts'] }]);
      return {};
    }));

    expect(seen.every((outcome) => !outcome.ok && outcome.kind === 'validation')).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['a denied approval', { success: false, kind: 'authorization', error: 'Tool write_file was denied by the user.' }],
    ['a cancelled turn', { success: false, kind: 'aborted', error: 'Tool execution aborted.' }],
  ] as const)('stops the whole script on %s', async (_name, failure) => {
    const { host, execute } = createHost((call) => ({ tool: call.tool, ...failure }));

    const outcome = await runCodeModeScript(host, INPUT, sandbox(async (call) => {
      await call([{ tool: 'write_file', args: { path: 'a.ts', contents: 'x' } }]);
      await call([{ tool: 'write_file', args: { path: 'b.ts', contents: 'y' } }]);
      return {};
    }));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ success: false, kind: failure.kind });
    expect(outcome.success ? '' : outcome.error).toContain(failure.error);
  });

  it('returns a compact summary to the model: result, logs and call counts, never per-call output', async () => {
    const { host } = createHost((call) => call.tool === 'search'
      ? { tool: call.tool, success: false, kind: 'operational', error: 'rg failed' }
      : { tool: call.tool, success: true, output: 'SECRET FILE BODY' });

    const outcome = await runCodeModeScript(host, INPUT, sandbox(async (call) => {
      await call([{ tool: 'read_file', args: { path: 'a.ts' } }, { tool: 'read_file', args: { path: 'b.ts' } }, { tool: 'search', args: { query: 'x' } }]);
      return { result: '{"files":2}', logs: 'checked 2 files', durationMs: 42 };
    }));

    expect(outcome.success).toBe(true);
    const summary = JSON.parse(outcome.success ? outcome.output ?? '' : '') as Record<string, unknown>;
    expect(summary).toEqual({
      ok: true,
      result: { files: 2 },
      logs: 'checked 2 files',
      calls: { total: 3, failed: 1, byTool: { read_file: 2, search: 1 } },
      durationMs: 42,
    });
    expect(outcome.success ? outcome.output : '').not.toContain('SECRET FILE BODY');
  });

  it('keeps a truncated result as text instead of failing to parse it', async () => {
    const { host } = createHost();

    const outcome = await runCodeModeScript(host, INPUT, sandbox(async () => ({ result: '{"files":[1,2,… [truncated 9000 chars]' })));

    const summary = JSON.parse(outcome.success ? outcome.output ?? '' : '') as { result: unknown };
    expect(summary.result).toBe('{"files":[1,2,… [truncated 9000 chars]');
  });

  it.each([
    ['script', 'validation', 'ReferenceError: nope is not defined'],
    ['timeout', 'operational', 'Script exceeded its 60000 ms budget'],
    ['limit', 'validation', 'Script made more than 200 tool calls'],
    ['aborted', 'aborted', 'Turn cancelled'],
  ] as const)('reports a %s failure as a %s tool failure with the logs so far', async (errorKind, kind, error) => {
    const { host } = createHost();
    const runSandbox: SandboxRunner = async () => ({ ok: false, error, errorKind, logs: 'step 1 done', toolCalls: 0, durationMs: 7 });

    const outcome = await runCodeModeScript(host, INPUT, runSandbox);

    expect(outcome).toMatchObject({ success: false, kind, error });
    expect(outcome.success ? '' : outcome.output).toContain('step 1 done');
  });

  it('reports a failure of the sandbox itself as operational, not as the script\'s mistake', async () => {
    const { host } = createHost();
    const runSandbox: SandboxRunner = async () => ({ ok: false, error: 'QuickJS failed to instantiate', logs: '', toolCalls: 0, durationMs: 2 });

    const outcome = await runCodeModeScript(host, INPUT, runSandbox);

    expect(outcome).toMatchObject({ success: false, kind: 'operational', error: 'QuickJS failed to instantiate' });
  });

  it('turns a sandbox that throws into an operational failure', async () => {
    const { host } = createHost();

    const outcome = await runCodeModeScript(host, INPUT, async () => {
      throw new Error('wasm failed to load');
    });

    expect(outcome).toMatchObject({ success: false, kind: 'operational' });
    expect(outcome.success ? '' : outcome.error).toContain('wasm failed to load');
  });

  it('rejects an empty script before starting a sandbox', async () => {
    const { host } = createHost();
    const runSandbox = vi.fn(sandbox(async () => ({})));

    const outcome = await runCodeModeScript(host, { ...INPUT, script: '   ' }, runSandbox);

    expect(outcome).toMatchObject({ success: false, kind: 'validation' });
    expect(runSandbox).not.toHaveBeenCalled();
  });
});

describe('feature gating of the script tool', () => {
  const config = (codeMode?: boolean): LoadedConfig =>
    ({ configPath: '/tmp/config.json', provider: 'openrouter', ...(codeMode === undefined ? {} : { features: { codeMode } }) }) as LoadedConfig;

  it('adds the tool definition only while the feature is on', () => {
    expect(codeModeToolDefinitions(config())).toEqual([]);
    expect(codeModeToolDefinitions(config(false))).toEqual([]);
    expect(codeModeToolDefinitions(config(true)).map(({ name }) => name)).toEqual([CODE_MODE_TOOL_NAME]);
  });

  it('registers and unregisters the tool when the feature is toggled mid-session', () => {
    const toolManager = { register: vi.fn(), unregister: vi.fn() };

    syncCodeModeTool(toolManager, config(true));
    expect(toolManager.register).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: CODE_MODE_TOOL_NAME }));
    expect(toolManager.unregister).not.toHaveBeenCalled();

    syncCodeModeTool(toolManager, config(false));
    expect(toolManager.unregister).toHaveBeenCalledExactlyOnceWith(CODE_MODE_TOOL_NAME);
  });
});

