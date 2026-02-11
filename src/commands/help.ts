/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import terminalLink from 'terminal-link';
import { t } from '../i18n/index.js';

/**
 * Help command - shows available commands and tips
 * Dynamically reads from the SLASH_COMMANDS registry so new commands
 * are automatically included.
 *
 * Uses dynamic import() for SLASH_COMMANDS to break the circular dependency:
 *   index.ts → agent.ts → slashCommands.ts → help.ts → slashCommands.ts
 * This prevents a deadlock during module evaluation in compiled binaries.
 */
export async function help(): Promise<string | null> {
    const { SLASH_COMMANDS } = await import('../core/slashCommands.js');

    console.log(chalk.cyan(`\n  ${t('commands.help.title')}\n`));

    const commands = SLASH_COMMANDS
        .filter(cmd => cmd.implemented && cmd.command !== '/?')
        .sort((a, b) => a.command.localeCompare(b.command));

    const maxLen = Math.max(...commands.map(c => c.command.length)) + 2;

    for (const { command, description } of commands) {
        console.log(`  ${chalk.yellow(command.padEnd(maxLen))} ${chalk.gray(description)}`);
    }

    console.log(chalk.cyan(`\n  ${t('commands.help.tips.title')}\n`));
    console.log(chalk.gray(`  • ${t('commands.help.tips.mention')}`));
    console.log(chalk.gray(`  • ${t('commands.help.tips.arrows')}`));
    console.log(chalk.gray(`  • ${t('commands.help.tips.tab')}`));
    console.log(chalk.gray(`  • ${t('commands.help.tips.escape')}\n`));

    const docLink = terminalLink('docs.autohand.ai', 'https://docs.autohand.ai');
    console.log(chalk.gray(`  ${t('commands.help.docsLink', { link: docLink })}\n`));

    return null;
}

export const metadata = {
    command: '/help',
    description: 'describe available slash commands and tips',
    implemented: true
};

export const aliasMetadata = {
    command: '/?',
    description: 'alias for /help',
    implemented: true
};
