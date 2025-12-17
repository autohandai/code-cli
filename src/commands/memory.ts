/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import type { MemoryManager } from '../memory/MemoryManager.js';

export interface MemoryCommandContext {
  memoryManager: MemoryManager;
}

/**
 * Memory command - displays stored memories at project and user level
 */
export async function memory(ctx: MemoryCommandContext): Promise<string | null> {
  const { project, user } = await ctx.memoryManager.listAll();

  console.log();
  console.log(chalk.bold.cyan('Stored Memories'));
  console.log(chalk.gray('─'.repeat(50)));

  if (project.length === 0 && user.length === 0) {
    console.log(chalk.gray('No memories stored yet.'));
    console.log();
    console.log(chalk.gray('Tip: Type # followed by text to store a memory.'));
    console.log(chalk.gray('Example: # Always use TypeScript strict mode'));
    return null;
  }

  if (project.length > 0) {
    console.log();
    console.log(chalk.bold.yellow('Project Memories') + chalk.gray(' (.autohand/memory/)'));
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
    console.log(chalk.bold.magenta('User Memories') + chalk.gray(' (~/.autohand/memory/)'));
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
  description: 'view stored project and user memories',
  implemented: true
};
