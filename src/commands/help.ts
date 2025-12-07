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
        { cmd: '/quit', desc: 'Exit Autohand' },
        { cmd: '/model', desc: 'Configure providers (OpenRouter, Ollama, OpenAI, llama.cpp)' },
        { cmd: '/session', desc: 'Show current session info' },
        { cmd: '/sessions', desc: 'List sessions' },
        { cmd: '/resume', desc: 'Resume a session by id' },
        { cmd: '/init', desc: 'Create AGENTS.md file' },
        { cmd: '/agents', desc: 'List available sub-agents' },
        { cmd: '/feedback', desc: 'Send feedback with env details' },
        { cmd: '/help / ?', desc: 'Show this help' }
    ];

    commands.forEach(({ cmd, desc }) => {
        console.log(`  ${chalk.yellow(cmd.padEnd(14))} ${chalk.gray(desc)}`);
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

export const aliasMetadata = {
    command: '/?',
    description: 'alias for /help',
    implemented: true
};
