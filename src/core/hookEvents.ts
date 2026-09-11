import type { HookEvent, HookDefinition, HookEventName } from '../types.js';
import type { HookManager } from './HookManager.js';
import { resolveHookEvents } from './legacyHookEvents.js';

export const HOOK_EVENTS: HookEvent[] = [
  'session-start',
  'session-end',
  'pre-clear',
  'pre-prompt',
  'pre-tool',
  'post-tool',
  'file-modified',
  'stop',
  'post-response',
  'subagent-start',
  'subagent-progress',
  'subagent-message',
  'subagent-cancel-requested',
  'subagent-stop',
  'permission-request',
  'permission-denied',
  'notification',
  'session-error',
  'rate-limit',
  // Auto-mode events
  'automode:start',
  'automode:iteration',
  'automode:checkpoint',
  'automode:pause',
  'automode:resume',
  'automode:cancel',
  'automode:complete',
  'automode:error',
  // Auto-research events
  'autoresearch:start',
  'autoresearch:pause',
  'autoresearch:init',
  'autoresearch:before',
  'autoresearch:run',
  'autoresearch:after',
  'autoresearch:log',
  'autoresearch:decision',
  'autoresearch:replay',
  'autoresearch:rescore',
  'autoresearch:prune',
  'autoresearch:complete',
  'autoresearch:error',
  // Learn events
  'pre-learn',
  'post-learn',
  // Goal authoring events
  'goal-written:completed',
  // Team events
  'team-created',
  'teammate-spawned',
  'teammate-idle',
  'task-assigned',
  'task-completed',
  'team-shutdown',
  // Review events
  'review:start',
  'review:end',
  'review:paused',
  'review:failed',
  'review:completed',
  // Mode events
  'mode-change',
  // Context lifecycle events
  'context:compact',
  'context:overflow',
  'context:warning',
  'context:critical',
];

// Event descriptions for better UX
export const EVENT_DESCRIPTIONS: Record<HookEvent, string> = {
  'session-start': 'When a session begins',
  'session-end': 'When a session ends',
  'pre-clear': 'Before memory extraction on /clear or /new',
  'pre-prompt': 'Before processing user input',
  'pre-tool': 'Before a tool executes',
  'post-tool': 'After a tool completes',
  'file-modified': 'When files are changed',
  'stop': 'When a turn completes',
  'post-response': 'When a turn completes (alias)',
  'subagent-start': 'When a subagent starts; can queue context or stop that run',
  'subagent-progress': 'When a subagent changes activity; can queue context or stop that run',
  'subagent-message': 'When a message is queued for a subagent',
  'subagent-cancel-requested': 'When cancellation is requested for a subagent',
  'subagent-stop': 'When a subagent finishes',
  'permission-request': 'When permission is requested',
  'permission-denied': 'When a permission request is refused',
  'notification': 'When notifications are shown',
  'session-error': 'When an error occurs',
  'rate-limit': 'When a provider rate limit ends the turn (no retry)',
  // Auto-mode events
  'automode:start': 'When auto-mode loop starts',
  'automode:iteration': 'Each auto-mode iteration',
  'automode:checkpoint': 'When auto-mode creates a checkpoint',
  'automode:pause': 'When auto-mode is paused',
  'automode:resume': 'When auto-mode is resumed',
  'automode:cancel': 'When auto-mode is cancelled',
  'automode:complete': 'When auto-mode completes',
  'automode:error': 'When auto-mode encounters an error',
  // Auto-research events
  'autoresearch:start': 'When an auto-research session starts or resumes',
  'autoresearch:pause': 'When an auto-research session is paused',
  'autoresearch:init': 'When init_experiment configures the session',
  'autoresearch:before': 'Before run_experiment starts an iteration',
  'autoresearch:run': 'When run_experiment executes the benchmark',
  'autoresearch:after': 'After run_experiment finishes an iteration',
  'autoresearch:log': 'When log_experiment records a result',
  'autoresearch:decision': 'When the deterministic experiment decision is persisted',
  'autoresearch:replay': 'When an isolated candidate replay completes',
  'autoresearch:rescore': 'When stored measurements are rescored with the current policy',
  'autoresearch:prune': 'When artifact retention is previewed or applied',
  'autoresearch:complete': 'When the auto-research loop completes',
  'autoresearch:error': 'When auto-research encounters an error',
  // Learn events
  'pre-learn': 'Before a learn operation begins',
  'post-learn': 'After a learn operation completes',
  // Goal authoring events
  'goal-written:completed': 'After a goal objective is created',
  // Team events
  'team-created': 'When a team is created',
  'teammate-spawned': 'When a teammate process starts',
  'teammate-idle': 'When a teammate becomes idle',
  'task-assigned': 'When a task is assigned to a teammate',
  'task-completed': 'When a task is marked as done',
  'team-shutdown': 'When team cleanup completes',
  // Review events
  'review:start': 'When a code review begins',
  'review:end': 'When a code review session ends',
  'review:paused': 'When a code review is paused',
  'review:failed': 'When a code review encounters an error',
  'review:completed': 'When a code review finishes successfully',
  // Mode events
  'mode-change': 'When permission mode changes (unrestricted, yolo, etc.)',
  // Context lifecycle events
  'context:compact': 'When context is compacted (messages removed/summarized)',
  'context:overflow': 'When context overflow is detected (API 400 error)',
  'context:warning': 'When context usage crosses warning threshold (80%)',
  'context:critical': 'When context usage crosses critical threshold (90%+)',
};

export interface LifecycleHookEntry {
  source: string;
  definition?: HookDefinition;
  enabled: boolean;
}

export interface LifecycleHookRow {
  event: HookEvent;
  description: string;
  installed: number;
  active: number;
  hooks: LifecycleHookEntry[];
}

/**
 * Stable identity for a hook definition, used to deduplicate hooks across
 * config layers (global config, project config, project local settings) and
 * against the built-in defaults. Script-based hooks are keyed by script file
 * name; inline commands by event plus description, or event plus command.
 */
export function hookIdentifier(hook: HookDefinition): string {
  const scriptMatch = hook.command.match(/([^/]+\.sh)$/);
  if (scriptMatch) {
    return `script:${scriptMatch[1]}`;
  }
  if (hook.description) {
    return `${hook.event}:${hook.description}`;
  }
  return `${hook.event}:${hook.command}`;
}

export function canonicalHookEvent(event: HookEventName): HookEvent {
  return resolveHookEvents(event)[0];
}

export function getLifecycleHookInventory(manager: HookManager): LifecycleHookRow[] {
  return HOOK_EVENTS.filter(event => event !== 'post-response').map(event => {
    const hooks: LifecycleHookEntry[] = [
      ...manager.getHooks().filter(hook => resolveHookEvents(hook.event).includes(event))
        .map(definition => ({ source: 'config', definition, enabled: definition.enabled !== false })),
      ...manager.getExtensionHooks().filter(hook => canonicalHookEvent(hook.event) === event)
        .map(hook => ({ source: hook.extensionId, enabled: true })),
    ];
    return { event, description: EVENT_DESCRIPTIONS[event], hooks, installed: hooks.length,
      active: manager.isEnabled() ? hooks.filter(hook => hook.enabled).length : 0 };
  });
}
