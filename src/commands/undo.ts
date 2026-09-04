/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { UndoStackEmptyError } from '../actions/filesystem.js';
import { t } from '../i18n/index.js';

export interface UndoCommandContext {
    undoFileMutation: () => Promise<void>;
    removeLastTurn: () => void;
}

/**
 * Undo command - reverts the last agent-owned file mutation and conversation turn
 */
export async function undo(ctx: UndoCommandContext): Promise<string | null> {
    console.log();
    console.log(chalk.bold.yellow('Undoing changes...'));

    // Revert only mutations recorded by the agent. Repository-wide Git cleanup
    // would also destroy unrelated work that existed before the agent turn.
    try {
        await ctx.undoFileMutation();
        console.log(chalk.green('  ' + t('commands.undo.success', { file: 'last mutation' })));
    } catch (error) {
        if (error instanceof UndoStackEmptyError) {
            console.log(chalk.gray('  ' + t('commands.undo.noChanges')));
        } else {
            const message = error instanceof Error ? error.message : String(error);
            console.log(chalk.yellow(`  Undo stopped: ${message}`));
            return null;
        }
    }

    ctx.removeLastTurn();
    console.log(chalk.green('  Removed last conversation turn'));

    console.log();
    console.log(chalk.cyan('Undo complete. Ready for new instructions.'));

    return null;
}

export const metadata = {
    command: '/undo',
    description: 'revert the last agent file mutation and conversation turn',
    implemented: true
};
