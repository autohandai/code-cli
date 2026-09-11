/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import type { SessionManager } from '../session/SessionManager.js';
import { getSessionDisplayName } from '../session/sessionTitle.js';

export const metadata = {
    command: '/sessions',
    description: t('commands.sessions.description'),
    implemented: true
};

export async function sessions(ctx: {
    sessionManager: SessionManager;
    args: string[];
}): Promise<string | null> {
    const projectFilter = ctx.args.includes('--project')
        ? ctx.args[ctx.args.indexOf('--project') + 1]
        : undefined;

    try {
        const allSessions = await ctx.sessionManager.listSessions(
            projectFilter ? { project: projectFilter } : undefined
        );

        if (allSessions.length === 0) {
            console.log(chalk.gray(t('commands.sessions.noSessions')));
            return null;
        }

        console.log(chalk.cyan(`\nSessions${projectFilter ? ` for ${projectFilter}` : ''}:\n`));

        // Header
        console.log(
            chalk.bold(
                ' ID'.padEnd(25) +
                'Created'.padEnd(20) +
                'Messages'.padEnd(12) +
                'Name'
            )
        );
        console.log(chalk.gray('─'.repeat(80)));

        // Rows
        for (const session of allSessions.slice(0, 20)) {
            const id = session.sessionId.padEnd(24);
            const created = new Date(session.createdAt).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
            }).padEnd(19);
            const messages = session.messageCount.toString().padEnd(11);
            const name = getSessionDisplayName(session)?.slice(0, 40) || chalk.gray('No name');

            console.log(` ${chalk.cyan(id)}${created}${messages}${name}`);
        }

        if (allSessions.length > 20) {
            console.log(chalk.gray(`\n... and ${allSessions.length - 20} more sessions`));
        }

        console.log(chalk.gray(`\nUse ${chalk.white('/resume <id>')} to continue a session`));
        return null;
    } catch (error) {
        console.error(chalk.red(`Failed to list sessions: ${(error as Error).message}`));
        return null;
    }
}
