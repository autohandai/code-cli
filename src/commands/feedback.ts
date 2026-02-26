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
import packageJson from '../../package.json' with { type: 'json' };

export const metadata = {
    command: '/feedback',
    description: t('commands.feedback.description'),
    implemented: true
};

type FeedbackContext = Pick<SlashCommandContext, 'sessionManager' | 'config'>;

// API configuration
const DEFAULT_API_BASE_URL = 'https://api.autohand.ai';
const API_TIMEOUT = 10000;

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
 * Feedback command - captures rating and text feedback, sends to API
 */
export async function feedback(_ctx: FeedbackContext): Promise<string | null> {
    // Check cooldown first
    const cooldown = await checkCooldown();
    if (!cooldown.allowed) {
        console.log(chalk.yellow(`Feedback limit reached (${COOLDOWN_MAX_SUBMISSIONS} per hour).`));
        console.log(chalk.gray(`Please wait ${cooldown.waitMinutes} minute${cooldown.waitMinutes === 1 ? '' : 's'} before submitting again.`));
        return null;
    }

    // Step 1: Prompt for rating (1-5 or skip)
    const ratingAnswer = await safePrompt<{ rating: string }>([
        {
            type: 'select',
            name: 'rating',
            message: 'How would you rate your experience?',
            choices: [
                { name: '5', message: '5 - Excellent' },
                { name: '4', message: '4 - Good' },
                { name: '3', message: '3 - Okay' },
                { name: '2', message: '2 - Poor' },
                { name: '1', message: '1 - Very Poor' },
                { name: 'skip', message: 's - Skip rating' }
            ]
        }
    ]);

    if (!ratingAnswer) {
        console.log(chalk.gray('Feedback discarded.'));
        return null;
    }

    // Step 2: Prompt for feedback text
    const textAnswer = await safePrompt<{ feedback: string }>([
        {
            type: 'input',
            name: 'feedback',
            message: 'What worked? What broke? (optional)'
        }
    ]);

    if (!textAnswer) {
        console.log(chalk.gray('Feedback discarded.'));
        return null;
    }

    // Parse rating (0 for skip, 1-5 otherwise)
    const npsScore = ratingAnswer.rating === 'skip' ? 0 : parseInt(ratingAnswer.rating, 10);
    const freeformFeedback = textAnswer.feedback?.trim() || undefined;

    // Build payload matching API schema
    const now = new Date().toISOString();
    const runtimeError = getLastRuntimeError();
    const deviceId = await getDeviceId();

    const payload = {
        npsScore,
        triggerType: 'manual' as const,
        timestamp: now,
        deviceId,
        cliVersion: packageJson.version,
        platform: process.platform,
        osVersion: os.release(),
        nodeVersion: process.version,
        freeformFeedback,
        env: {
            platform: `${process.platform}-${process.arch}`,
            node: process.version,
            bun: process.versions?.bun,
            cwd: process.cwd(),
            shell: process.env.SHELL
        },
        runtimeError: runtimeError ? formatError(runtimeError) : null
    };

    // Save locally as backup
    try {
        const feedbackPath = AUTOHAND_FILES.feedbackLog;
        await fs.ensureFile(feedbackPath);
        await fs.appendFile(feedbackPath, JSON.stringify(payload) + '\n', 'utf8');
    } catch {
        // Silent fail for local backup - API is primary
    }

    // Send to API
    try {
        const apiBaseUrl = getFeedbackApiBaseUrl(_ctx);
        const response = await sendFeedbackToApi(payload, apiBaseUrl);
        if (response.success) {
            console.log(chalk.green(t('commands.feedback.success')));
        } else {
            // Show specific error if available
            if (/rate limit/i.test(response.error ?? '')) {
                console.log(chalk.yellow('Feedback saved locally (rate limited, will retry later).'));
            } else {
                console.log(chalk.yellow(`Feedback saved locally. ${response.error ? `(${response.error})` : ''}`));
            }
        }
    } catch (error) {
        console.log(chalk.yellow(`Feedback saved locally (${(error as Error).message}).`));
    }

    // Record submission for cooldown tracking
    await recordSubmission();

    if (runtimeError) {
        console.log(chalk.gray('Included recent runtime error in feedback.'));
    }

    return null;
}

/**
 * Send feedback to api.autohand.ai
 */
async function sendFeedbackToApi(
    payload: Record<string, unknown>,
    apiBaseUrl: string
): Promise<{ success: boolean; id?: string; error?: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

    try {
        const response = await fetch(`${apiBaseUrl}/v1/feedback`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CLI-Version': packageJson.version,
                'X-Device-ID': payload.deviceId as string
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

function getFeedbackApiBaseUrl(ctx: FeedbackContext): string {
    return process.env.AUTOHAND_API_URL?.trim()
        || ctx.config?.api?.baseUrl?.trim()
        || DEFAULT_API_BASE_URL;
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
