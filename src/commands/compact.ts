/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';

/**
 * Compact command - informs that conversation is compact by default
 */
export async function compact(): Promise<string | null> {
    console.log(chalk.gray('Conversation is compact by default; no action needed.'));
    return null;
}

export const metadata = {
    command: '/compact',
    description: 'summarize conversation to prevent hitting the context limit',
    implemented: true
};
