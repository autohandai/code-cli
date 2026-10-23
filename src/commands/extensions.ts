/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SlashCommand } from '../core/slashCommandTypes.js';
import type { ExtensionService } from '../extensions/ExtensionService.js';
import { runExtensionsCommand } from '../extensions/cli.js';

export interface ExtensionsCommandContext {
  extensionService?: ExtensionService;
  refreshDynamicExtensions?: (options?: { force?: boolean }) => Promise<void>;
  isNonInteractive?: boolean;
}

export async function extensions(
  context: ExtensionsCommandContext,
  args: string[] = [],
): Promise<string> {
  if (!context.extensionService) {
    return 'Extensions service not available.';
  }
  if (args[0] === 'reload') {
    if (args.length !== 1) return 'Usage: /extensions reload';
    if (!context.refreshDynamicExtensions) return 'Extension reload is unavailable in this session.';
    await context.refreshDynamicExtensions({ force: true });
    return 'Extensions refreshed. Use /extensions doctor to inspect activation diagnostics.';
  }
  const result = await runExtensionsCommand({
    service: context.extensionService,
    stdinIsTTY: context.isNonInteractive !== true,
  }, args);
  if (result.mutated) {
    await context.refreshDynamicExtensions?.();
  }
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
    return `${result.output}\n  /extensions reload  Reload extensions in this running session`;
  }
  return result.output;
}

export const metadata: SlashCommand = {
  command: '/extensions',
  description: 'validate, install, inspect, and manage Code extensions',
  implemented: true,
  subcommands: [
    { name: 'list', description: 'List installed extensions' },
    { name: 'show', description: 'Inspect an installed extension' },
    { name: 'validate', description: 'Validate a local extension package' },
    { name: 'install', description: 'Install a local extension package' },
    { name: 'enable', description: 'Enable an installed extension' },
    { name: 'disable', description: 'Disable an installed extension' },
    { name: 'remove', description: 'Remove an installed extension' },
    { name: 'reload', description: 'Reload extensions in this running session' },
    { name: 'doctor', description: 'Diagnose extension packages' },
  ],
};
