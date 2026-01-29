/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { showModal, type ModalOption } from '../ui/ink/components/Modal.js';
import fs from 'fs-extra';
import path from 'node:path';
import type { SessionManager } from '../session/SessionManager.js';
import type { SessionMetadata, SessionMessage } from '../session/types.js';
import { AUTOHAND_PATHS } from '../constants.js';

export const metadata = {
    command: '/resume',
    description: 'resume a previous session',
    implemented: true
};

/**
 * Extract a title from a session - uses summary or first user message
 * Note: This reads the conversation file directly to avoid calling loadSession()
 * which would change the currentSession as a side effect
 */
async function getSessionTitle(
    sessionMeta: SessionMetadata
): Promise<string> {
    // First, try to use the summary if it exists
    if (sessionMeta.summary && sessionMeta.summary.trim()) {
        return sessionMeta.summary.slice(0, 60);
    }

    // Otherwise, read the conversation file directly to find first user message
    // This avoids calling loadSession() which sets currentSession as a side effect
    try {
        const conversationPath = path.join(AUTOHAND_PATHS.sessions, sessionMeta.sessionId, 'conversation.jsonl');
        if (await fs.pathExists(conversationPath)) {
            const content = await fs.readFile(conversationPath, 'utf-8');
            const lines = content.trim().split('\n').filter(line => line);

            // Find first user message
            for (const line of lines) {
                try {
                    const msg = JSON.parse(line) as SessionMessage;
                    if (msg.role === 'user' && msg.content) {
                        const cleanContent = msg.content
                            .replace(/\n/g, ' ')
                            .replace(/\s+/g, ' ')
                            .trim();
                        return cleanContent.slice(0, 60) + (cleanContent.length > 60 ? '...' : '');
                    }
                } catch {
                    // Skip malformed lines
                }
            }
        }
    } catch {
        // Ignore errors reading session
    }

    return chalk.gray('(no title)');
}

/**
 * Format a session for display in the picker
 */
function formatSessionChoice(
    sessionMeta: SessionMetadata,
    title: string
): { name: string; message: string; hint: string } {
    const date = new Date(sessionMeta.createdAt);
    const timeAgo = getTimeAgo(date);
    const msgCount = sessionMeta.messageCount;

    return {
        name: sessionMeta.sessionId,
        message: title,
        hint: `${timeAgo} - ${msgCount} messages - ${sessionMeta.projectName}`
    };
}

/**
 * Get a human-readable time ago string
 */
function getTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export async function resume(ctx: {
    sessionManager: SessionManager;
    args: string[];
}): Promise<string | null> {
    const sessionId = ctx.args[0];

    // If session ID provided directly, use it
    if (sessionId) {
        return resumeSession(ctx.sessionManager, sessionId);
    }

    // Otherwise, show interactive session picker
    try {
        const allSessions = await ctx.sessionManager.listSessions();

        if (allSessions.length === 0) {
            console.log(chalk.gray('\nNo sessions found.'));
            console.log(chalk.gray('Start a new conversation to create a session.\n'));
            return null;
        }

        console.log(chalk.cyan('\nSelect a session to resume:\n'));

        // Build choices with titles
        const choices: Array<{ name: string; message: string; hint: string }> = [];

        // Load titles for recent sessions (limit to 20 for performance)
        const recentSessions = allSessions.slice(0, 20);

        for (const session of recentSessions) {
            const title = await getSessionTitle(session);
            choices.push(formatSessionChoice(session, title));
        }

        if (allSessions.length > 20) {
            choices.push({
                name: '__more__',
                message: chalk.gray(`... ${allSessions.length - 20} more sessions`),
                hint: 'Use /sessions to see all'
            });
        }

        const options: ModalOption[] = choices.map(choice => ({
            label: choice.message,
            value: choice.name,
            description: choice.hint
        }));

        const result = await showModal({
            title: 'Choose a session',
            options
        });

        if (!result) {
            console.log(chalk.gray('\nResume cancelled.'));
            return null;
        }

        if (result.value === '__more__') {
            console.log(chalk.gray('\nUse /sessions to see all sessions, then /resume <id>'));
            return null;
        }

        return resumeSession(ctx.sessionManager, result.value);

    } catch (error) {
        // Handle unexpected errors
        console.error(chalk.red(`Failed to list sessions: ${(error as Error).message}`));
        return null;
    }
}

/**
 * Resume a specific session by ID
 */
async function resumeSession(
    sessionManager: SessionManager,
    sessionId: string
): Promise<string | null> {
    try {
        const session = await sessionManager.loadSession(sessionId);
        const messages = session.getMessages();

        // Get a title for the session
        const firstUserMessage = messages.find(m => m.role === 'user');
        const title = session.metadata.summary ||
            firstUserMessage?.content.slice(0, 50) ||
            'Untitled session';

        console.log(chalk.cyan(`\nResuming: ${title}`));
        console.log(chalk.gray(`   Project: ${session.metadata.projectPath}`));
        console.log(chalk.gray(`   Started: ${new Date(session.metadata.createdAt).toLocaleString()}`));
        console.log(chalk.gray(`   Messages: ${messages.length}`));
        console.log();

        // Display recent conversation
        if (messages.length > 0) {
            console.log(chalk.cyan('Recent conversation:'));
            console.log(chalk.gray('─'.repeat(60)));

            const recentMessages = messages.slice(-5);
            for (const msg of recentMessages) {
                const role = msg.role === 'user'
                    ? chalk.green('You')
                    : msg.role === 'assistant'
                        ? chalk.blue('Assistant')
                        : chalk.gray(msg.role);

                // Skip tool messages in preview
                if (msg.role === 'tool') continue;

                const preview = msg.content
                    .replace(/\n/g, ' ')
                    .replace(/\s+/g, ' ')
                    .slice(0, 100);
                const truncated = msg.content.length > 100 ? '...' : '';

                console.log(`${role}: ${chalk.white(preview)}${truncated}`);
            }
            console.log(chalk.gray('─'.repeat(60)));
            console.log();
        }

        console.log(chalk.green('Session resumed. Continue typing to chat.\n'));

        return 'SESSION_RESUMED';
    } catch (error) {
        console.error(chalk.red(`Failed to resume session: ${(error as Error).message}`));
        return null;
    }
}
