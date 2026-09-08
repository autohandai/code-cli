/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import { safePrompt } from '../utils/prompt.js';
import { showModal, showInput, type ModalOption, type ShowModalOptions } from '../ui/ink/components/Modal.js';
import type { HookManager } from '../core/HookManager.js';
import type { HookAuthoringService } from '../core/HookAuthoringService.js';
import type { HookEvent, HookDefinition } from '../types.js';

export interface HooksCommandContext {
  hookManager: HookManager;
  authoring?: Pick<HookAuthoringService, 'create'>;
  isNonInteractive?: boolean;
}

import { HOOK_EVENTS, EVENT_DESCRIPTIONS, getLifecycleHookInventory, type LifecycleHookRow } from '../core/hookEvents.js';
export { HOOK_EVENTS } from '../core/hookEvents.js';

// Icons for built-in hooks (matched by script name or description keywords)
const HOOK_ICONS: Record<string, string> = {
  // Script-based hooks
  'sound-alert': '🔔',
  'auto-format': '🎨',
  'slack-notify': '💬',
  'git-auto-stage': '📦',
  'security-guard': '🛡️',
  'smart-commit': '🚀',
  // Description keywords
  'sound': '🔔',
  'format': '🎨',
  'slack': '💬',
  'notification': '💬',
  'git': '📦',
  'stage': '📦',
  'security': '🛡️',
  'guard': '🛡️',
  'block': '🛡️',
  'commit': '🚀',
  'log': '📝',
  'echo': '📝',
};

/**
 * Get an icon for a hook based on its command or description
 */
function getHookIcon(hook: HookDefinition): string {
  // Check script name first
  const scriptMatch = hook.command.match(/([^/]+)\.sh$/);
  if (scriptMatch) {
    const scriptName = scriptMatch[1];
    if (HOOK_ICONS[scriptName]) {
      return HOOK_ICONS[scriptName];
    }
  }

  // Check description keywords
  const text = `${hook.description || ''} ${hook.command}`.toLowerCase();
  for (const [keyword, icon] of Object.entries(HOOK_ICONS)) {
    if (text.includes(keyword)) {
      return icon;
    }
  }

  // Default icon based on event
  const eventIcons: Partial<Record<HookEvent, string>> = {
    'session-start': '▶️',
    'session-end': '⏹️',
    'pre-tool': '⚙️',
    'post-tool': '✅',
    'file-modified': '📄',
    'stop': '🏁',
    'session-error': '❌',
    'rate-limit': '🚦',
    'permission-request': '🔐',
    'notification': '🔔',
    'subagent-start': '▶',
    'subagent-progress': '↻',
    'subagent-message': '✉',
    'subagent-cancel-requested': '■',
    'subagent-stop': '🤖',
    'pre-prompt': '💭',
    'goal-written:completed': '🏁',
  };

  return eventIcons[hook.event] || '•';
}

/**
 * Format a hook as a checkbox list item
 */
function formatHookCheckbox(hook: HookDefinition): string {
  const checkbox = hook.enabled !== false ? chalk.green('☑') : chalk.gray('☐');
  const icon = getHookIcon(hook);
  const desc = hook.description || getShortCommand(hook.command);
  const asyncBadge = hook.async ? chalk.blue(' ⚡') : '';
  return `${checkbox} ${icon} ${desc}${asyncBadge}`;
}

/**
 * Get a short display name from a command
 */
function getShortCommand(command: string): string {
  // For script paths, extract just the filename
  const scriptMatch = command.match(/([^/]+\.sh)$/);
  if (scriptMatch) {
    return scriptMatch[1].replace('.sh', '').replace(/-/g, ' ');
  }
  // For inline commands, truncate
  return command.length > 35 ? command.slice(0, 32) + '...' : command;
}

/**
 * Display hooks in a clean checkbox list format
 */
function displayHooksList(allHooks: HookDefinition[]): void {
  console.log();
  console.log(chalk.bold.cyan(t('commands.hooks.title')));
  console.log(chalk.gray('  Lifecycle hooks run shell commands on events'));
  console.log();

  if (allHooks.length === 0) {
    console.log(chalk.gray(`  ${t('commands.hooks.noHooks')}`));
    console.log();
    return;
  }

  // Group hooks by event
  const hooksByEvent = new Map<HookEvent, HookDefinition[]>();
  for (const hook of allHooks) {
    const event = hook.event === 'post-response' ? 'stop' : hook.event;
    if (!hooksByEvent.has(event)) {
      hooksByEvent.set(event, []);
    }
    hooksByEvent.get(event)!.push(hook);
  }

  // Event icons for headers
  const eventHeaderIcons: Partial<Record<HookEvent, string>> = {
    'session-start': '▶️',
    'session-end': '⏹️',
    'pre-prompt': '💭',
    'pre-tool': '⚙️',
    'post-tool': '✅',
    'file-modified': '📄',
    'stop': '🏁',
    'subagent-start': '▶',
    'subagent-progress': '↻',
    'subagent-message': '✉',
    'subagent-cancel-requested': '■',
    'subagent-stop': '🤖',
    'permission-request': '🔐',
    'notification': '🔔',
    'session-error': '❌',
    'rate-limit': '🚦',
    // Review events
    'review:start': '🔍',
    'review:end': '📋',
    'review:paused': '⏸️',
    'review:failed': '❌',
    'review:completed': '✅',
  };

  // Display each event group
  for (const event of HOOK_EVENTS) {
    const eventHooks = hooksByEvent.get(event);
    if (!eventHooks || eventHooks.length === 0) continue;

    const enabledCount = eventHooks.filter(h => h.enabled !== false).length;
    const headerIcon = eventHeaderIcons[event] || '•';
    const eventLabel = chalk.bold(event);
    const countLabel = chalk.gray(`(${enabledCount}/${eventHooks.length})`);
    const eventDesc = chalk.dim(EVENT_DESCRIPTIONS[event] || '');

    console.log(`  ${headerIcon} ${eventLabel} ${countLabel}`);
    console.log(`     ${eventDesc}`);

    for (const hook of eventHooks) {
      console.log(`    ${formatHookCheckbox(hook)}`);
    }
    console.log();
  }
}

/**
 * Display summary stats
 */
function displaySummary(allHooks: HookDefinition[], globalEnabled: boolean): void {
  const totalHooks = allHooks.length;
  const enabledHooks = allHooks.filter(h => h.enabled !== false).length;

  const statusIcon = globalEnabled ? chalk.green('●') : chalk.red('●');
  const statusText = globalEnabled ? 'enabled' : 'disabled';

  console.log(chalk.gray('  ─'.repeat(25)));
  console.log(`  ${statusIcon} Hooks globally ${statusText}`);
  console.log(chalk.gray(`  ${enabledHooks} of ${totalHooks} hooks active`));
  console.log();
}

/**
 * Hooks command - displays and manages lifecycle hooks
 */
export function hookBrowserOptions(rows: LifecycleHookRow[], notice = '', initialIndex = 0, columns = process.stdout.columns ?? 100): ShowModalOptions {
  const wide = columns >= 96;
  const header = `      ${'Event'.padEnd(25)} ${'Installed'.padEnd(10)} ${'Active'.padEnd(8)}${wide ? 'Description' : ''}`;
  return {
    title: ['Hooks', 'Lifecycle hooks from config and enabled plugins.', notice].filter(Boolean).join('\n'),
    options: rows.map((row, index) => ({
      value: row.event,
      label: `${index < 9 ? ' ' : ''}${row.event.padEnd(25)} ${String(row.installed).padEnd(10)} ${String(row.active).padEnd(8)}${wide ? row.description.slice(0, Math.max(10, columns - 55)) : ''}`,
      ...(index === 0 ? { header } : {}),
      ...(!wide ? { description: row.description } : {}),
    })),
    initialIndex,
    maxVisible: Math.max(3, Math.min(16, Math.floor(((process.stdout.rows ?? 24) - 9) / (wide ? 1 : 2)))),
    hint: '↑/↓ navigate · Enter describe a hook · Esc close · /hooks manage for existing hooks',
  };
}

export async function hooks(ctx: HooksCommandContext, args = ''): Promise<string | null> {
  const command = args.trim();
  if (command === 'manage') return manageHooks(ctx);
  if (command === 'help') return '/hooks — browse lifecycle events and create scripts in plain English\n/hooks list — list all events and counts\n/hooks manage — toggle, test, remove, or manually add config hooks\nPlugin hooks are managed with /extensions. See docs/hooks.md.';
  if (command && command !== 'list') return 'Usage: /hooks [list|manage|help]';
  if (command === 'list' || ctx.isNonInteractive) {
    const rows = getLifecycleHookInventory(ctx.hookManager);
    return ['Hooks — Lifecycle hooks from config and enabled plugins.',
      'Event                     Installed  Active   Description',
      ...rows.map(row => `${row.event.padEnd(25)} ${String(row.installed).padEnd(10)} ${String(row.active).padEnd(8)} ${row.description}`),
    ].join('\n');
  }
  let notice = ctx.hookManager.isEnabled() ? '' : 'Hooks are globally disabled. Use /hooks manage to enable them.';
  let initialIndex = 0;
  while (true) {
    const rows = getLifecycleHookInventory(ctx.hookManager);
    const selected = await showModal(hookBrowserOptions(rows, notice, initialIndex));
    if (!selected) return null;
    const row = rows.find(item => item.event === selected.value);
    if (!row) return null;
    initialIndex = rows.indexOf(row);
    const installed = row.hooks.map(hook => `${hook.enabled ? 'on' : 'off'} · ${hook.source} · ${hook.definition?.description ?? hook.definition?.command ?? 'Plugin lifecycle handler'}`);
    if (!ctx.authoring) return 'Hook authoring is unavailable in this runtime. Use /hooks manage to add a shell command.';
    const prompt = await showInput({
      title: [`${row.event} — ${row.description}`, ...installed, '', 'Describe what this hook should do in plain English'].join('\n'),
      placeholder: 'For example: append the event and timestamp to hooks.log',
      validate: value => value.trim().length > 0 && value.length <= 8000 || 'Enter a request of 1–8000 characters.',
    });
    if (!prompt?.trim()) continue;
    try {
      console.log(chalk.dim(`Generating ${row.event} hook…`));
      const result = await ctx.authoring.create({ event: row.event, prompt });
      notice = result.status === 'created'
        ? `Created ${result.hook.event} hook${result.active ? '' : ' (globally disabled)'}. Script: ${result.scriptPath}`
        : 'Creation cancelled. No hook installed.';
    } catch (error) {
      notice = `Could not create hook: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

async function manageHooks(ctx: HooksCommandContext): Promise<string | null> {
  const manager = ctx.hookManager;
  const settings = manager.getSettings();
  const allHooks = manager.getHooks();

  displayHooksList(allHooks);
  displaySummary(allHooks, settings.enabled !== false);

  // Build menu choices
  const choices = [
    { name: 'done', message: chalk.gray('← Done') },
  ];

  if (allHooks.length > 0) {
    choices.push(
      { name: 'toggle', message: '☑ Toggle hooks on/off' },
      { name: 'test', message: '▶ Test a hook' },
      { name: 'remove', message: '✕ Remove a hook' },
    );
  }

  choices.push(
    { name: 'add', message: '+ Add a new hook' },
  );

  if (allHooks.length > 0) {
    const toggleLabel = settings.enabled !== false ? '◯ Disable all hooks' : '● Enable all hooks';
    choices.push({ name: 'toggle_global', message: toggleLabel });
  }

  const actionResult = await safePrompt<{ action: string }>({
    type: 'select',
    name: 'action',
    message: 'Action',
    choices
  });

  if (!actionResult || actionResult.action === 'done') {
    return null;
  }

  const { action } = actionResult;

  if (action === 'add') {
    await addHook(manager);
  } else if (action === 'toggle' && allHooks.length > 0) {
    await toggleHooksMulti(manager, allHooks);
  } else if (action === 'remove' && allHooks.length > 0) {
    await removeHook(manager, allHooks);
  } else if (action === 'test' && allHooks.length > 0) {
    await testHook(manager, allHooks);
  } else if (action === 'toggle_global') {
    const newEnabled = settings.enabled === false;
    await manager.updateSettings({ enabled: newEnabled });
    console.log(chalk.yellow(`  Hooks ${newEnabled ? 'enabled' : 'disabled'} globally.`));
  }

  return null;
}

/**
 * Toggle hooks with a multi-select checkbox UI.
 * Spacebar toggles each hook on/off; Enter confirms and exits.
 */
async function toggleHooksMulti(manager: HookManager, allHooks: HookDefinition[]): Promise<void> {
  const options: ModalOption[] = allHooks.map((h, i) => {
    const eventTag = `[${h.event}]`;
    const desc = h.description || getShortCommand(h.command);
    return {
      label: `${eventTag} ${desc}`,
      value: String(i),
      checked: h.enabled !== false,
    };
  });

  let toggleCount = 0;

  await showModal({
    title: 'Toggle hooks — spacebar to enable/disable',
    options,
    multiSelect: true,
    onToggle: async (option, _checked) => {
      const idx = parseInt(option.value, 10);
      const hook = allHooks[idx];
      if (!hook) return;
      const eventHooks = allHooks.filter(h => h.event === hook.event);
      const eventIndex = eventHooks.indexOf(hook);
      await manager.toggleHook(hook.event, eventIndex);
      toggleCount++;
    },
  });

  if (toggleCount > 0) {
    console.log(chalk.green(`  ✓ Toggled ${toggleCount} hook${toggleCount > 1 ? 's' : ''}`));
  } else {
    console.log(chalk.gray('  No changes made'));
  }
}

/**
 * Add a new hook
 */
async function addHook(manager: HookManager): Promise<void> {
  console.log();

  // Select event with descriptions
  const eventChoices = HOOK_EVENTS.map(e => ({
    name: e,
    message: `${e} ${chalk.dim(`- ${EVENT_DESCRIPTIONS[e]}`)}`
  }));

  const eventResult = await safePrompt<{ event: HookEvent }>({
    type: 'select',
    name: 'event',
    message: 'Event to hook into',
    choices: eventChoices
  });
  if (!eventResult) return;

  // Get command
  const commandResult = await safePrompt<{ command: string }>({
    type: 'input',
    name: 'command',
    message: 'Shell command to execute',
    validate: (val: unknown) => typeof val === 'string' && val.trim().length > 0 || 'Command is required'
  });
  if (!commandResult || !commandResult.command) return;

  // Get description
  const descResult = await safePrompt<{ description: string }>({
    type: 'input',
    name: 'description',
    message: 'Description (optional)'
  });

  // Async option
  const asyncResult = await safePrompt<{ async: boolean }>({
    type: 'confirm',
    name: 'async',
    message: 'Run asynchronously (non-blocking)?',
    initial: false
  });

  const hook: HookDefinition = {
    event: eventResult.event,
    command: commandResult.command,
    description: descResult?.description || undefined,
    enabled: true,
    async: asyncResult?.async || false
  };

  await manager.addHook(hook);
  console.log(chalk.green(`  ✓ Hook added for ${hook.event}`));
}

/**
 * Remove a hook
 */
async function removeHook(manager: HookManager, allHooks: HookDefinition[]): Promise<void> {
  const hookChoices = allHooks.map((h, i) => {
    const eventTag = chalk.dim(`[${h.event}]`);
    const desc = h.description || getShortCommand(h.command);
    return {
      name: String(i),
      message: `${eventTag} ${desc}`
    };
  });

  const selectResult = await safePrompt<{ hookIndex: string }>({
    type: 'select',
    name: 'hookIndex',
    message: 'Select hook to remove',
    choices: hookChoices
  });
  if (!selectResult) return;

  const idx = parseInt(selectResult.hookIndex, 10);
  const hook = allHooks[idx];
  const eventHooks = allHooks.filter(h => h.event === hook.event);
  const eventIndex = eventHooks.indexOf(hook);

  const desc = hook.description || getShortCommand(hook.command);
  const confirmResult = await safePrompt<{ confirm: boolean }>({
    type: 'confirm',
    name: 'confirm',
    message: `Remove "${desc}"?`,
    initial: false
  });
  if (!confirmResult?.confirm) return;

  const success = await manager.removeHook(hook.event, eventIndex);
  if (success) {
    console.log(chalk.yellow(`  ✓ Hook removed`));
  } else {
    console.log(chalk.red('  ✗ Failed to remove hook'));
  }
}

/**
 * Test a hook by running it with sample context
 */
async function testHook(manager: HookManager, allHooks: HookDefinition[]): Promise<void> {
  const hookChoices = allHooks.map((h, i) => {
    const eventTag = chalk.dim(`[${h.event}]`);
    const desc = h.description || getShortCommand(h.command);
    return {
      name: String(i),
      message: `${eventTag} ${desc}`
    };
  });

  const selectResult = await safePrompt<{ hookIndex: string }>({
    type: 'select',
    name: 'hookIndex',
    message: 'Select hook to test',
    choices: hookChoices
  });
  if (!selectResult) return;

  const idx = parseInt(selectResult.hookIndex, 10);
  const hook = allHooks[idx];

  console.log(chalk.gray('  Testing hook...'));
  const result = await manager.testHook(hook);

  if (result.success) {
    console.log(chalk.green(`  ✓ Completed in ${result.duration}ms`));
    if (result.stdout) {
      console.log(chalk.gray('  Output:'));
      result.stdout.split('\n').forEach(line => {
        console.log(chalk.gray(`    ${line}`));
      });
    }
  } else {
    console.log(chalk.red(`  ✗ Failed: ${result.error || 'unknown error'}`));
    if (result.stderr) {
      console.log(chalk.gray('  Error output:'));
      result.stderr.split('\n').forEach(line => {
        console.log(chalk.red(`    ${line}`));
      });
    }
  }
}

export const metadata = {
  command: '/hooks',
  description: t('commands.hooks.description'),
  implemented: true
};
