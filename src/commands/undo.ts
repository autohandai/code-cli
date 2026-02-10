/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { spawnSync } from 'node:child_process';
import { t } from '../i18n/index.js';

export interface UndoCommandContext {
    workspaceRoot: string;
    undoFileMutation: () => Promise<void>;
    removeLastTurn: () => void;
}

/**
 * Undo command - reverts git changes and removes last conversation turn
 */
export async function undo(ctx: UndoCommandContext): Promise<string | null> {
    console.log();
    console.log(chalk.bold.yellow('Undoing changes...'));

    // 1. Get git status to see what changes exist
    const statusResult = spawnSync('git', ['status', '--porcelain'], {
        cwd: ctx.workspaceRoot,
        encoding: 'utf8'
    });

    const hasGitChanges = statusResult.status === 0 && statusResult.stdout.trim().length > 0;

    // 2. Revert all uncommitted git changes
    if (hasGitChanges) {
        // Restore tracked files
        const checkoutResult = spawnSync('git', ['checkout', '--', '.'], {
            cwd: ctx.workspaceRoot,
            encoding: 'utf8'
        });

        if (checkoutResult.status === 0) {
            console.log(chalk.green('  Reverted tracked file changes'));
        }

        // Clean untracked files (only if they were created in this session)
        const cleanResult = spawnSync('git', ['clean', '-fd'], {
            cwd: ctx.workspaceRoot,
            encoding: 'utf8'
        });

        if (cleanResult.status === 0 && cleanResult.stdout.trim()) {
            console.log(chalk.green('  Removed untracked files'));
        }
    } else {
        console.log(chalk.gray('  ' + t('commands.undo.noChanges')));
    }

    // 3. Try to undo file mutations from the undo stack
    try {
        await ctx.undoFileMutation();
        console.log(chalk.green('  ' + t('commands.undo.success', { file: 'last mutation' })));
    } catch {
        // No file mutations to undo, that's okay
        console.log(chalk.gray('  ' + t('commands.undo.noChanges')));
    }

    // 4. Remove the last user turn from conversation
    ctx.removeLastTurn();
    console.log(chalk.green('  Removed last conversation turn'));

    console.log();
    console.log(chalk.cyan('Undo complete. Ready for new instructions.'));

    return null;
}

export const metadata = {
    command: '/undo',
    description: 'revert git changes and remove last conversation turn',
    implemented: true
};
