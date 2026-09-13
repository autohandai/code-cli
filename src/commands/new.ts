/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { resetConversationSession, type ClearCommandContext } from './clear.js';

export type NewCommandContext = ClearCommandContext;

/**
 * New conversation command - extracts memories, then creates a fresh session and resets conversation.
 */
export async function newConversation(ctx: NewCommandContext): Promise<string | null> {
    return resetConversationSession(ctx, 'Session ended - new conversation started');
}

export const metadata = {
    command: '/new',
    description: 'start a fresh conversation (saves current session)',
    implemented: true
};
