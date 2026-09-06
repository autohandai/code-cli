import path from 'node:path';
import type { HookContext } from './HookManager.js';
import type { HookDefinition, HookResponse, ImportedHookOrigin } from '../types.js';

const CLAUDE_TOOLS: Readonly<Record<string, string>> = {
  run_command: 'Bash', shell: 'Bash', read_file: 'Read', write_file: 'Write',
  append_file: 'Write', search_replace: 'Edit', apply_patch: 'Edit',
  glob: 'Glob', search: 'Grep', search_code: 'Grep', grep: 'Grep',
  web_search: 'WebSearch', fetch_url: 'WebFetch', delegate_task: 'Agent', ask_followup_question: 'AskUserQuestion', fff_grep: 'Grep', fff_find: 'Glob',
};
const CURSOR_TOOLS: Readonly<Record<string, string>> = {
  run_command: 'Shell', shell: 'Shell', read_file: 'Read', write_file: 'Write',
  append_file: 'Write', search_replace: 'Write', apply_patch: 'Write',
  search: 'Grep', search_code: 'Grep', grep: 'Grep', delete_path: 'Delete', delegate_task: 'Task', fff_grep: 'Grep',
};
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function string(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function toolName(origin: ImportedHookOrigin, context: HookContext): string {
  const tool = context.tool ?? '';
  if (origin.source === 'cursor') return CURSOR_TOOLS[tool] ?? (tool.startsWith('mcp__') ? `MCP:${tool.slice(5)}` : tool);
  if (origin.source === 'claude') return CLAUDE_TOOLS[tool] ?? tool;
  if (origin.source === 'codex' && ['run_command', 'shell'].includes(tool)) return 'Bash';
  return tool;
}
function shellCommand(context: HookContext): string {
  const args = context.args ?? {};
  const command = string(args.command) ?? context.command ?? '';
  const quote = (value: string): string => /^[\w./:=+-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
  return [command, ...(Array.isArray(args.args) ? args.args.filter((arg): arg is string => typeof arg === 'string').map(quote) : [])].join(' ');
}
function toolInput(context: HookContext): Record<string, unknown> {
  const args = context.args ?? {};
  const filePath = string(args.path) ?? context.path;
  return {
    ...args,
    ...(filePath ? { file_path: path.resolve(context.workspace, filePath) } : {}),
    ...(typeof args.contents === 'string' ? { content: args.contents } : {}),
    ...(['run_command', 'shell'].includes(context.tool ?? '') ? { command: shellCommand(context) } : {}),
  };
}

export function matchesImportedHook(hook: HookDefinition, context: HookContext): boolean {
  const origin = hook.importedFrom;
  if (!origin) return true;
  if (origin.workspaceRoot && path.resolve(origin.workspaceRoot) !== path.resolve(context.workspace)) return false;
  if (origin.event.toLowerCase().includes('shell') && !['run_command', 'shell'].includes(context.tool ?? '')) return false;
  if (origin.event.toLowerCase().endsWith('failure') && context.success !== false) return false;
  if (['PostToolUse', 'postToolUse', 'afterShellExecution'].includes(origin.event)
    && origin.source !== 'codex' && context.success === false) return false;
  if (!hook.matcher || hook.matcher === '*') return true;
  let values: string[];
  if (origin.event === 'beforeShellExecution') values = [shellCommand(context)];
  else if (['pre-tool', 'post-tool', 'permission-request'].includes(context.event)) {
    values = [toolName(origin, context)];
    if (origin.source === 'codex' && context.tool === 'apply_patch') values.push('Edit', 'Write');
    if (origin.source === 'grok') values.push(CLAUDE_TOOLS[context.tool ?? ''] ?? context.tool ?? '');
  } else if (context.event === 'session-start') values = [context.sessionType ?? 'startup'];
  else if (context.event === 'session-end') values = [origin.source === 'codex' ? 'other' : context.sessionEndReason ?? 'exit'];
  else if (context.event === 'notification') values = [context.notificationType ?? ''];
  else if (context.event === 'context:compact') values = [context.reason === 'manual' ? 'manual' : 'auto'];
  else return true;
  try { return values.some(value => new RegExp(hook.matcher!).test(value)); } catch { return false; }
}

export function importedHookInput(origin: ImportedHookOrigin, context: HookContext): Record<string, unknown> {
  const input = toolInput(context);
  if (origin.source === 'grok') return {
    hookEventName: origin.event, sessionId: context.sessionId, cwd: context.workspace,
    workspaceRoot: context.workspace, toolName: toolName(origin, context), toolInput: input,
    toolOutput: context.output, error: context.error, prompt: context.instruction,
  };
  return {
    session_id: context.sessionId, transcript_path: null, cwd: context.workspace,
    hook_event_name: origin.event, model: context.model,
    tool_name: toolName(origin, context), tool_input: input, tool_use_id: context.toolCallId,
    tool_response: context.output, prompt: context.instruction,
    source: context.sessionType, reason: origin.source === 'codex' ? 'other' : context.sessionEndReason,
    notification_type: context.notificationType, message: context.notificationMessage,
    trigger: context.reason === 'manual' ? 'manual' : 'auto', compact_summary: context.summary,
    error: context.error ?? (context.success === false ? context.output : undefined),
    ...(origin.source === 'cursor' ? {
      conversation_id: context.sessionId, generation_id: context.toolCallId,
      workspace_roots: [context.workspace, ...(context.additionalWorkspaces ?? [])],
      command: shellCommand(context), output: context.output, duration: context.duration,
      error_message: context.error ?? context.output, failure_type: 'error', is_interrupt: false,
    } : {}),
  };
}

export function importedHookEnvironment(origin: ImportedHookOrigin, context: HookContext): Record<string, string> {
  if (origin.source === 'grok') return {
    GROK_HOOK_EVENT: origin.event, GROK_HOOK_NAME: origin.event,
    GROK_SESSION_ID: context.sessionId ?? '', GROK_WORKSPACE_ROOT: context.workspace,
  };
  if (origin.source === 'claude' || origin.source === 'codex') return { CLAUDE_PROJECT_DIR: context.workspace };
  return {};
}

export function importedHookResponse(origin: ImportedHookOrigin, stdout: string, context: HookContext): HookResponse | undefined {
  if (origin.source === 'grok' && context.event !== 'pre-tool') return {};
  let data: unknown;
  try { data = JSON.parse(stdout); } catch {
    return context.event === 'pre-prompt' && origin.source !== 'cursor' && origin.source !== 'grok' && stdout.trim()
      ? { additionalContext: stdout.trim() } : undefined;
  }
  if (!record(data)) return undefined;
  if (origin.source === 'grok') return data.decision === 'deny' ? { decision: 'deny', reason: string(data.reason) } : {};
  const specific = record(data.hookSpecificOutput) ? data.hookSpecificOutput : {};
  const permission = record(specific.decision) ? specific.decision : {};
  const decision = permission.behavior ?? specific.permissionDecision ?? data.permission ?? data.decision;
  const response: HookResponse = {
    ...(decision === 'allow' || decision === 'deny' || decision === 'ask' || decision === 'block' ? { decision } : {}),
    reason: string(permission.message) ?? string(specific.permissionDecisionReason) ?? string(data.reason) ?? string(data.user_message),
    additionalContext: string(specific.additionalContext) ?? string(data.additionalContext) ?? string(data.additional_context) ?? string(data.agent_message),
    ...(typeof data.continue === 'boolean' ? { continue: data.continue } : {}),
    stopReason: string(data.stopReason),
  };
  if (permission.updatedPermissions !== undefined || permission.interrupt !== undefined) {
    response.decision = 'deny';
    response.reason = 'Imported permission changes require manual porting.';
  }
  const updated = permission.updatedInput ?? specific.updatedInput ?? data.updatedInput;
  if (record(updated)) {
    const input = { ...updated };
    if (typeof input.content === 'string' && context.args?.contents !== undefined) input.contents = input.content;
    if (typeof input.file_path === 'string') { input.path = input.file_path; delete input.file_path; }
    if (['run_command', 'shell'].includes(context.tool ?? '') && typeof input.command === 'string') input.args = [];
    if ((origin.source === 'codex' && context.event === 'permission-request') || context.tool === 'search_replace' || context.tool === 'apply_patch') {
      response.decision = 'deny';
      response.reason = 'Imported hook input rewriting for patch/edit tools requires manual porting.';
    } else response.updatedInput = { ...context.args, ...input };
  }
  return response;
}
