/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import chalk from 'chalk';
import enquirer from 'enquirer';
import type { SlashCommandContext } from '../core/slashCommandTypes.js';
import { AUTOHAND_FILES } from '../constants.js';

export const metadata = {
    command: '/feedback',
    description: 'share feedback with environment details',
    implemented: true
};

type FeedbackContext = Pick<SlashCommandContext, 'sessionManager'>;

export async function feedback(_ctx: FeedbackContext): Promise<string | null> {
    const answer = await enquirer.prompt<{ feedback: string }>([
        {
            type: 'input',
            name: 'feedback',
            message: 'What worked? What broke?'
        }
    ]);

    if (!answer.feedback?.trim()) {
        console.log(chalk.gray('Feedback discarded (empty).'));
        return null;
    }

    const now = new Date().toISOString();
    const runtimeError = getLastRuntimeError();
    const payload = {
        timestamp: now,
        feedback: answer.feedback.trim(),
        env: {
            platform: `${process.platform}-${process.arch}`,
            node: process.version,
            bun: process.versions?.bun,
            cwd: process.cwd(),
            shell: process.env.SHELL
        },
        runtimeError: runtimeError ? formatError(runtimeError) : null
    };

    try {
        const feedbackPath = AUTOHAND_FILES.feedbackLog;
        await fs.ensureFile(feedbackPath);
        await fs.appendFile(feedbackPath, JSON.stringify(payload) + '\n', 'utf8');
        console.log(chalk.green('Feedback recorded.'));
        console.log(chalk.gray(`Saved to ${feedbackPath}`));
    } catch (error) {
        console.error(chalk.red(`Failed to save feedback: ${(error as Error).message}`));
    }

    if (runtimeError) {
        console.log(chalk.yellow('Detected a recent runtime error; included in feedback payload.'));
    }

    return null;
}

function getLastRuntimeError(): any | null {
    const globalAny = globalThis as any;
    return globalAny.__autohandLastError ?? null;
}

function formatError(err: any): { message?: string; stack?: string } {
    if (!err) return {};
    if (err instanceof Error) {
        return { message: err.message, stack: err.stack };
    }
    if (typeof err === 'object') {
        const message = 'message' in err ? String((err as any).message) : undefined;
        const stack = 'stack' in err ? String((err as any).stack) : undefined;
        return { message, stack };
    }
    return { message: String(err) };
}
