/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { safePrompt } from '../utils/prompt.js';
import type { HookManager } from '../core/HookManager.js';
import type { HookEvent, HookDefinition } from '../types.js';

export interface HooksCommandContext {
  hookManager: HookManager;
}

const HOOK_EVENTS: HookEvent[] = [
  'session-start',
  'session-end',
  'pre-prompt',
  'pre-tool',
  'post-tool',
  'file-modified',
  'stop',
  'subagent-stop',
  'permission-request',
  'notification',
  'session-error',
  // Auto-mode events
  'automode:start',
  'automode:iteration',
  'automode:checkpoint',
  'automode:pause',
  'automode:resume',
  'automode:cancel',
  'automode:complete',
  'automode:error',
];

// Event descriptions for better UX
const EVENT_DESCRIPTIONS: Record<HookEvent, string> = {
  'session-start': 'When a session begins',
  'session-end': 'When a session ends',
  'pre-prompt': 'Before processing user input',
  'pre-tool': 'Before a tool executes',
  'post-tool': 'After a tool completes',
  'file-modified': 'When files are changed',
  'stop': 'When a turn completes',
  'post-response': 'When a turn completes (alias)',
  'subagent-stop': 'When a subagent finishes',
  'permission-request': 'When permission is requested',
  'notification': 'When notifications are shown',
  'session-error': 'When an error occurs',
  // Auto-mode events
  'automode:start': 'When auto-mode loop starts',
  'automode:iteration': 'Each auto-mode iteration',
  'automode:checkpoint': 'When auto-mode creates a checkpoint',
  'automode:pause': 'When auto-mode is paused',
  'automode:resume': 'When auto-mode is resumed',
  'automode:cancel': 'When auto-mode is cancelled',
  'automode:complete': 'When auto-mode completes',
  'automode:error': 'When auto-mode encounters an error',
};

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
    'permission-request': '🔐',
    'notification': '🔔',
    'subagent-stop': '🤖',
    'pre-prompt': '💭',
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
  console.log(chalk.bold.cyan('⚡ Hooks'));
  console.log(chalk.gray('  Lifecycle hooks run shell commands on events'));
  console.log();

  if (allHooks.length === 0) {
    console.log(chalk.gray('  No hooks configured.'));
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
    'subagent-stop': '🤖',
    'permission-request': '🔐',
    'notification': '🔔',
    'session-error': '❌',
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
export async function hooks(ctx: HooksCommandContext): Promise<string | null> {
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
 * Toggle multiple hooks with a multi-select checkbox UI
 */
async function toggleHooksMulti(manager: HookManager, allHooks: HookDefinition[]): Promise<void> {
  // Build choices with current state
  const choices = allHooks.map((h, i) => {
    const eventTag = chalk.dim(`[${h.event}]`);
    const desc = h.description || getShortCommand(h.command);
    return {
      name: String(i),
      message: `${eventTag} ${desc}`,
      value: String(i),
      enabled: h.enabled !== false,
    };
  });

  const result = await safePrompt<{ selected: string[] }>({
    type: 'multiselect',
    name: 'selected',
    message: 'Toggle hooks (space to select, enter to confirm)',
    choices,
    initial: choices.filter(c => c.enabled).map(c => c.name),
  });

  if (!result) return;

  const selectedSet = new Set(result.selected);
  let changed = 0;

  // Update each hook based on selection
  for (let i = 0; i < allHooks.length; i++) {
    const hook = allHooks[i];
    const shouldBeEnabled = selectedSet.has(String(i));
    const currentlyEnabled = hook.enabled !== false;

    if (shouldBeEnabled !== currentlyEnabled) {
      const eventHooks = allHooks.filter(h => h.event === hook.event);
      const eventIndex = eventHooks.indexOf(hook);
      await manager.toggleHook(hook.event, eventIndex);
      changed++;
    }
  }

  if (changed > 0) {
    console.log(chalk.green(`  ✓ Updated ${changed} hook(s)`));
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
  description: 'view and manage lifecycle hooks',
  implemented: true
};
