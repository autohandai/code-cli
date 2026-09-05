import type { ToolDefinition } from './toolManager.js';
import { HOOK_EVENTS } from './hookEvents.js';
import { getLifecycleHookInventory } from './hookEvents.js';
import type { AgentAction } from '../types.js';
import type { HookManager } from './HookManager.js';
import type { HookAuthoringService } from './HookAuthoringService.js';

export const HOOK_TOOL_NAMES = new Set(['list_hooks', 'create_hook', 'set_hook_enabled']);

type HookAction = Extract<AgentAction, { type: 'list_hooks' | 'create_hook' | 'set_hook_enabled' }>;

export function isHookAction(action: AgentAction): action is HookAction {
  return HOOK_TOOL_NAMES.has(action.type);
}

export async function executeHookTool(action: HookAction, context: {
  manager: HookManager;
  authoring: Pick<HookAuthoringService, 'create'>;
  getActiveProvider: () => string;
}, signal?: AbortSignal): Promise<string> {
  if (context.getActiveProvider() !== 'autohandai') throw new Error('Lifecycle hook tools are available only with the Autohand AI provider.');
  const { manager } = context;
  if (action.type === 'list_hooks') {
    const hooks = manager.getHooks();
    return JSON.stringify({ enabled: manager.isEnabled(), events: getLifecycleHookInventory(manager),
      configHooks: hooks.map(hook => ({ ...hook, index: hooks.filter(candidate => candidate.event === hook.event).indexOf(hook) })),
    });
  }
  if (action.type === 'create_hook') return JSON.stringify(await context.authoring.create(action, signal));
  if (!Number.isInteger(action.index) || action.index < 0) throw new Error('Hook index must be a non-negative integer.');
  if (!await manager.setHookEnabled(action.event, action.index, action.enabled)) {
    throw new Error('Config hook not found. Call list_hooks for current indexes.');
  }
  return JSON.stringify({ event: action.event, index: action.index, enabled: action.enabled, active: action.enabled && manager.isEnabled() });
}

export const HOOK_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'list_hooks',
    description: 'List Autohand lifecycle events, installed and active counts, config hooks and enabled plugin hooks. Use when the user asks about lifecycle automation.',
  },
  {
    name: 'create_hook',
    description: 'Create a lifecycle hook from a plain-English request ONLY when the user asks for persistent automation. Generates a workspace-scoped Node.js script, reviews it with the user, and saves the hook. Never run the script to test it automatically. Autohand AI only.',
    parameters: { type: 'object', properties: {
      prompt: { type: 'string', description: 'The user-requested trigger and script behavior in plain English.' },
      event: { type: 'string', description: 'Optional lifecycle event; otherwise infer it from the request.', enum: HOOK_EVENTS },
    }, required: ['prompt'] },
  },
  {
    name: 'set_hook_enabled',
    description: 'Enable or disable one config hook when explicitly requested. Obtain its event and zero-based index from list_hooks. Plugin hooks are managed with /extensions. Autohand AI only.',
    parameters: { type: 'object', properties: {
      event: { type: 'string', description: 'Exact config event returned by list_hooks.', enum: HOOK_EVENTS },
      index: { type: 'number', description: 'Zero-based index within config hooks for this exact event.' },
      enabled: { type: 'boolean', description: 'Whether the hook should be enabled.' },
    }, required: ['event', 'index', 'enabled'] },
    requiresApproval: true,
  },
];
