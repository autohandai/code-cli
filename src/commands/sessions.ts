/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import type { SessionManager } from '../session/SessionManager.js';
import type { SessionMetadata } from '../session/types.js';
import { getSessionDisplayName } from '../session/sessionTitle.js';

export const metadata = {
    command: '/sessions',
    description: t('commands.sessions.description'),
    implemented: true
};

const SHOWN = 20;

function formatCreated(createdAt: string): string {
    return new Date(createdAt).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

function sessionTable(shown: SessionMetadata[]): string[] {
    // Ids are what /resume takes, so they are never cut; the column is as wide as the longest one.
    const idWidth = Math.max('ID'.length, ...shown.map(session => session.sessionId.length)) + 2;
    const createdWidth = Math.max('Created'.length, ...shown.map(session => formatCreated(session.createdAt).length)) + 2;
    const messagesWidth = 'Messages'.length + 2;
    const header = ' ' + 'ID'.padEnd(idWidth) + 'Created'.padEnd(createdWidth) + 'Messages'.padEnd(messagesWidth) + 'Name';
    const rows = shown.map(session => {
        const name = getSessionDisplayName(session)?.slice(0, 40) || chalk.gray('No name');
        return ' ' + chalk.cyan(session.sessionId.padEnd(idWidth))
            + formatCreated(session.createdAt).padEnd(createdWidth)
            + session.messageCount.toString().padEnd(messagesWidth)
            + name;
    });
    return [chalk.bold(header), chalk.gray('─'.repeat(Math.min(header.length + 40, 120))), ...rows];
}

/**
 * Lists saved sessions. The list is returned rather than printed: in full-screen mode console
 * output is held so the frame is not painted over, and a printed list never appears.
 */
export async function sessions(ctx: {
    sessionManager: SessionManager;
    args: string[];
}): Promise<string | null> {
    const projectFilter = ctx.args.includes('--project')
        ? ctx.args[ctx.args.indexOf('--project') + 1]
        : undefined;

    try {
        const storedSessions = await ctx.sessionManager.listSessions(
            projectFilter ? { project: projectFilter } : undefined
        );
        const allSessions = storedSessions.filter(session => session.messageCount > 0);

        if (allSessions.length === 0) {
            return chalk.gray(t('commands.sessions.noSessions'));
        }

        const lines = [
            chalk.cyan(`Sessions${projectFilter ? ` for ${projectFilter}` : ''}:`),
            '',
            ...sessionTable(allSessions.slice(0, SHOWN)),
        ];
        if (allSessions.length > SHOWN) {
            lines.push('', chalk.gray(`... and ${allSessions.length - SHOWN} more sessions`));
        }
        lines.push('', chalk.gray(`Use ${chalk.white('/resume <id>')} to continue a session`));
        return lines.join('\n');
    } catch (error) {
        return chalk.red(`Failed to list sessions: ${(error as Error).message}`);
    }
}
