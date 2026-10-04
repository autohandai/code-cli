/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { COMPUTER_USE_TOOL_PREFIX } from '../../computer/computerUseOutput.js';
import type {
  SandboxRunOptions,
  SandboxRunResult,
  SandboxToolCall,
  SandboxToolOutcome,
} from '../codemode/QuickJsSandbox.js';
import { CODE_MODE_TOOL_NAME, isCodeModeEnabled } from '../codemode/feature.js';
import { getToolCategory, type ToolCategory } from '../toolFilter.js';
import { CODE_MODE_TOOL_DEFINITION, type ToolDefinition } from '../toolManager.js';
import type {
  LoadedConfig,
  ToolActionOutcome,
  ToolCallRequest,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolFailureKind,
} from '../../types.js';

export { CODE_MODE_TOOL_NAME };
export const CODE_MODE_DEFAULT_TIMEOUT_MS = 60_000;
export const CODE_MODE_MAX_TIMEOUT_MS = 300_000;

export type SandboxRunner = (options: SandboxRunOptions) => Promise<SandboxRunResult>;

/** The QuickJS runtime is loaded on the first script, never at startup. */
const runInQuickJs: SandboxRunner = async (options) =>
  (await import('../codemode/QuickJsSandbox.js')).runSandboxedScript(options);

export function codeModeToolDefinitions(config: LoadedConfig | null | undefined): ToolDefinition[] {
  return isCodeModeEnabled(config) ? [CODE_MODE_TOOL_DEFINITION] : [];
}

/** Applies a mid-session toggle of the `code_mode` feature to the live tool set. */
export function syncCodeModeTool(
  toolManager: { register(definition: ToolDefinition): void; unregister(name: ToolDefinition['name']): void },
  config: LoadedConfig | null | undefined,
): void {
  if (isCodeModeEnabled(config)) {
    toolManager.register(CODE_MODE_TOOL_DEFINITION);
  } else {
    toolManager.unregister(CODE_MODE_TOOL_NAME);
  }
}

/** The slice of ToolManager a script run needs: the one path every tool call takes. */
export interface CodeModeToolHost {
  execute(
    calls: ToolCallRequest[],
    onToolComplete: undefined,
    context: Omit<ToolExecutionContext, 'toolCallId'>,
  ): Promise<ToolExecutionResult[]>;
  listToolNames(): ToolCallRequest['tool'][];
}

export interface CodeModeRunInput {
  script: string;
  timeoutMs?: number;
  /** Id of the `run_tool_script` call; nested calls are numbered under it. */
  toolCallId: string;
  signal?: AbortSignal;
  /** Execution context of the `run_tool_script` call itself, inherited by its nested calls. */
  context?: ToolExecutionContext;
}

/**
 * A script can do what the model can do with its work tools, and nothing that
 * steers the session: no delegation, planning, questions, hook or tool
 * authoring, desktop control, or another script.
 */
const SCRIPT_CALLABLE_CATEGORIES: ReadonlySet<ToolCategory> = new Set([
  'read', 'write', 'create', 'delete', 'git_read', 'git_write', 'shell',
]);
const SCRIPT_CALLABLE_META_TOOLS: ReadonlySet<string> = new Set(['recall_memory']);

export function isScriptCallableTool(tool: string): boolean {
  if (tool.startsWith('mcp__')) {
    return !tool.startsWith(COMPUTER_USE_TOOL_PREFIX);
  }
  return SCRIPT_CALLABLE_CATEGORIES.has(getToolCategory(tool)) || SCRIPT_CALLABLE_META_TOOLS.has(tool);
}

function resolveTimeout(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested) || requested <= 0) {
    return CODE_MODE_DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.floor(requested), CODE_MODE_MAX_TIMEOUT_MS);
}

function isArgumentObject(value: unknown): value is NonNullable<ToolCallRequest['args']> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toOutcome(result: ToolExecutionResult): SandboxToolOutcome {
  if (result.success) {
    return { ok: true, output: result.output ?? '' };
  }
  return {
    ok: false,
    error: result.error,
    kind: result.kind,
    ...(result.output === undefined ? {} : { output: result.output }),
  };
}

/** A denial or a cancelled turn ends the script: it must not keep asking, or carry on around a "no". */
class ScriptStopped extends Error {
  constructor(readonly kind: ToolFailureKind, message: string) {
    super(message);
  }
}

const FAILURE_KINDS: Record<NonNullable<SandboxRunResult['errorKind']>, ToolFailureKind> = {
  script: 'validation',
  limit: 'validation',
  timeout: 'operational',
  aborted: 'aborted',
};

function parseResult(result: string | undefined): unknown {
  if (result === undefined) return null;
  try {
    return JSON.parse(result) as unknown;
  } catch {
    // A result cut at the size limit is no longer JSON; hand it over as the text it is.
    return result;
  }
}

/**
 * Runs a model-written script in the sandbox. The script holds no capability
 * of its own: every `tools.x()` call it makes is executed here through
 * ToolManager.execute, so it meets the same policy, plan-mode gate, hooks and
 * approval prompt as the same call made directly by the model.
 */
export async function runCodeModeScript(
  tools: CodeModeToolHost,
  input: CodeModeRunInput,
  runSandbox: SandboxRunner = runInQuickJs,
): Promise<ToolActionOutcome> {
  if (!input.script.trim()) {
    const error = 'run_tool_script requires a non-empty "script".';
    return { success: false, kind: 'validation', error, output: error };
  }

  // Nested calls keep the turn's coordination (peers, resources, image registry) but
  // not the script's own identity, and above all not its approval: each is authorized anew.
  const inherited: ToolExecutionContext = { ...input.context };
  delete inherited.toolCallId;
  delete inherited.tool;
  delete inherited.approvalHandled;
  const nestedContext: Omit<ToolExecutionContext, 'toolCallId'> = {
    ...inherited,
    ...(input.signal ? { signal: input.signal } : {}),
    parentToolCallId: input.toolCallId,
    modelVisible: false,
  };

  const callable = new Set(tools.listToolNames().filter(isScriptCallableTool));
  const byTool: Record<string, number> = {};
  let nested = 0;
  let failed = 0;
  let stopped: ScriptStopped | undefined;

  const executeToolCalls = async (calls: SandboxToolCall[]): Promise<SandboxToolOutcome[]> => {
    const outcomes: SandboxToolOutcome[] = new Array<SandboxToolOutcome>(calls.length);
    const batch: ToolCallRequest[] = [];
    const batchSlots: number[] = [];

    calls.forEach((call, slot) => {
      const id = `${input.toolCallId}:${nested++}`;
      byTool[call.tool] = (byTool[call.tool] ?? 0) + 1;
      if (!callable.has(call.tool as ToolCallRequest['tool'])) {
        outcomes[slot] = { ok: false, kind: 'authorization', error: `Tool "${call.tool}" cannot be called from a script.` };
      } else if (!isArgumentObject(call.args)) {
        outcomes[slot] = { ok: false, kind: 'validation', error: `Arguments for "${call.tool}" must be an object.` };
      } else {
        batch.push({ id, tool: call.tool as ToolCallRequest['tool'], args: call.args });
        batchSlots.push(slot);
      }
    });

    if (batch.length > 0) {
      const results = await tools.execute(batch, undefined, nestedContext);
      results.forEach((result, index) => {
        outcomes[batchSlots[index]] = toOutcome(result);
      });
      const blocking = results.find((result) => !result.success && (result.kind === 'authorization' || result.kind === 'aborted'));
      if (blocking && !blocking.success) {
        stopped = new ScriptStopped(blocking.kind, blocking.error);
        throw stopped;
      }
    }

    failed += outcomes.filter((outcome) => !outcome.ok).length;
    return outcomes;
  };

  let run: SandboxRunResult;
  try {
    run = await runSandbox({
      script: input.script,
      toolNames: [...callable],
      executeToolCalls,
      timeoutMs: resolveTimeout(input.timeoutMs),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    const message = `The script sandbox failed: ${error instanceof Error ? error.message : String(error)}`;
    return { success: false, kind: 'operational', error: message, output: message };
  }

  if (!run.ok) {
    const error = stopped?.message ?? run.error ?? 'The script failed.';
    return {
      success: false,
      // No errorKind means the sandbox failed, not the script.
      kind: stopped?.kind ?? (run.errorKind ? FAILURE_KINDS[run.errorKind] : 'operational'),
      error,
      output: run.logs ? `${error}\n\nLogs:\n${run.logs}` : error,
    };
  }

  return {
    success: true,
    output: JSON.stringify({
      ok: true,
      result: parseResult(run.result),
      logs: run.logs,
      calls: { total: nested, failed, byTool },
      durationMs: run.durationMs,
    }, null, 2),
  };
}
