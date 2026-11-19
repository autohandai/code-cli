/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import type { MemoryManager } from '../memory/MemoryManager.js';
import type { MemoryEntry } from '../memory/types.js';

export interface MemoryCommandContext {
  memoryManager: MemoryManager;
}

const MEMORY_USAGE = [
  'Memory commands:',
  '  /memory',
  '  /memory outline <user|project>',
  '  /memory zoom <user|project> <snapshot> <node>',
  '  /memory forget <user|project> [snapshot]',
  '  /memory rebuild <user|project>',
  '  /memory delete <user|project> <memory-id>',
].join('\n');

function parseLevel(value: string | undefined): 'user' | 'project' | null {
  return value === 'user' || value === 'project' ? value : null;
}

function formatEntries(title: string, location: string, entries: MemoryEntry[]): string[] {
  if (entries.length === 0) return [];
  return [
    '',
    title + chalk.gray(` (${location})`),
    ...entries.flatMap((entry) => {
      const date = new Date(entry.updatedAt).toLocaleDateString();
      const tags = entry.tags?.length ? chalk.cyan(` [${entry.tags.join(', ')}]`) : '';
      return ['', chalk.white(`  ${entry.content}`), chalk.gray(`    ID: ${entry.id} | Updated: ${date}${tags}`)];
    }),
  ];
}

async function listMemories(ctx: MemoryCommandContext): Promise<string> {
  const { project, user } = await ctx.memoryManager.listAll();
  const rule = chalk.gray('─'.repeat(50));
  const header = [chalk.bold.cyan(t('commands.memory.title')), rule];

  if (project.length === 0 && user.length === 0) {
    return [
      ...header,
      chalk.gray(t('commands.memory.noMemory')),
      '',
      chalk.gray('Tip: Type # followed by text to store a memory.'),
      chalk.gray('Example: # Always use TypeScript strict mode'),
    ].join('\n');
  }

  return [
    ...header,
    ...formatEntries(chalk.bold.yellow(t('commands.memory.projectMemory')), '.autohand/memory/', project),
    ...formatEntries(chalk.bold.magenta(t('commands.memory.userMemory')), '~/.autohand/memory/', user),
    '',
    rule,
    chalk.gray(`Total: ${project.length} project, ${user.length} user memories`),
  ].join('\n');
}

async function runMemoryOperation(ctx: MemoryCommandContext, args: string[]): Promise<string> {
  const [operation, levelValue, snapshotId, nodeId] = args;
  const level = parseLevel(levelValue);

  if (operation === 'outline' && level) {
    const outline = await ctx.memoryManager.getMemoryOutline(level);
    return [
      chalk.bold.cyan(`Memory outline (${level})`),
      chalk.gray(`snapshot=${outline.snapshotId} events=${outline.eventCount ?? 0} memories=${outline.totalEntries}`),
      outline.text || chalk.gray('No memories stored yet.'),
      '',
      chalk.gray(`Zoom: /memory zoom ${level} ${outline.snapshotId} <node>`),
    ].join('\n');
  }

  if (operation === 'zoom' && level && snapshotId && nodeId) {
    const outline = await ctx.memoryManager.zoomMemory(level, snapshotId, nodeId);
    return [
      chalk.bold.cyan(`Memory zoom (${level})`),
      chalk.gray(`snapshot=${outline.snapshotId}`),
      outline.text || chalk.gray('No detail available.'),
    ].join('\n');
  }

  if (operation === 'forget' && level) {
    const invalidated = await ctx.memoryManager.forgetMemorySummaries(level, snapshotId);
    return chalk.green(
      `Invalidated ${invalidated} derived memory summar${invalidated === 1 ? 'y' : 'ies'}. Canonical events were preserved.`,
    );
  }

  if (operation === 'rebuild' && level) {
    const rebuilt = await ctx.memoryManager.rebuildFromEventLog(level);
    return chalk.green(
      `Rebuilt ${level} memory from canonical events: restored ${rebuilt.restored}, removed ${rebuilt.removed}.`,
    );
  }

  if (operation === 'delete' && level && snapshotId) {
    await ctx.memoryManager.delete(snapshotId, level);
    return chalk.green(`Deleted ${level} memory ${snapshotId}. The canonical deletion event was retained.`);
  }

  return MEMORY_USAGE;
}

/**
 * Memory command - lists stored memories and runs the outline/zoom/forget/rebuild/delete operations.
 *
 * Every outcome, failures included, is returned rather than printed: the caller owns the screen,
 * and a full-screen frame holds the console for as long as it is mounted.
 */
export async function memory(
  ctx: MemoryCommandContext,
  args: string[] = [],
): Promise<string> {
  try {
    return args.length > 0 ? await runMemoryOperation(ctx, args) : await listMemories(ctx);
  } catch (error) {
    return chalk.red(`Memory command failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const metadata = {
  command: '/memory',
  description: t('commands.memory.description'),
  implemented: true
};
