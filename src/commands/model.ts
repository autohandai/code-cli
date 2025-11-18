/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Model selection command - prompts user to select model
 */
export async function model(ctx: { promptModelSelection: () => Promise<void> }): Promise<string | null> {
    await ctx.promptModelSelection();
    return null;
}

export const metadata = {
    command: '/model',
    description: 'choose what model and reasoning effort to use',
    implemented: true
};
