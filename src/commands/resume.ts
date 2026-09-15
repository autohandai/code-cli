/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import { showModal } from '../ui/ink/components/Modal.js';
import fs from 'fs-extra';
import path from 'node:path';
import type { Session, SessionManager } from '../session/SessionManager.js';
import { getSessionDisplayName } from '../session/sessionTitle.js';
import { buildSessionPickerRows, SHOW_EMPTY_VALUE } from '../session/sessionPickerRows.js';
import type { SessionMetadata, SessionMessage } from '../session/types.js';
import { buildSessionChatLog, formatChatLogPreview } from '../session/chatLog.js';
import { AUTOHAND_PATHS } from '../constants.js';

export const metadata = {
    command: '/resume',
    description: t('commands.resume.description'),
    implemented: true
};

/** Summaries that carry no information over "we don't have a title" and should fall through. */
const GENERIC_SUMMARIES = new Set([
    'session complete',
    'session ended - new conversation started',
]);

/**
 * Decide a session's display title: the name given with /rename, then the
 * summary (skipping a generic placeholder summary that carries no
 * information), then the first user message, then a fallback for a session
 * with no messages at all.
 *
 * The first user message is expensive to obtain (it means reading the
 * session's conversation file), so it is passed as a thunk and only invoked
 * when the cheaper title sources above it are unavailable.
 */
export async function resolveSessionTitle(
    meta: SessionMetadata,
    getFirstUserMessage?: () => Promise<string | undefined>
): Promise<string> {
    const named = getSessionDisplayName(meta);
    if (named && !GENERIC_SUMMARIES.has(named.trim().toLowerCase())) {
        return named.slice(0, 120);
    }
    const firstUserMessage = await getFirstUserMessage?.();
    if (firstUserMessage?.trim()) {
        return firstUserMessage.trim().slice(0, 120);
    }
    return '(no messages)';
}

/**
 * Read a session's first user message directly from its conversation file.
 * Reads the file rather than calling loadSession(), which would change the
 * currentSession as a side effect.
 */
async function readFirstUserMessage(sessionMeta: SessionMetadata): Promise<string | undefined> {
    try {
        const conversationPath = path.join(AUTOHAND_PATHS.sessions, sessionMeta.sessionId, 'conversation.jsonl');
        if (!await fs.pathExists(conversationPath)) {
            return undefined;
        }
        const content = await fs.readFile(conversationPath, 'utf-8');
        const lines = content.trim().split('\n').filter(line => line);

        for (const line of lines) {
            try {
                const msg = JSON.parse(line) as SessionMessage;
                if (msg.role === 'user' && msg.content) {
                    return msg.content.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
                }
            } catch {
                // Skip malformed lines
            }
        }
    } catch {
        // Ignore errors reading session
    }

    return undefined;
}

interface ResumePickerContext {
    sessionManager: SessionManager;
    workspaceRoot?: string;
    onBeforeModal?: () => Promise<void> | void;
    onAfterModal?: () => Promise<void> | void;
    interactive?: boolean;
    emptyHint?: string;
    /** Testing seam; defaults to the real showModal. */
    showModal?: typeof showModal;
}

export async function selectResumeSession(ctx: ResumePickerContext): Promise<string | null> {
    const projectFilter = ctx.workspaceRoot ? { project: ctx.workspaceRoot } : undefined;
    const showModalFn = ctx.showModal ?? showModal;
    const pageSize = 20;
    let offset = 0;
    let includeEmpty = false;
    while (true) {
        const recentPage = ctx.sessionManager.listRecentSessions
            ? await ctx.sessionManager.listRecentSessions(projectFilter, pageSize, offset)
            : await ctx.sessionManager.listSessions(projectFilter).then((sessions) => ({
                sessions: sessions.slice(offset, offset + pageSize), total: sessions.length,
            }));
        const { sessions, total } = recentPage;
        if (total === 0) {
            console.log(chalk.gray(ctx.workspaceRoot
                ? `\nNo sessions found for project "${path.basename(ctx.workspaceRoot)}".`
                : `\n${t('commands.sessions.noSessions')}`));
            console.log(chalk.gray(ctx.emptyHint ?? 'Use /sessions to see all sessions across projects.'));
            return null;
        }
        if (ctx.interactive === false) {
            throw new Error('The session picker requires an interactive terminal. Use autohand resume --last or provide a session reference.');
        }

        const entries = await Promise.all(sessions.map(async (session) => ({
            session,
            title: await resolveSessionTitle(session, () => readFirstUserMessage(session)),
        })));
        const { options } = buildSessionPickerRows({
            entries,
            now: new Date(),
            columns: process.stdout.columns ?? 80,
            singleProject: Boolean(projectFilter?.project),
            includeEmpty,
        });
        if (offset > 0) {
            options.push({ label: 'Newer sessions', value: '__previous__' });
        }
        if (offset + pageSize < total) {
            options.push({ label: 'Older sessions', value: '__next__' });
        }

        await ctx.onBeforeModal?.();
        const result = await (async () => {
            try {
                return await showModalFn({ title: 'Resume a session', options, filterable: true, maxVisible: 15 });
            } finally {
                await ctx.onAfterModal?.();
            }
        })();
        if (!result) {
            console.log(chalk.gray('\nResume cancelled.'));
            return null;
        }
        if (result.value === SHOW_EMPTY_VALUE) {
            includeEmpty = true;
        } else if (result.value === '__next__') {
            offset += pageSize;
            includeEmpty = false;
        } else if (result.value === '__previous__') {
            offset = Math.max(0, offset - pageSize);
            includeEmpty = false;
        } else {
            return result.value;
        }
    }
}

export async function resume(ctx: ResumePickerContext & {
    args: string[];
    restoreSession?: (sessionId: string) => Promise<void>;
    restoreLoadedSession?: (session: Session) => Promise<void>;
}): Promise<string | null> {
    try {
        const sessionId = ctx.args[0] ?? await selectResumeSession(ctx);
        if (!sessionId) return null;
        return resumeSession(ctx.sessionManager, sessionId, ctx.restoreSession, ctx.restoreLoadedSession);
    } catch (error) {
        console.error(chalk.red(t('commands.resume.failed', { error: error instanceof Error ? error.message : String(error) })));
        return null;
    }
}

/**
 * Resume a specific session by ID
 */
async function resumeSession(
    sessionManager: SessionManager,
    sessionId: string,
    restoreSession?: (sessionId: string) => Promise<void>,
    restoreLoadedSession?: (session: Session) => Promise<void>,
): Promise<string | null> {
    try {
        const session = await sessionManager.loadSession(sessionId);
        const messages = session.getMessages();

        // Get a title for the session
        const firstUserMessage = messages.find(m => m.role === 'user');
        const title = getSessionDisplayName(session.metadata) ||
            firstUserMessage?.content.slice(0, 50) ||
            'Untitled session';

        console.log(chalk.cyan(`\n${t('commands.resume.resuming', { id: title })}`));
        console.log(chalk.gray(`   Project: ${session.metadata.projectPath}`));
        console.log(chalk.gray(`   Started: ${new Date(session.metadata.createdAt).toLocaleString()}`));
        console.log(chalk.gray(`   Messages: ${messages.length}`));
        console.log();

        // Display recent conversation
        if (messages.length > 0) {
            console.log(chalk.cyan('Recent conversation:'));
            console.log(chalk.gray('─'.repeat(60)));

            const recentMessages = buildSessionChatLog(messages).slice(-5);
            for (const msg of recentMessages) {
                const role = msg.role === 'user'
                    ? chalk.green('You')
                    : chalk.blue('Assistant');

                console.log(`${role}: ${chalk.white(formatChatLogPreview(msg.content))}`);
            }
            console.log(chalk.gray('─'.repeat(60)));
            console.log();
        }

        if (restoreLoadedSession) {
            await restoreLoadedSession(session);
        } else {
            await restoreSession?.(session.metadata.sessionId);
        }

        console.log(chalk.green('Session resumed. Continue typing to chat.\n'));

        return null;
    } catch (error) {
        console.error(chalk.red(t('commands.resume.failed', { error: (error as Error).message })));
        return null;
    }
}
