/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Approvals command - configure what actions require approval
 */
export async function approvals(ctx: { promptApprovalMode: () => Promise<void> }): Promise<string | null> {
    await ctx.promptApprovalMode();
    return null;
}

export const metadata = {
    command: '/approvals',
    description: 'choose what Autohand can do without approval',
    implemented: true
};
