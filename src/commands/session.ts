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

export async function session(ctx: { sessionManager: SessionManager }): Promise<string | null> {
    const current = ctx.sessionManager.getCurrentSession();
    if (!current) {
        console.log(chalk.yellow('No active session.'));
        return null;
    }

    const meta = current.metadata;
    console.log(chalk.cyan('\nCurrent session'));
    console.log(`${chalk.gray(' ID:')} ${chalk.white(meta.sessionId)}`);
    console.log(`${chalk.gray(' Project:')} ${chalk.white(meta.projectPath)}`);
    console.log(`${chalk.gray(' Model:')} ${chalk.white(meta.model)}`);
    console.log(`${chalk.gray(' Messages:')} ${chalk.white(meta.messageCount.toString())}`);
    console.log(`${chalk.gray(' Started:')} ${chalk.white(new Date(meta.createdAt).toLocaleString())}`);
    console.log();
    return null;
}
