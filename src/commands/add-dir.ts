/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'node:path';
import { checkWorkspaceSafety } from '../startup/workspaceSafety.js';
import type { FileActionManager } from '../actions/filesystem.js';

export interface AddDirCommandContext {
  workspaceRoot: string;
  fileManager: FileActionManager;
  additionalDirs: string[];
  addAdditionalDir: (dir: string) => void;
}

/**
 * /add-dir command - adds additional directories to the workspace scope
 */
export async function addDir(ctx: AddDirCommandContext, args: string[]): Promise<string | null> {
  const dirPath = args.join(' ').trim();

  // If no path provided, show current directories
  if (!dirPath) {
    console.log();
    console.log(chalk.bold.cyan('Workspace Directories'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log();
    console.log(chalk.bold('Primary Workspace:'));
    console.log(chalk.cyan(`  ${ctx.workspaceRoot}`));
    console.log();

    if (ctx.additionalDirs.length > 0) {
      console.log(chalk.bold('Additional Directories:'));
      ctx.additionalDirs.forEach((dir, index) => {
        console.log(chalk.green(`  ${index + 1}. ${dir}`));
      });
    } else {
      console.log(chalk.gray('No additional directories configured.'));
    }
    console.log();
    console.log(chalk.gray('Usage: /add-dir <path> to add a new directory'));
    console.log();
    return null;
  }

  // Resolve the path
  const resolvedPath = path.resolve(dirPath);

  // Check if directory exists
  if (!await fs.pathExists(resolvedPath)) {
    console.log(chalk.red(`Error: Directory does not exist: ${dirPath}`));
    return null;
  }

  // Check if it's actually a directory
  const stats = await fs.stat(resolvedPath);
  if (!stats.isDirectory()) {
    console.log(chalk.red(`Error: Path is not a directory: ${dirPath}`));
    return null;
  }

  // Safety check
  const safetyResult = checkWorkspaceSafety(resolvedPath);
  if (!safetyResult.safe) {
    console.log(chalk.red(`Error: Unsafe directory: ${dirPath}`));
    console.log(chalk.yellow(`  ${safetyResult.reason}`));
    return null;
  }

  // Check if already in the list
  if (resolvedPath === ctx.workspaceRoot) {
    console.log(chalk.yellow(`Directory is already the primary workspace: ${resolvedPath}`));
    return null;
  }

  if (ctx.additionalDirs.includes(resolvedPath)) {
    console.log(chalk.yellow(`Directory already added: ${resolvedPath}`));
    return null;
  }

  // Add the directory
  ctx.addAdditionalDir(resolvedPath);

  console.log(chalk.green(`Added directory: ${resolvedPath}`));
  console.log(chalk.gray('You can now read, write, and modify files in this directory.'));
  return null;
}

export const metadata = {
  command: '/add-dir',
  description: 'add additional directories to workspace scope',
  implemented: true
};
