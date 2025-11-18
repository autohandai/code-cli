/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Init command - creates AGENTS.md file
 */
export async function init(ctx: { createAgentsFile: () => Promise<void> }): Promise<string | null> {
    await ctx.createAgentsFile();
    return null;
}

export const metadata = {
    command: '/init',
    description: 'create an AGENTS.md file with instructions for Autohand',
    implemented: true
};
