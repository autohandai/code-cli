/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import type { MemoryManager } from '../memory/MemoryManager.js';

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

/**
 * Memory command - displays stored memories at project and user level
 */
export async function memory(
  ctx: MemoryCommandContext,
  args: string[] = [],
): Promise<string | null> {
  if (args.length > 0) {
    const [operation, levelValue, snapshotId, nodeId] = args;
    const level = parseLevel(levelValue);

    if (operation === 'outline' && level) {
      const outline = await ctx.memoryManager.getMemoryOutline(level);
      console.log();
      console.log(chalk.bold.cyan(`Memory outline (${level})`));
      console.log(chalk.gray(
        `snapshot=${outline.snapshotId} events=${outline.eventCount ?? 0} memories=${outline.totalEntries}`,
      ));
      console.log(outline.text || chalk.gray('No memories stored yet.'));
      console.log();
      console.log(chalk.gray(
        `Zoom: /memory zoom ${level} ${outline.snapshotId} <node>`,
      ));
      return null;
    }

    if (operation === 'zoom' && level && snapshotId && nodeId) {
      const outline = await ctx.memoryManager.zoomMemory(level, snapshotId, nodeId);
      console.log();
      console.log(chalk.bold.cyan(`Memory zoom (${level})`));
      console.log(chalk.gray(`snapshot=${outline.snapshotId}`));
      console.log(outline.text || chalk.gray('No detail available.'));
      return null;
    }

    if (operation === 'forget' && level) {
      const invalidated = await ctx.memoryManager.forgetMemorySummaries(level, snapshotId);
      console.log(chalk.green(
        `Invalidated ${invalidated} derived memory summar${invalidated === 1 ? 'y' : 'ies'}. Canonical events were preserved.`,
      ));
      return null;
    }

    if (operation === 'rebuild' && level) {
      const rebuilt = await ctx.memoryManager.rebuildFromEventLog(level);
      console.log(chalk.green(
        `Rebuilt ${level} memory from canonical events: restored ${rebuilt.restored}, removed ${rebuilt.removed}.`,
      ));
      return null;
    }

    if (operation === 'delete' && level && snapshotId) {
      await ctx.memoryManager.delete(snapshotId, level);
      console.log(chalk.green(
        `Deleted ${level} memory ${snapshotId}. The canonical deletion event was retained.`,
      ));
      return null;
    }

    return MEMORY_USAGE;
  }

  const { project, user } = await ctx.memoryManager.listAll();

  console.log();
  console.log(chalk.bold.cyan(t('commands.memory.title')));
  console.log(chalk.gray('─'.repeat(50)));

  if (project.length === 0 && user.length === 0) {
    console.log(chalk.gray(t('commands.memory.noMemory')));
    console.log();
    console.log(chalk.gray('Tip: Type # followed by text to store a memory.'));
    console.log(chalk.gray('Example: # Always use TypeScript strict mode'));
    return null;
  }

  if (project.length > 0) {
    console.log();
    console.log(chalk.bold.yellow(t('commands.memory.projectMemory')) + chalk.gray(' (.autohand/memory/)'));
    console.log();
    for (const entry of project) {
      const date = new Date(entry.updatedAt).toLocaleDateString();
      const tags = entry.tags?.length ? chalk.cyan(` [${entry.tags.join(', ')}]`) : '';
      console.log(chalk.white(`  ${entry.content}`));
      console.log(chalk.gray(`    ID: ${entry.id} | Updated: ${date}${tags}`));
      console.log();
    }
  }

  if (user.length > 0) {
    console.log();
    console.log(chalk.bold.magenta(t('commands.memory.userMemory')) + chalk.gray(' (~/.autohand/memory/)'));
    console.log();
    for (const entry of user) {
      const date = new Date(entry.updatedAt).toLocaleDateString();
      const tags = entry.tags?.length ? chalk.cyan(` [${entry.tags.join(', ')}]`) : '';
      console.log(chalk.white(`  ${entry.content}`));
      console.log(chalk.gray(`    ID: ${entry.id} | Updated: ${date}${tags}`));
      console.log();
    }
  }

  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.gray(`Total: ${project.length} project, ${user.length} user memories`));

  return null;
}

export const metadata = {
  command: '/memory',
  description: t('commands.memory.description'),
  implemented: true
};
