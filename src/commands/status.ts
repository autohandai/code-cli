/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import readline from 'node:readline';
import { t } from '../i18n/index.js';
import type { SlashCommandContext } from '../core/slashCommandTypes.js';
import type { AutohandConfig } from '../types.js';
import { cleanupModalRender, prepareModalRender } from '../ui/ink/components/Modal.js';
import { formatSessionActualTokens } from '../core/agent/AgentFormatter.js';
import { createCommandTheme } from './commandTheme.js';
import {
    formatAccountPlanAllowance,
    formatAccountPlanName,
    formatAccountPlanThroughput,
    formatUsageDashboard,
    gatherUsageDashboardData,
    resolveAccountEntitlement,
} from './usage.js';
import { formatAccount } from './accountDisplay.js';
import type { AccountEntitlement } from '../auth/AuthClient.js';
import packageJson from '../../package.json' with { type: 'json' };

export const metadata = {
    command: '/status',
    description: 'Show Autohand status including version, model, API connectivity, and usage',
    implemented: true
};

type TabName = 'Status' | 'Config' | 'Usage';

interface StatusData {
    version: string;
    sessionId: string | null;
    cwd: string;
    provider: string;
    model: string;
    account: string;
    accountEntitlement: AccountEntitlement | null;
    apiConnected: boolean;
    sessionsCount: number;
    contextPercentLeft: number;
    totalTokensUsed: number;
    tokenUsageStatus: 'actual' | 'unavailable';
    usageV2Dashboard: string | null;
    config: AutohandConfig | undefined;
    contextCompactionEnabled: boolean;
}

export async function status(ctx: SlashCommandContext): Promise<string | null> {
    // Gather all data upfront
    const data = await gatherStatusData(ctx);

    // Render interactive UI
    await renderStatusUI(data);

    return null;
}

async function gatherStatusData(ctx: SlashCommandContext): Promise<StatusData> {
    const currentSession = ctx.sessionManager.getCurrentSession();
    const allSessions = await ctx.sessionManager.listSessions();

    // Check API connectivity
    let apiConnected = false;
    try {
        apiConnected = await ctx.llm.isAvailable();
    } catch {
        apiConnected = false;
    }

    const accountEntitlement = await resolveAccountEntitlement(ctx);

    return {
        version: packageJson.version,
        sessionId: currentSession?.metadata.sessionId ?? null,
        cwd: ctx.workspaceRoot,
        provider: ctx.provider ?? 'openrouter',
        model: ctx.model,
        account: formatAccount(ctx.config),
        accountEntitlement,
        apiConnected,
        sessionsCount: allSessions.length,
        contextPercentLeft: ctx.getContextPercentLeft?.() ?? 100,
        totalTokensUsed: ctx.getTotalTokensUsed?.() ?? 0,
        tokenUsageStatus: ctx.getTokenUsageStatus?.() ?? 'actual',
        usageV2Dashboard: ctx.isFeatureEnabled?.('usage_v2', ctx.config?.features?.usageV2 === true)
            ? formatUsageDashboard(gatherUsageDashboardData(ctx), accountEntitlement)
            : null,
        config: ctx.config,
        contextCompactionEnabled: ctx.isContextCompactionEnabled?.() ?? true,
    };
}

function renderStatusUI(data: StatusData): Promise<void> {
    return new Promise((resolve) => {
        const tabs: TabName[] = ['Status', 'Config', 'Usage'];
        let currentTab = 0;
        let completed = false;
        let keepAlive: ReturnType<typeof setInterval> | null = null;

        const input = process.stdin as NodeJS.ReadStream;
        const isTTY = input.isTTY;
        const useAlternateScreen = process.stdout.isTTY;

        // Store original input state so we can restore it on exit
        const wasRaw = (input as any).isRaw;
        const wasPaused = typeof input.isPaused === 'function' ? input.isPaused() : false;

        if (useAlternateScreen) {
            prepareModalRender(process.stdout);
        }

        if (wasPaused && typeof input.resume === 'function') {
            input.resume();
        }

        if (isTTY) {
            // Ensure we receive raw byte sequences (works even if readline keypress events are unavailable)
            readline.emitKeypressEvents(input);
            if (!wasRaw && typeof input.setRawMode === 'function') {
                try { input.setRawMode(true); } catch { /* TTY may be gone */ }
            }
            if (typeof input.setEncoding === 'function') {
                input.setEncoding('utf8');
            }
        }

        const render = () => {
            const theme = createCommandTheme();
            // Clear screen and move cursor to top
            process.stdout.write('\x1B[2J\x1B[H');

            renderTabHeader(tabs, currentTab);
            renderTabContent(tabs[currentTab], data);
            console.log(theme.muted('\nEsc to exit'));
        };

        let buffer = '';
        let escTimer: ReturnType<typeof setTimeout> | null = null;

        const clearEscTimer = () => {
            if (escTimer) {
                clearTimeout(escTimer);
                escTimer = null;
            }
        };

        const handler = (chunk: Buffer | string) => {
            clearEscTimer();
            buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');

            const processNext = (): boolean => {
                if (!buffer.length) {
                    return false;
                }

                const first = buffer[0];

                if (first === '\u001b') {
                    if (buffer.length === 1) {
                        // Wait for rest of escape sequence (arrow keys, shift+tab, etc.)
                        return false;
                    }

                    if (buffer[1] === '[') {
                        if (buffer.length < 3) {
                            return false;
                        }
                        const seq = buffer.slice(0, 3);
                        buffer = buffer.slice(3);
                        handleSequence(seq);
                        return true;
                    }

                    // Standalone ESC
                    buffer = buffer.slice(1);
                    handleSequence('\u001b');
                    return true;
                }

                // Regular single character input (tab, ctrl+c, etc.)
                buffer = buffer.slice(1);
                handleSequence(first);
                return true;
            };

            while (processNext()) {
                // Keep processing buffered sequences until we run out or need more bytes
            }

            // A lone ESC is indistinguishable from the start of an arrow-key
            // sequence until the next byte arrives — and for a real Esc press
            // that byte never comes, so the panel would ignore the exit key it
            // advertises. Settle it the way terminals do: if nothing follows
            // shortly, it was a standalone Esc.
            if (buffer === '\u001b') {
                escTimer = setTimeout(() => {
                    escTimer = null;
                    if (buffer === '\u001b') {
                        buffer = '';
                        handleSequence('\u001b');
                    }
                }, 50);
            }
        };

        const handleSequence = (sequence: string) => {
            switch (sequence) {
                case '\u001b': // ESC
                case '\u0003': // Ctrl+C
                    cleanup();
                    resolve();
                    return;
                case '\t': // Tab
                case '\u001b[C': // Right arrow
                    currentTab = (currentTab + 1) % tabs.length;
                    render();
                    return;
                case '\u001b[Z': // Shift+Tab
                case '\u001b[D': // Left arrow
                    currentTab = (currentTab - 1 + tabs.length) % tabs.length;
                    render();
                    return;
                default:
                    return;
            }
        };

        const cleanup = () => {
            if (completed) {
                return;
            }
            completed = true;

            clearEscTimer();
            if (keepAlive) {
                clearInterval(keepAlive);
                keepAlive = null;
            }
            input.off('data', handler);
            if (isTTY && !wasRaw && typeof input.setRawMode === 'function') {
                try { input.setRawMode(false); } catch { /* TTY may be gone */ }
            }
            if (wasPaused && typeof input.pause === 'function') {
                input.pause();
            }
            // Clear screen before returning
            process.stdout.write('\x1B[2J\x1B[H');
            if (useAlternateScreen) {
                cleanupModalRender(process.stdout);
            }
        };

        input.on('data', handler);
        // Ink's teardown in onBeforeModal leaves stdin unref'd, so the 'data'
        // listener above does not hold the event loop open. Without a ref'd
        // handle the runtime drains the loop and exits cleanly (code 0) right
        // after the first paint, taking the whole CLI down instead of showing
        // this panel. Own the keep-alive here rather than re-ref'ing stdin so
        // the modal restores the exact stdin state it inherited. Deliberately
        // not unref'd — that would defeat the purpose.
        keepAlive = setInterval(() => { }, 60_000);
        render();
    });
}

function renderTabHeader(tabs: TabName[], currentIndex: number): void {
    const theme = createCommandTheme();
    const header = tabs.map((tab, i) => {
        return i === currentIndex
            ? theme.selectedTab(tab)
            : theme.tab(tab);
    }).join('  ');

    console.log(`Settings: ${header}  ${theme.muted('(tab to cycle)')}\n`);
}

function renderTabContent(tab: TabName, data: StatusData): void {
    switch (tab) {
        case 'Status':
            renderStatusTab(data);
            break;
        case 'Config':
            renderConfigTab(data);
            break;
        case 'Usage':
            renderUsageTab(data);
            break;
    }
}

function renderStatusTab(data: StatusData): void {
    const theme = createCommandTheme();
    console.log(theme.bold(`${t('commands.status.version')}:`), data.version);
    console.log(theme.bold(`${t('commands.status.sessionId')}:`), data.sessionId ?? theme.muted('none'));
    console.log(theme.bold(`${t('commands.status.cwd')}:`), data.cwd);
    console.log(theme.bold(`${t('commands.status.provider')}:`), data.provider);
    console.log(theme.bold(`${t('commands.status.model')}:`), data.model);
    console.log(theme.bold('Account:'), data.account);
    if (data.accountEntitlement) {
        console.log(theme.bold('Plan:'), formatAccountPlanName(data.accountEntitlement));
        const allowance = formatAccountPlanAllowance(data.accountEntitlement);
        if (allowance) {
            console.log(theme.bold('Allowance:'), allowance);
        }
        const throughput = formatAccountPlanThroughput(data.accountEntitlement);
        if (throughput) {
            console.log(theme.bold('Throughput:'), throughput);
        }
    }
    console.log(
        theme.bold('Context Compaction:'),
        data.contextCompactionEnabled ? theme.success('ON') : theme.warning('OFF')
    );
    console.log();
    console.log(
        theme.bold(`${t('commands.status.apiStatus')}:`),
        data.apiConnected ? theme.success(t('commands.status.connected')) : theme.error(t('commands.status.disconnected'))
    );
    console.log(theme.bold(`${t('commands.status.sessions')}:`), t('commands.status.total', { count: String(data.sessionsCount) }));
    console.log(theme.bold('Memory:'), 'user (~/.autohand/memory/), project (.autohand/memory/)');
}

function renderConfigTab(data: StatusData): void {
    const theme = createCommandTheme();
    const config = data.config;

    console.log(theme.bold('Autohand preferences\n'));

    const settings: Array<[string, string]> = [
        ['Theme', config?.ui?.theme ?? 'dark'],
        ['Auto-confirm', config?.ui?.autoConfirm ? 'true' : 'false'],
        ['Silent tool output', config?.ui?.silentToolOutput === true ? 'true' : 'false'],
        ['Show thinking', config?.ui?.showThinking !== false ? 'true' : 'false'],
        ['Show completion notification', config?.ui?.showCompletionNotification !== false ? 'true' : 'false'],
        ['Permission mode', config?.permissions?.mode ?? 'interactive'],
        ['Telemetry', config?.telemetry?.enabled === true ? 'true' : 'false'],
        ['Network retries', String(config?.network?.maxRetries ?? 3)],
        ['Network timeout', `${config?.network?.timeout ?? 30000}ms`],
    ];

    for (const [name, value] of settings) {
        console.log(`  ${theme.accent(name.padEnd(30))} ${value}`);
    }
}

function renderUsageTab(data: StatusData): void {
    const theme = createCommandTheme();
    if (data.usageV2Dashboard) {
        console.log(data.usageV2Dashboard);
        return;
    }

    const contextUsed = 100 - data.contextPercentLeft;

    console.log(theme.bold('Current session\n'));

    renderProgressBar('Context used (estimated)', contextUsed, 100);
    console.log();

    console.log(theme.bold('Actual tokens used:'), formatSessionActualTokens(data.totalTokensUsed, data.tokenUsageStatus));
}

function renderProgressBar(label: string, value: number, max: number): void {
    const theme = createCommandTheme();
    const width = 30;
    const filled = Math.round((value / max) * width);
    const empty = width - filled;
    const bar = theme.progressFilled('\u2588'.repeat(filled)) + theme.progressEmpty('\u2591'.repeat(empty));
    const percent = Math.round((value / max) * 100);

    console.log(label);
    console.log(`${bar}  ${percent}% used`);
}
