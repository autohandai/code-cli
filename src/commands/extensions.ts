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
  refreshDynamicExtensions?: () => Promise<void>;
  isNonInteractive?: boolean;
}

export async function extensions(
  context: ExtensionsCommandContext,
  args: string[] = [],
): Promise<string> {
  if (!context.extensionService) {
    return 'Extensions service not available.';
  }
  const result = await runExtensionsCommand({
    service: context.extensionService,
    stdinIsTTY: context.isNonInteractive !== true,
  }, args);
  if (result.mutated) {
    await context.refreshDynamicExtensions?.();
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
    { name: 'doctor', description: 'Diagnose extension packages' },
  ],
};
