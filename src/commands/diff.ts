/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Git diff command - shows git diff including untracked files
 */
export async function diff(ctx: { printGitDiff: () => void }): Promise<string | null> {
    ctx.printGitDiff();
    return null;
}

export const metadata = {
    command: '/diff',
    description: 'show git diff (including untracked files)',
    implemented: true
};
