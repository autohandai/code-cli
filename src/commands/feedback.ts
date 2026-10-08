/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import { safePrompt } from '../utils/prompt.js';
import type { SlashCommandContext } from '../core/slashCommandTypes.js';
import { AUTOHAND_FILES, AUTOHAND_PATHS } from '../constants.js';
import { buildFeedbackTranscript, redactSensitiveText, type FeedbackTranscript } from '../feedback/sessionTranscript.js';
import packageJson from '../../package.json' with { type: 'json' };

export const metadata = {
    command: '/feedback',
    description: t('commands.feedback.description'),
    implemented: true
};

export type FeedbackCommandContext = Partial<Pick<
    SlashCommandContext,
    | 'config'
    | 'currentSession'
    | 'isNonInteractive'
    | 'onBeforeModal'
    | 'onAfterModal'
    | 'requestFeedbackSurvey'
    | 'notifyUser'
>>;

const USAGE = 'Usage: /feedback <message>';

// API configuration
const DEFAULT_API_BASE_URL = 'https://api.autohand.ai';
// Generous: the request carries the session transcript and runs in the background.
const API_TIMEOUT = 20000;

// Cooldown configuration
const COOLDOWN_MAX_SUBMISSIONS = 5;
const COOLDOWN_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const COOLDOWN_STATE_PATH = `${AUTOHAND_PATHS.feedback}/cooldown.json`;

interface CooldownState {
    submissions: number[]; // timestamps in ms
}

/**
 * Check if user has exceeded feedback rate limit (5 per hour)
 */
async function checkCooldown(): Promise<{ allowed: boolean; remaining: number; waitMinutes?: number }> {
    try {
        if (!await fs.pathExists(COOLDOWN_STATE_PATH)) {
            return { allowed: true, remaining: COOLDOWN_MAX_SUBMISSIONS };
        }

        const state: CooldownState = await fs.readJson(COOLDOWN_STATE_PATH);
        const now = Date.now();
        const windowStart = now - COOLDOWN_WINDOW_MS;

        // Filter to only submissions within the last hour
        const recentSubmissions = state.submissions.filter(ts => ts > windowStart);

        if (recentSubmissions.length >= COOLDOWN_MAX_SUBMISSIONS) {
            // Calculate how long until the oldest submission expires
            const oldestRecent = Math.min(...recentSubmissions);
            const waitMs = oldestRecent + COOLDOWN_WINDOW_MS - now;
            const waitMinutes = Math.ceil(waitMs / 60000);

            return { allowed: false, remaining: 0, waitMinutes };
        }

        return { allowed: true, remaining: COOLDOWN_MAX_SUBMISSIONS - recentSubmissions.length };
    } catch {
        // If state is corrupted, allow submission
        return { allowed: true, remaining: COOLDOWN_MAX_SUBMISSIONS };
    }
}

/**
 * Record a feedback submission for cooldown tracking
 */
async function recordSubmission(): Promise<void> {
    try {
        let state: CooldownState = { submissions: [] };

        if (await fs.pathExists(COOLDOWN_STATE_PATH)) {
            state = await fs.readJson(COOLDOWN_STATE_PATH);
        }

        const now = Date.now();
        const windowStart = now - COOLDOWN_WINDOW_MS;

        // Keep only recent submissions + new one
        state.submissions = state.submissions.filter(ts => ts > windowStart);
        state.submissions.push(now);

        await fs.ensureDir(AUTOHAND_PATHS.feedback);
        await fs.writeJson(COOLDOWN_STATE_PATH, state, { spaces: 2 });
    } catch {
        // Non-critical, continue
    }
}

/**
 * Feedback command. `/feedback <message>` sends the message with the current
 * session transcript and returns at once; the result arrives through
 * `notifyUser`. Without a message it opens the session survey above the
 * composer, and only falls back to a single question where no composer exists.
 */
export async function feedback(ctx: FeedbackCommandContext, args: string[] = []): Promise<string | null> {
    const cooldown = await checkCooldown();
    if (!cooldown.allowed) {
        return [
            chalk.yellow(`Feedback limit reached (${COOLDOWN_MAX_SUBMISSIONS} per hour).`),
            chalk.gray(`Please wait ${cooldown.waitMinutes} minute${cooldown.waitMinutes === 1 ? '' : 's'} before submitting again.`),
        ].join('\n');
    }

    let message = args.join(' ').trim();
    if (!message) {
        if (ctx.requestFeedbackSurvey?.()) {
            return chalk.gray('Rate this session above the composer, or send details with /feedback <message>.');
        }
        if (ctx.isNonInteractive) {
            return USAGE;
        }
        message = await promptForMessage(ctx);
        if (!message) {
            return chalk.gray('Feedback discarded.');
        }
    }

    const { payload, transcript, hasRuntimeError } = await buildFeedbackPayload(ctx, message);
    await saveLocalCopy(payload, transcript);
    await recordSubmission();

    const delivery = deliverFeedback(payload, getFeedbackApiBaseUrl(ctx), hasRuntimeError);
    if (!ctx.notifyUser) {
        return delivery;
    }

    const notifyUser = ctx.notifyUser;
    void delivery.then(notifyUser);
    return chalk.gray(transcript
        ? `Sending feedback with this session's transcript (${transcript.messages.length} messages)…`
        : 'Sending feedback…');
}

async function promptForMessage(ctx: FeedbackCommandContext): Promise<string> {
    await ctx.onBeforeModal?.();
    try {
        const answer = await safePrompt<{ message: string }>([
            {
                type: 'input',
                name: 'message',
                message: 'What would you like to tell us? (press Enter to send, leave empty to cancel)'
            }
        ]);
        return answer?.message?.trim() ?? '';
    } finally {
        await ctx.onAfterModal?.();
    }
}

async function buildFeedbackPayload(ctx: FeedbackCommandContext, message: string): Promise<{
    payload: Record<string, unknown> & { deviceId: string };
    transcript: FeedbackTranscript | undefined;
    hasRuntimeError: boolean;
}> {
    const session = ctx.currentSession;
    const sessionId = session?.metadata.sessionId;
    const builtTranscript = buildFeedbackTranscript(session?.getMessages(), { sessionId });
    const transcript = builtTranscript.messages.length > 0 ? builtTranscript : undefined;
    const runtimeError = getLastRuntimeError();

    return {
        payload: {
            npsScore: 0,
            freeformFeedback: redactSensitiveText(message),
            triggerType: 'manual' as const,
            timestamp: new Date().toISOString(),
            sessionId,
            deviceId: await getDeviceId(),
            cliVersion: packageJson.version,
            platform: process.platform,
            osVersion: os.release(),
            nodeVersion: process.version,
            env: {
                platform: `${process.platform}-${process.arch}`,
                node: process.version,
                bun: process.versions?.bun,
                cwd: redactSensitiveText(process.cwd()),
                shell: process.env.SHELL
            },
            runtimeError: runtimeError ? formatError(runtimeError) : null,
            transcript,
        },
        transcript,
        hasRuntimeError: Boolean(runtimeError),
    };
}

/** The local log is a delivery backup, not a second copy of the conversation. */
async function saveLocalCopy(payload: Record<string, unknown>, transcript: FeedbackTranscript | undefined): Promise<void> {
    try {
        const feedbackPath = AUTOHAND_FILES.feedbackLog;
        await fs.ensureFile(feedbackPath);
        const localCopy = {
            ...payload,
            transcript: transcript && { messageCount: transcript.messageCount, truncated: transcript.truncated },
        };
        await fs.appendFile(feedbackPath, JSON.stringify(localCopy) + '\n', 'utf8');
    } catch {
        // Silent fail for local backup - API is primary
    }
}

/** Never rejects: the outcome is always a line the user can read. */
async function deliverFeedback(
    payload: Record<string, unknown> & { deviceId: string },
    apiBaseUrl: string,
    hasRuntimeError: boolean
): Promise<string> {
    const response = await sendFeedbackToApi(payload, apiBaseUrl);
    if (!response.success) {
        return /rate limit/i.test(response.error ?? '')
            ? chalk.yellow('Feedback saved locally (rate limited, will retry later).')
            : chalk.yellow(`Feedback saved locally${response.error ? ` (${response.error})` : ''}.`);
    }
    return hasRuntimeError
        ? `${chalk.green(t('commands.feedback.success'))}\n${chalk.gray('Included recent runtime error in feedback.')}`
        : chalk.green(t('commands.feedback.success'));
}

/**
 * Send feedback to api.autohand.ai
 */
async function sendFeedbackToApi(
    payload: Record<string, unknown> & { deviceId: string },
    apiBaseUrl: string
): Promise<{ success: boolean; id?: string; error?: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

    try {
        const response = await fetch(getFeedbackSubmitUrl(apiBaseUrl), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CLI-Version': packageJson.version,
                'X-Device-ID': payload.deviceId
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            return { success: false, error: formatFeedbackApiError(response.status, errorText) };
        }

        const data = await response.json() as { success: boolean; id?: string };
        return data;
    } catch (error) {
        clearTimeout(timeoutId);

        if ((error as Error).name === 'AbortError') {
            return { success: false, error: 'Request timeout' };
        }

        return { success: false, error: (error as Error).message };
    }
}

function getFeedbackApiBaseUrl(ctx: FeedbackCommandContext): string {
    return process.env.AUTOHAND_API_URL?.trim()
        || ctx.config?.api?.baseUrl?.trim()
        || DEFAULT_API_BASE_URL;
}

function getFeedbackSubmitUrl(apiBaseUrl: string): string {
    return `${apiBaseUrl.replace(/\/+$/, '')}/v1/feedback`;
}

function formatFeedbackApiError(status: number, rawBody: string): string {
    const body = (rawBody ?? '').replace(/\s+/g, ' ').trim();
    if (!body) {
        return `API error: ${status}`;
    }

    // Prefer concise error fields if backend returned JSON.
    if (body.startsWith('{') || body.startsWith('[')) {
        try {
            const parsed = JSON.parse(body) as Record<string, unknown>;
            const candidate = typeof parsed.error === 'string'
                ? parsed.error
                : typeof parsed.message === 'string'
                    ? parsed.message
                    : typeof parsed.detail === 'string'
                        ? parsed.detail
                        : '';
            if (candidate) {
                return `API error: ${status} ${truncateFeedbackError(candidate)}`;
            }
        } catch {
            // Fall through to generic handling.
        }
    }

    // Cloudflare / WAF challenge pages are HTML and too noisy for terminal output.
    if (isLikelyHtmlChallenge(body)) {
        return status === 403
            ? 'API error: 403 blocked by Cloudflare challenge'
            : `API error: ${status} blocked by upstream challenge page`;
    }

    return `API error: ${status} ${truncateFeedbackError(body)}`;
}

function isLikelyHtmlChallenge(body: string): boolean {
    const lower = body.toLowerCase();
    return lower.includes('<!doctype html')
        || lower.includes('<html')
        || lower.includes('__cf_chl')
        || lower.includes('just a moment')
        || lower.includes('cloudflare');
}

function truncateFeedbackError(text: string, max = 220): string {
    if (text.length <= max) {
        return text;
    }
    return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Get or create anonymous device ID for deduplication
 */
async function getDeviceId(): Promise<string> {
    const deviceIdPath = `${AUTOHAND_PATHS.feedback}/.device-id`;

    try {
        if (await fs.pathExists(deviceIdPath)) {
            return (await fs.readFile(deviceIdPath, 'utf8')).trim();
        }
    } catch {
        // Generate new ID
    }

    // Generate anonymous ID
    const deviceId = `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

    try {
        await fs.ensureDir(AUTOHAND_PATHS.feedback);
        await fs.writeFile(deviceIdPath, deviceId);
    } catch {
        // Non-critical, continue with in-memory ID
    }

    return deviceId;
}

function getLastRuntimeError(): unknown | null {
    const globalAny = globalThis as Record<string, unknown>;
    return globalAny.__autohandLastError ?? null;
}

function formatError(err: unknown): { message?: string; stack?: string } {
    if (!err) return {};
    if (err instanceof Error) {
        return { message: err.message, stack: err.stack };
    }
    if (typeof err === 'object' && err !== null) {
        const errObj = err as Record<string, unknown>;
        const message = 'message' in errObj ? String(errObj.message) : undefined;
        const stack = 'stack' in errObj ? String(errObj.stack) : undefined;
        return { message, stack };
    }
    return { message: String(err) };
}
