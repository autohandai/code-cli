/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { t } from '../i18n/index.js';
import type { SlashCommand } from '../core/slashCommands.js';
import { ALL_CATEGORIES, IMPORT_SOURCES, type ImportSource, type ImportCategory } from '../import/types.js';
import type { HookImportOptions } from '../import/HookImportService.js';

export const metadata: SlashCommand = {
  command: '/import',
  description: t('commands.import.description') || 'Import data from other coding agents',
  implemented: true,
};

export async function execute(args: string[], context: HookImportOptions = {}): Promise<string | null> {
  const { runImport } = await import('../import/index.js');
  let source: ImportSource | undefined;
  let categories: ImportCategory[] | undefined;
  let all = false;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--all') all = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--categories' || arg.startsWith('--categories=')) {
      const value = arg === '--categories' ? args[++i] : arg.slice('--categories='.length);
      if (!value) return 'Usage: /import [source] --categories hooks[,skills] [--dry-run]';
      const entries = value.split(',').map(entry => entry.trim());
      const invalid = entries.find(entry => !ALL_CATEGORIES.includes(entry as ImportCategory));
      if (invalid !== undefined) return `Unknown import category: ${invalid}`;
      categories = entries as ImportCategory[];
    } else if (!source && IMPORT_SOURCES.includes(arg as ImportSource)) source = arg as ImportSource;
    else return `Unknown import argument: ${arg}. Sources: ${IMPORT_SOURCES.join(', ')}`;
  }
  await runImport({ ...context, source, categories, all, dryRun });
  return null;
}
