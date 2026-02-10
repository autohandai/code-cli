/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import type { SlashCommandContext } from '../core/slashCommandTypes.js';
import type { SessionMetadata } from '../session/types.js';

export const metadata = {
    command: '/history',
    description: t('commands.history.title'),
    implemented: true,
};

/**
 * A single history entry used for formatting and pagination.
 * Mirrors the subset of SessionMetadata needed for display.
 */
export interface HistoryEntry {
    sessionId: string;
    createdAt: string;
    lastActiveAt: string;
    projectName: string;
    model: string;
    messageCount: number;
    status: 'active' | 'completed' | 'crashed';
}

/**
 * Result of paginating history entries.
 */
export interface PaginatedHistory {
    items: HistoryEntry[];
    currentPage: number;
    totalPages: number;
    totalItems: number;
}

/**
 * Formats a single history entry into a human-readable line.
 *
 * Shows: sessionId, date, time, projectName, model, messageCount, status badge
 */
export function formatHistoryEntry(entry: HistoryEntry): string {
    const date = new Date(entry.createdAt);
    const dateStr = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
    });
    const timeStr = date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });

    const id = entry.sessionId.length > 20
        ? entry.sessionId.slice(0, 20) + '...'
        : entry.sessionId;

    const modelShort = entry.model.includes('/')
        ? entry.model.split('/').pop()!
        : entry.model;
    const modelDisplay = modelShort.length > 25
        ? modelShort.slice(0, 25) + '...'
        : modelShort;

    const badge = entry.status === 'active'
        ? chalk.green(' [active]')
        : '';

    return [
        chalk.cyan(id.padEnd(24)),
        `${dateStr} ${timeStr}`.padEnd(22),
        entry.projectName.padEnd(18),
        modelDisplay.padEnd(28),
        `${entry.messageCount} msgs`,
        badge,
    ].join('');
}

/**
 * Paginates an array of history entries.
 *
 * @param entries  Full list of entries (already sorted)
 * @param page    1-based page number
 * @param pageSize Number of items per page (default 15)
 */
export function paginateHistory(
    entries: HistoryEntry[],
    page: number,
    pageSize: number = 15,
): PaginatedHistory {
    const totalItems = entries.length;
    const totalPages = Math.ceil(totalItems / pageSize) || 0;

    if (page < 1 || page > totalPages) {
        return {
            items: [],
            currentPage: page,
            totalPages,
            totalItems,
        };
    }

    const startIndex = (page - 1) * pageSize;
    const items = entries.slice(startIndex, startIndex + pageSize);

    return {
        items,
        currentPage: page,
        totalPages,
        totalItems,
    };
}

/**
 * Convert a SessionMetadata into a HistoryEntry for display.
 */
function toHistoryEntry(session: SessionMetadata): HistoryEntry {
    return {
        sessionId: session.sessionId,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        projectName: session.projectName,
        model: session.model,
        messageCount: session.messageCount,
        status: session.status,
    };
}

/**
 * /history slash command handler.
 *
 * Lists sessions sorted by date (newest first) with pagination.
 * Accepts an optional page number argument, e.g. `/history 2`.
 */
export async function history(ctx: SlashCommandContext & { args?: string[] }): Promise<string | null> {
    const pageArg = ctx.args?.[0];
    const page = pageArg ? parseInt(pageArg, 10) || 1 : 1;
    const pageSize = 15;

    try {
        const allSessions = await ctx.sessionManager.listSessions();

        if (allSessions.length === 0) {
            console.log(chalk.gray(`\n${t('commands.history.empty')}\n`));
            return null;
        }

        // Sessions are already sorted newest-first by listSessions()
        const entries = allSessions.map(toHistoryEntry);
        const paginated = paginateHistory(entries, page, pageSize);

        console.log(chalk.cyan(`\n${t('commands.history.title')}\n`));

        // Header
        console.log(
            chalk.bold(
                ' ID'.padEnd(25) +
                'Date'.padEnd(22) +
                'Project'.padEnd(18) +
                'Model'.padEnd(28) +
                'Messages'
            )
        );
        console.log(chalk.gray('\u2500'.repeat(100)));

        // Rows
        for (const entry of paginated.items) {
            console.log(` ${formatHistoryEntry(entry)}`);
        }

        console.log(chalk.gray('\u2500'.repeat(100)));

        // Footer with page info
        if (paginated.totalPages > 0) {
            console.log(
                chalk.gray(
                    `\n${t('commands.history.showing', { page: paginated.currentPage, total: paginated.totalPages, count: paginated.totalItems })}`
                )
            );
        }

        if (paginated.totalPages > 1 && paginated.currentPage < paginated.totalPages) {
            console.log(chalk.gray(`Use /history ${paginated.currentPage + 1} for next page`));
        }

        console.log(chalk.gray(`${t('commands.history.resumeHint')}\n`));

        return null;
    } catch (error) {
        console.error(chalk.red(`Failed to list history: ${(error as Error).message}`));
        return null;
    }
}
