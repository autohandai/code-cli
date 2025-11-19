/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import type { SessionManager } from '../session/SessionManager.js';

export const metadata = {
    command: '/resume',
    description: 'resume a previous session',
    implemented: true
};

export async function resume(ctx: {
    sessionManager: SessionManager;
    args: string[];
}): Promise<string | null> {
    const sessionId = ctx.args[0];

    if (!sessionId) {
        console.log(chalk.red('Usage: /resume <session-id>'));
        console.log(chalk.gray('Use /sessions to list available sessions'));
        return null;
    }

    try {
        const session = await ctx.sessionManager.loadSession(sessionId);
        const messages = session.getMessages();

        console.log(chalk.cyan(`\n📂 Resuming session ${sessionId}`));
        console.log(chalk.gray(`   Project: ${session.metadata.projectPath}`));
        console.log(chalk.gray(`   Started: ${new Date(session.metadata.createdAt).toLocaleString()}`));
        console.log(chalk.gray(`   Messages: ${messages.length}`));
        console.log();

        // Display conversation history summary
        if (messages.length > 0) {
            console.log(chalk.cyan('Recent conversation:'));
            const recentMessages = messages.slice(-3);
            for (const msg of recentMessages) {
                const role = msg.role === 'user' ? chalk.green('You') : chalk.blue('Assistant');
                const preview = msg.content.slice(0, 80) + (msg.content.length > 80 ? '...' : '');
                console.log(`${role}: ${chalk.gray(preview)}`);
            }
            console.log();
        }

        return 'SESSION_RESUMED';
    } catch (error) {
        console.error(chalk.red(`Failed to resume session: ${(error as Error).message}`));
        return null;
    }
}
