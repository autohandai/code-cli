/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * List files command - shows all files in the workspace
 */
export async function listFiles(ctx: { listWorkspaceFiles: () => Promise<void> }): Promise<string | null> {
    await ctx.listWorkspaceFiles();
    return null;
}

export const metadata = {
    command: '/ls',
    description: 'list files in the current workspace without contacting the LLM',
    implemented: true
};
