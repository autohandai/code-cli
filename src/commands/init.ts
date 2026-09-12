/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'node:path';
import { t } from '../i18n/index.js';
import { buildInitInstruction } from '../onboarding/initInstruction.js';
import type { PendingPostTurnAction, QueuedInstructionPolicy } from '../core/agent/PostTurnActionCoordinator.js';

export interface InitCommandContext {
  createAgentsFile: () => Promise<void>;
  workspaceRoot?: string;
  queueInstruction?: (instruction: string, postTurnAction?: PendingPostTurnAction, policy?: QueuedInstructionPolicy) => void;
  isNonInteractive?: boolean;
}

/**
 * `/init` writes AGENTS.md. Interactively it hands the model a background
 * turn that reads the repository first; `/init --basic` (and any
 * non-interactive run) writes the static template immediately.
 */
export async function init(ctx: InitCommandContext, args: string[] = []): Promise<string | null> {
    const basic = args.some((arg) => arg === '--basic' || arg === 'basic' || arg === '--template');
    const canDelegate = !basic && !ctx.isNonInteractive && typeof ctx.queueInstruction === 'function' && !!ctx.workspaceRoot;
    if (!canDelegate) {
      await ctx.createAgentsFile();
      return null;
    }

    const target = path.join(ctx.workspaceRoot!, 'AGENTS.md');
    if (await fs.pathExists(target)) {
      console.log(chalk.gray('AGENTS.md already exists in this workspace.'));
      return null;
    }

    ctx.queueInstruction!(buildInitInstruction(ctx.workspaceRoot!), undefined, { environmentBootstrap: 'skip' });
    console.log(chalk.gray('Reading the repository to write AGENTS.md in the background; the composer stays free. Use /init --basic for the instant template.'));
    return null;
}

export const metadata = {
    command: '/init',
    description: t('commands.init.description'),
    implemented: true,
    subcommands: [
      { name: 'basic', description: 'Write the static template without reading the repository' },
    ],
};
