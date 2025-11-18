/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import terminalLink from 'terminal-link';

/**
 * Help command - shows available commands and tips
 */
export async function help(): Promise<string | null> {
    console.log(chalk.cyan('\n📚 Available Commands:\n'));

    const commands = [
        { cmd: '/ls', desc: 'List files in workspace' },
        { cmd: '/diff', desc: 'Show git diff' },
        { cmd: '/undo', desc: 'Undo last file mutation' },
        { cmd: '/model', desc: 'Choose AI model' },
        { cmd: '/approvals', desc: 'Configure auto-approvals' },
        { cmd: '/review', desc: 'Review current changes' },
        { cmd: '/new', desc: 'Start new conversation' },
        { cmd: '/init', desc: 'Create AGENTS.md file' },
        { cmd: '/compact', desc: 'Compact conversation' },
        { cmd: '/quit', desc: 'Exit Autohand' },
        { cmd: '/help', desc: 'Show this help' }
    ];

    commands.forEach(({ cmd, desc }) => {
        console.log(`  ${chalk.yellow(cmd.padEnd(12))} ${chalk.gray(desc)}`);
    });

    console.log(chalk.cyan('\n💡 Tips:\n'));
    console.log(chalk.gray('  • Type @ to mention files for the AI'));
    console.log(chalk.gray('  • Use arrow keys to navigate file suggestions'));
    console.log(chalk.gray('  • Press Tab to autocomplete file paths'));
    console.log(chalk.gray('  • Press Esc to cancel current operation\n'));

    const docLink = terminalLink('docs.autohand.ai', 'https://docs.autohand.ai');
    console.log(chalk.gray(`For more information, visit ${docLink}\n`));

    return null;
}

export const metadata = {
    command: '/help',
    description: 'describe available slash commands and tips',
    implemented: true
};
