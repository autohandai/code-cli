/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import type { SessionManager } from '../session/SessionManager.js';

export interface NewCommandContext {
    resetConversation: () => void | Promise<void>;
    sessionManager: SessionManager;
    workspaceRoot: string;
    model: string;
}

/**
 * New conversation command - creates a fresh session and resets conversation
 */
export async function newConversation(ctx: NewCommandContext): Promise<string | null> {
    // Close the current session if one exists
    const currentSession = ctx.sessionManager.getCurrentSession();
    if (currentSession) {
        await ctx.sessionManager.closeSession('Session ended - new conversation started');
    }

    // Reset the conversation context
    await ctx.resetConversation();

    // Create a new session
    await ctx.sessionManager.createSession(ctx.workspaceRoot, ctx.model);

    console.log();
    console.log(chalk.cyan(t('commands.new.cleared')));
    console.log();

    return null;
}

export const metadata = {
    command: '/new',
    description: 'start a fresh conversation (saves current session)',
    implemented: true
};
