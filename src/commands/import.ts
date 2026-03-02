/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { t } from '../i18n/index.js';
import type { SlashCommand } from '../core/slashCommands.js';
import type { ImportSource } from '../import/types.js';

export const metadata: SlashCommand = {
  command: '/import',
  description: t('commands.import.description') || 'Import data from other coding agents',
  implemented: true,
};

export async function execute(args: string[]): Promise<string | null> {
  const { runImport } = await import('../import/index.js');
  const source = args[0] as ImportSource | undefined;
  const flags = args.slice(1);
  const all = flags.includes('--all');
  const dryRun = flags.includes('--dry-run');

  await runImport({ source, all, dryRun });
  return null;
}
