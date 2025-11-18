/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';

/**
 * New conversation command - resets the conversation
 */
export async function newConversation(ctx: { resetConversation: () => void }): Promise<string | null> {
    ctx.resetConversation();
    console.log(chalk.gray('Starting a new conversation.'));
    return null;
}

export const metadata = {
    command: '/new',
    description: 'start a new chat during a conversation',
    implemented: true
};
