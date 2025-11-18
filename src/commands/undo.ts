/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Undo command - undoes the last file mutation
 */
export async function undo(ctx: { undoLastMutation: () => Promise<void> }): Promise<string | null> {
    await ctx.undoLastMutation();
    return null;
}

export const metadata = {
    command: '/undo',
    description: 'ask Autohand to undo a turn',
    implemented: true
};
