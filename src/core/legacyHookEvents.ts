/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { HookContext } from './HookManager.js';
import type { HookDefinition, HookEvent, HookEventName, HooksSettings, LegacyHookEvent } from '../types.js';

const COMMAND_TOOLS = new Set(['run_command', 'shell', 'custom_command']);

interface LegacyHookAlias {
  /** Real lifecycle events the legacy name listens to. */
  events: HookEvent[];
  /** Extra condition the context must satisfy, when the legacy name was narrower than the event. */
  when?: (context: HookContext) => boolean;
}

/**
 * Event names from the original hooks documentation, mapped onto the lifecycle
 * events the runtime actually emits. Kept so older configurations keep firing.
 */
export const LEGACY_HOOK_EVENT_ALIASES: Readonly<Record<LegacyHookEvent, LegacyHookAlias>> = {
  on_session_start: { events: ['session-start'] },
  on_session_end: { events: ['session-end'] },
  on_session_resume: { events: ['session-start'], when: (context) => context.sessionType === 'resume' },
  before_tool_call: { events: ['pre-tool'] },
  after_tool_call: { events: ['post-tool'] },
  on_tool_error: { events: ['post-tool'], when: (context) => context.success === false },
  on_file_change: { events: ['file-modified'] },
  on_file_create: { events: ['file-modified'], when: (context) => context.changeType === 'create' },
  on_file_delete: { events: ['file-modified'], when: (context) => context.changeType === 'delete' },
  on_file_read: { events: ['post-tool'], when: (context) => context.tool === 'read_file' },
  before_command: { events: ['pre-tool'], when: (context) => COMMAND_TOOLS.has(context.tool ?? '') },
  after_command: { events: ['post-tool'], when: (context) => COMMAND_TOOLS.has(context.tool ?? '') },
  on_user_message: { events: ['pre-prompt'] },
  on_agent_response: { events: ['stop'] },
  on_error: { events: ['session-error'] },
  on_permission_denied: { events: ['permission-denied'] },
  on_automode_start: { events: ['automode:start'] },
  on_automode_stop: { events: ['automode:complete', 'automode:cancel', 'automode:error'] },
  on_automode_iteration: { events: ['automode:iteration'] },
  on_subagent_start: { events: ['subagent-start'] },
  on_subagent_stop: { events: ['subagent-stop'] },
  on_permission_request: { events: ['permission-request'] },
  on_notification: { events: ['notification'] },
};

export const LEGACY_HOOK_EVENTS = Object.keys(LEGACY_HOOK_EVENT_ALIASES) as LegacyHookEvent[];

export function isLegacyHookEvent(name: string): name is LegacyHookEvent {
  return Object.prototype.hasOwnProperty.call(LEGACY_HOOK_EVENT_ALIASES, name);
}

/** Real events a configured hook name listens to; `post-response` is the older alias for `stop`. */
export function resolveHookEvents(name: HookEventName): HookEvent[] {
  if (isLegacyHookEvent(name)) return LEGACY_HOOK_EVENT_ALIASES[name].events;
  return [name === 'post-response' ? 'stop' : name];
}

/** Whether a hook configured under `name` should run for this context. */
export function legacyHookMatches(name: HookEventName, context: HookContext): boolean {
  if (!isLegacyHookEvent(name)) return true;
  const alias = LEGACY_HOOK_EVENT_ALIASES[name];
  return alias.events.includes(context.event) && (alias.when?.(context) ?? true);
}

type TemplateValue = string | number | boolean | undefined | null;

const TEMPLATE_VARIABLES: Readonly<Record<string, (context: HookContext) => TemplateValue>> = {
  file: (context) => context.path,
  path: (context) => context.path,
  action: (context) => context.changeType ?? context.permissionType,
  tool: (context) => context.tool,
  args: (context) => (context.args ? JSON.stringify(context.args) : undefined),
  command: (context) => context.command ?? stringArg(context.args?.command),
  cwd: (context) => context.workspace,
  project: (context) => context.workspace,
  session_id: (context) => context.sessionId,
  timestamp: () => new Date().toISOString(),
  duration: (context) => context.duration ?? context.turnDuration ?? context.subagentDuration,
  result: (context) => context.output,
  output: (context) => context.output,
  exit_code: (context) => (context.success === undefined ? undefined : context.success ? 0 : 1),
  error: (context) => context.error ?? context.subagentError ?? context.reviewError,
  context: (context) => context.errorCode,
  message: (context) => context.instruction ?? context.notificationMessage ?? context.subagentMessage,
  response: (context) => context.output,
  tokens: (context) => context.tokensUsed,
  level: (context) => context.notificationType,
  resource: (context) => context.path,
  agent: (context) => context.subagentName ?? context.subagentType,
  task: (context) => context.subagentTask ?? context.automodePrompt,
  iteration: (context) => context.automodeIteration ?? context.autoresearchIteration,
  iterations: (context) => context.automodeIteration ?? context.autoresearchIteration,
  total: (context) => context.automodeMaxIterations ?? context.autoresearchMaxIterations,
  max_iterations: (context) => context.automodeMaxIterations ?? context.autoresearchMaxIterations,
  reason: (context) => context.automodeCancelReason ?? context.reason ?? context.sessionEndReason,
};

function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

const SAFE_SHELL_WORD = /^[A-Za-z0-9_./:@%+=,-]+$/;

function shellWord(value: TemplateValue): string {
  if (value === undefined || value === null) return '';
  const text = String(value);
  if (text.length === 0) return "''";
  return SAFE_SHELL_WORD.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`;
}

/** Replace `{{variable}}` placeholders with shell-safe values from the context. */
export function renderHookCommandTemplate(command: string, context: HookContext): string {
  if (!command.includes('{{')) return command;
  return command.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_match, name: string) => {
    const resolve = TEMPLATE_VARIABLES[name];
    return resolve ? shellWord(resolve(context)) : '';
  });
}

const RESERVED_SETTINGS_KEYS = new Set(['enabled', 'hooks']);

function toDefinition(event: string, entry: unknown): HookDefinition | null {
  if (typeof entry === 'string') return entry.trim() ? { event: event as HookEventName, command: entry } : null;
  if (entry && typeof entry === 'object' && typeof (entry as { command?: unknown }).command === 'string') {
    return { ...(entry as Omit<HookDefinition, 'event'>), event: event as HookEventName };
  }
  return null;
}

/**
 * Accept the original event-keyed configuration shape
 * (`"hooks": { "on_file_change": ["eslint {{file}}"] }`) next to the array form.
 */
export function normalizeHooksSettings(settings: HooksSettings | undefined): HooksSettings | undefined {
  if (!settings) return settings;
  const raw = settings as Record<string, unknown>;
  const legacyKeys = Object.keys(raw).filter((key) => !RESERVED_SETTINGS_KEYS.has(key) && (Array.isArray(raw[key]) || typeof raw[key] === 'string'));
  if (legacyKeys.length === 0) return settings;

  const converted = legacyKeys.flatMap((event) => {
    const entries = Array.isArray(raw[event]) ? (raw[event] as unknown[]) : [raw[event]];
    return entries.map((entry) => toDefinition(event, entry)).filter((definition): definition is HookDefinition => definition !== null);
  });
  const normalized: HooksSettings = { hooks: [...(settings.hooks ?? []), ...converted] };
  if (settings.enabled !== undefined) normalized.enabled = settings.enabled;
  return normalized;
}
