/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import type { SessionManager } from '../session/SessionManager.js';

export const metadata = {
    command: '/session',
    description: 'show the current session details',
    implemented: true
};

/** Returned rather than printed, so it shows in the full-screen transcript too (see /sessions). */
export async function session(ctx: { sessionManager: SessionManager }): Promise<string | null> {
    const current = ctx.sessionManager.getCurrentSession();
    if (!current) {
        return chalk.yellow('No active session.');
    }

    const meta = current.metadata;
    const field = (label: string, value: string) => `${chalk.gray(` ${label}:`)} ${chalk.white(value)}`;
    return [
        chalk.cyan('Current session'),
        field('ID', meta.sessionId),
        ...(meta.title ? [field('Name', meta.title)] : []),
        field('Project', meta.projectPath),
        field('Model', meta.model),
        field('Messages', meta.messageCount.toString()),
        field('Started', new Date(meta.createdAt).toLocaleString()),
    ].join('\n');
}
