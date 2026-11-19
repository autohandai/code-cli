/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import readline from 'node:readline';
import { t } from '../i18n/index.js';
import { AgentRegistry } from '../core/agents/AgentRegistry.js';
import { isAutohandOrchestrationEnabled } from '../core/agent/AutohandOrchestration.js';
import { getProviderConfig, loadConfig, saveConfig } from '../config.js';
import { getProviderRunnableModelOptions } from '../providers/modelCatalog.js';
import { ProviderFactory } from '../providers/ProviderFactory.js';
import { ActiveAgentRegistry, type ActiveAgentRecord } from '../session/ActiveAgentRegistry.js';
import { sanitizeAnnouncementText } from '../announcements/AnnouncementContent.js';
import { showConfirm, showModal } from '../ui/ink/components/Modal.js';
import type { BuiltInProviderName, LoadedConfig, ProviderName } from '../types.js';

export const metadata = {
    command: '/agents',
    description: t('commands.agents.description'),
    implemented: true,
    subcommands: [
        { name: 'help', description: 'show agent commands and keyboard controls' },
        { name: '--live', description: 'watch live Autohand session heartbeats' },
        { name: 'view', description: 'inspect this session’s agent runs, results, and usage' },
        { name: 'provider [agent]', description: 'set the default provider/model or an agent-specific override' },
        { name: 'orchestration [on|off]', description: 'toggle Autohand AI research workers and Moa checkpoint reviews' },
        { name: 'definitions', description: 'list configured sub-agent definitions' },
        { name: 'new', description: 'create a new sub-agent from a description' },
    ],
    prd: 'prd/sub_agents_architecture.md'
};

export interface AgentsCommandDeps {
    onToggleAgentRunsView?: (visible: boolean) => void;
    registry?: ActiveAgentRegistry;
    input?: NodeJS.ReadStream;
    output?: NodeJS.WriteStream;
    config?: LoadedConfig;
    chooseTeamProvider?: (config: LoadedConfig) => Promise<ProviderName | null>;
    chooseTeamModel?: (config: LoadedConfig, provider: ProviderName) => Promise<string | null>;
    confirmTeamModelSelection?: (assignment: { provider: ProviderName; model: string; agentName?: string }) => Promise<boolean>;
    persistConfig?: (config: LoadedConfig) => Promise<void>;
}

const DEFINITION_SUBCOMMANDS = new Set(['definitions', 'defs', 'list-definitions']);
const TEAM_PROVIDER_SUBCOMMANDS = new Set(['provider', 'model']);

export async function handler(args: string[] = [], deps: AgentsCommandDeps = {}): Promise<string | null> {
    const subcommand = args.find((arg) => !arg.startsWith('-'))?.toLowerCase();
    if (subcommand === 'help' || args.includes('--help') || args.includes('-h')) {
        return [
            'Agent commands:',
            '  /agents view              Inspect this session’s direct and team agent runs, results, and usage',
            '                            ↑/↓ select · Enter details · m message · c cancel (confirmation required) · Esc back',
            '                            Messages are queued for the selected worker’s next model step, not marked as read.',
            '  /agents                   Open the session command center: every saved and live session, grouped by directory',
            '                            ↑/↓ or click select · Tab filter · Enter switch to the session · Esc back',
            '  /agents --live            Watch global Autohand session heartbeats (↑/↓ select · Enter details · Esc back)',
            '  /agents --once            Print one global heartbeat snapshot',
            '  /agents definitions       List configured agent definitions',
            '  /agents provider [agent]  Set default or agent-specific provider/model',
            '  /agents orchestration [on|off]  Show or switch Autohand AI orchestration',
            '  /agents new               Create an agent definition',
            '  /team view                Open the current team’s compact activity view',
            '  /squad view               Inspect recorded external Squad runs (independent sessions; read-only)',
        ].join('\n');
    }
    if (subcommand === 'orchestration') {
        const config = deps.config ?? await loadConfig(undefined, process.cwd());
        if (!config.autohandai || config.autohandai.plan !== 'cloud' || config.provider !== 'autohandai') {
            return 'Orchestration is available with the Autohand AI Cloud provider.';
        }
        const choice = args[1]?.toLowerCase();
        if (choice && choice !== 'on' && choice !== 'off') return 'Usage: /agents orchestration [on|off]';
        if (choice) {
            const next = { ...config, autohandai: { ...config.autohandai, orchestration: choice === 'on' } };
            await (deps.persistConfig ?? saveConfig)(next);
            config.autohandai = next.autohandai;
        }
        return `Autohand AI orchestration ${isAutohandOrchestrationEnabled(config) ? 'enabled' : 'disabled'}. `
            + 'Use /model for the lead and /agents provider for workers. Moa reviews require Moa access.';
    }
    if (subcommand === 'view') {
        if (!deps.onToggleAgentRunsView) return 'The session agent inspector is available in an interactive Autohand session. Use /agents view there.';
        deps.onToggleAgentRunsView(true);
        return 'Session agent inspector opened. Use arrows to select, Enter for details, m to message, c to cancel, and Esc to return.';
    }
    if (subcommand && DEFINITION_SUBCOMMANDS.has(subcommand)) {
        return listAgentDefinitions(deps.config);
    }
    if (subcommand && TEAM_PROVIDER_SUBCOMMANDS.has(subcommand)) {
        return configureTeamModelAssignment(args, deps);
    }

    const registry = deps.registry ?? new ActiveAgentRegistry();
    const input = deps.input ?? process.stdin;
    const output = deps.output ?? process.stdout;
    const once = args.includes('--once') || !output.isTTY || !input.isTTY;

    if (once) {
        return formatActiveAgents(await registry.listActive());
    }

    await renderLiveActiveAgents(registry, input, output);
    return null;
}

async function configureTeamModelAssignment(
    args: string[],
    deps: AgentsCommandDeps,
): Promise<string> {
    const agentName = args[1]?.trim() || undefined;
    const config = deps.config ?? await loadConfig(undefined, process.cwd());
    const provider = await (deps.chooseTeamProvider ?? promptForConfiguredTeamProvider)(config);
    if (!provider) return 'Team model selection cancelled.';

    const model = await (deps.chooseTeamModel ?? promptForTeamModel)(config, provider);
    if (!model) return 'Team model selection cancelled.';

    const assignment = { provider, model, ...(agentName ? { agentName } : {}) };
    const confirmed = await (deps.confirmTeamModelSelection ?? promptForTeamModelConfirmation)(assignment);
    if (!confirmed) return 'Team model selection cancelled.';

    if (agentName) {
        config.teams = {
            ...config.teams,
            agentModelOverrides: {
                ...config.teams?.agentModelOverrides,
                [agentName]: { provider, model },
            },
        };
    } else {
        config.teams = {
            ...config.teams,
            defaultProvider: provider,
            defaultModel: model,
        };
    }
    await (deps.persistConfig ?? saveConfig)(config);

    const scope = agentName ? `for ${agentName}` : 'for future teammates';
    return `Saved ${scope}: ${formatProviderAssignment(provider, model)}.`;
}

async function promptForConfiguredTeamProvider(config: LoadedConfig): Promise<ProviderName | null> {
    const configuredProviders = ProviderFactory.getProviderNames(config)
        .filter((provider) => Boolean(getProviderConfig(config, provider)?.model));
    if (configuredProviders.length === 0) {
        return null;
    }

    const choice = await showModal({
        title: 'Choose the provider for your agent team',
        options: configuredProviders.map((provider) => ({
            label: formatProviderAssignment(provider, getProviderConfig(config, provider)?.model ?? ''),
            value: provider,
            description: provider === config.provider ? 'Active session provider' : 'Configured provider',
        })),
    });
    return choice?.value as ProviderName | undefined ?? null;
}

async function promptForTeamModel(config: LoadedConfig, provider: ProviderName): Promise<string | null> {
    const currentModel = getProviderConfig(config, provider)?.model;
    const catalogModels = getProviderRunnableModelOptions(provider as BuiltInProviderName).map((entry) => entry.id);
    const models = [...new Set([currentModel, ...catalogModels].filter((model): model is string => Boolean(model)))];
    if (models.length === 0) return null;

    const choice = await showModal({
        title: `Choose a model for ${formatProviderName(provider)}`,
        options: models.map((model) => ({
            label: model,
            value: model,
            description: model === currentModel ? 'Currently configured' : undefined,
        })),
    });
    return choice?.value ?? null;
}

async function promptForTeamModelConfirmation(
    assignment: { provider: ProviderName; model: string; agentName?: string },
): Promise<boolean> {
    const scope = assignment.agentName
        ? `the ${assignment.agentName} sub-agent`
        : 'new teammates by default';
    return showConfirm({
        title: `Use ${formatProviderAssignment(assignment.provider, assignment.model)} for ${scope}?`,
        confirmText: 'Save assignment',
        cancelText: 'Cancel',
    });
}

function formatProviderAssignment(provider: ProviderName, model: string): string {
    return `${formatProviderName(provider)} · ${model}`;
}

function formatProviderName(provider: ProviderName): string {
    return provider === 'autohandai' ? 'Autohand AI' : provider;
}

export async function listAgentDefinitions(activeConfig?: LoadedConfig): Promise<string> {
    const registry = AgentRegistry.getInstance();
    const config = activeConfig ?? await loadConfig(undefined, process.cwd());
    registry.configureExternalAgents(config.externalAgents);
    await registry.loadAgents();
    const agents = registry.getAllAgents();

    if (agents.length === 0) {
        return `${t('commands.agents.noAgents')}\n${chalk.gray(`Path: ${chalk.cyan(registry.getAgentsDirectory())}`)}`;
    }

    let output = chalk.bold(`${t('commands.agents.definitionsTitle') ?? 'Sub-Agent Definitions'}:\n\n`);

    for (const agent of agents) {
        output += `${chalk.green(agent.name)}\n`;
        output += `  ${chalk.gray(agent.description)}\n`;
        output += `  ${chalk.blue('Path:')} ${agent.path}\n`;
        if (agent.model) {
            output += `  ${chalk.yellow('Model:')} ${agent.model}\n`;
        }
        if (agent.tools?.length) {
            output += `  ${chalk.blue('Tools:')} ${agent.tools.join(', ')}\n`;
        }
        output += '\n';
    }

    return output.trim();
}

export interface ActiveAgentsListView {
    /** Session to mark as selected; presence switches the listing to its navigable live layout. */
    selectedKey: string;
    /** Terminal rows available, so the selected session stays on screen. */
    maxRows?: number;
}

export function activeAgentKey(record: Pick<ActiveAgentRecord, 'sessionId' | 'pid'>): string {
    return `${record.sessionId}:${record.pid}`;
}

export function formatActiveAgents(records: ActiveAgentRecord[], now = new Date(), view?: ActiveAgentsListView): string {
    if (records.length === 0) {
        return [
            chalk.gray('No active Autohand agents found.'),
            chalk.gray('Start another `autohand` session, then run `autohand agents` to see it here.'),
            chalk.gray('Use `autohand agents definitions` or `/agents definitions` for configured sub-agents.'),
        ].join('\n');
    }

    const gutter = view ? '  ' : '';
    const header = [
        chalk.bold('Active Autohand Agents'),
        '',
        `${gutter}${'Status'.padEnd(10)} ${'Project'.padEnd(20)} ${'Session'.padEnd(10)} ${'Model'.padEnd(24)} ${'Ctx'.padEnd(6)} ${'Tokens'.padEnd(8)} ${'Updated'.padEnd(9)} PID`,
        chalk.gray('─'.repeat(100 + gutter.length)),
    ];
    const selectedIndex = view ? Math.max(0, records.findIndex((record) => activeAgentKey(record) === view.selectedKey)) : -1;
    const blocks = records.map((record, index) => formatActiveAgentBlock(record, now, view ? index === selectedIndex : undefined));
    const footer = ['', chalk.gray(view
        ? `${selectedIndex + 1}/${records.length} • ↑/↓ select • Enter details • Esc/Ctrl+C to exit`
        : 'Esc/Ctrl+C to exit • `autohand agents --once` for a static snapshot')];

    const body = blocks.flat();
    const available = Math.max(1, Math.floor(view?.maxRows ?? Infinity) - header.length - footer.length - 1);
    if (!view || body.length <= available) return [...header, ...body, ...footer].join('\n');

    const selectedStart = blocks.slice(0, selectedIndex).reduce((total, block) => total + block.length, 0);
    const selectedEnd = selectedStart + (blocks[selectedIndex]?.length ?? 1);
    const start = Math.min(selectedStart, Math.max(0, selectedEnd - available));
    return [...header, ...body.slice(start, start + available), ...footer].join('\n');
}

function formatActiveAgentBlock(record: ActiveAgentRecord, now: Date, selected?: boolean): string[] {
    const marker = selected === undefined ? '' : selected ? `${chalk.cyan('›')} ` : '  ';
    const indent = selected === undefined ? '' : '  ';
    const statusLabel = record.status === 'working' ? 'working' : 'idle';
    const status = record.status === 'working' ? chalk.yellow(statusLabel.padEnd(10)) : chalk.green(statusLabel.padEnd(10));
    const project = truncate(record.projectName, 20).padEnd(20);
    const session = record.sessionId.slice(0, 8).padEnd(10);
    const model = truncate(record.model, 24).padEnd(24);
    const context = `${Math.round(record.contextPercent)}%`.padEnd(6);
    const tokens = compactNumber(record.sessionTokensUsed ?? record.tokensUsed).padEnd(8);
    const updated = formatAge(now.getTime() - Date.parse(record.updatedAt)).padEnd(9);
    const lines = [`${marker}${status} ${project} ${chalk.cyan(session)} ${model} ${context} ${tokens} ${updated} ${record.pid}`];
    if (!record.activity) return lines;

    lines.push(`${indent}  ${chalk.blue('Phase:')} ${record.activity.phase.replace(/_/gu, ' ')}`);
    const instruction = sanitizePeerText(record.activity.instruction);
    const command = sanitizePeerText(record.activity.command);
    if (instruction) lines.push(`${indent}  ${chalk.blue('Instruction:')} ${instruction}`);
    if (command) lines.push(`${indent}  ${chalk.blue('Command:')} ${command}`);
    const recentPaths = sanitizedPaths(record.activity.pathsWritten, 3);
    if (recentPaths.length > 0) lines.push(`${indent}  ${chalk.blue('Recent paths:')} ${recentPaths.join(', ')}`);
    return lines;
}

export function formatActiveAgentDetails(record: ActiveAgentRecord, now = new Date(), position?: { index: number; total: number }): string {
    const field = (label: string, value: string | undefined) => value ? [`${chalk.blue(`${label}:`)} ${value}`] : [];
    const activity = record.activity;
    const recentPaths = sanitizedPaths(activity?.pathsWritten ?? [], 10);
    return [
        chalk.bold(`Autohand session · ${sanitizePeerText(record.projectName) ?? 'unknown project'} · ${record.status === 'working' ? 'working' : 'idle'}`),
        '',
        ...field('Session', sanitizePeerText(record.sessionId)),
        ...field('Workspace', sanitizePeerText(record.workspaceRoot)),
        ...field('Model', [sanitizePeerText(String(record.provider)), sanitizePeerText(record.model)].filter(Boolean).join(' · ')),
        ...field('Mode', `${record.mode} · PID ${record.pid}`),
        ...field('Started', `${formatAge(now.getTime() - Date.parse(record.startedAt))} ago · updated ${formatAge(now.getTime() - Date.parse(record.updatedAt))}`),
        ...field('Usage', `${Math.round(record.contextPercent)}% context · ${compactNumber(record.sessionTokensUsed ?? record.tokensUsed)} tokens · ${record.messageCount} messages`),
        ...field('Phase', activity?.phase.replace(/_/gu, ' ')),
        ...field('Instruction', sanitizePeerText(activity?.instruction, 1_000)),
        ...field('Command', sanitizePeerText(activity?.command, 1_000)),
        ...field('Recent paths', recentPaths.join(', ')),
        '',
        chalk.gray(`${position ? `${position.index + 1}/${position.total} • ` : ''}↑/↓ other sessions • Esc back to list • Ctrl+C to exit`),
    ].join('\n');
}

const ESCAPE = '\u001b';
const CTRL_C = '\u0003';
const LONE_ESCAPE_TIMEOUT_MS = 50;
const LIVE_KEY_PATTERN = /^(?:\u001b\[[0-?]*[ -/]*[@-~]|\u001bO[@-~]|[^\u001b])/u;
const INCOMPLETE_SEQUENCE_PATTERN = /^\u001b(?:\[[0-?]*[ -/]*|O)?$/u;
const KITTY_KEY_PATTERN = /^\u001b\[(\d+)(?::\d*)*(?:;(\d+)(?::(\d+))?)?(?:;[\d:]*)?u$/u;
const MODIFY_OTHER_KEYS_PATTERN = /^\u001b\[27;(\d+);(\d+)~$/u;
const KEY_RELEASE_EVENT = '3';
const CTRL_MODIFIER = 4;

/**
 * Terminals with the kitty keyboard protocol or xterm modifyOtherKeys enabled
 * (the interactive session turns the former on) report Escape and Ctrl+C as CSI
 * sequences instead of their legacy bytes. Reduce every encoding to the legacy one.
 */
function normalizeLiveKey(sequence: string): string | undefined {
    const kitty = KITTY_KEY_PATTERN.exec(sequence);
    const other = kitty ? null : MODIFY_OTHER_KEYS_PATTERN.exec(sequence);
    if (!kitty && !other) return sequence;
    if (kitty?.[3] === KEY_RELEASE_EVENT) return undefined;
    const code = Number(kitty ? kitty[1] : other?.[2]);
    const modifiers = Number((kitty ? kitty[2] : other?.[1]) ?? 1) - 1;
    if (code === 27) return ESCAPE;
    if (code === 13) return '\r';
    if (code === 99 && (modifiers & CTRL_MODIFIER) !== 0) return CTRL_C;
    return undefined;
}

function byStartOrder(a: ActiveAgentRecord, b: ActiveAgentRecord): number {
    return Date.parse(a.startedAt) - Date.parse(b.startedAt) || activeAgentKey(a).localeCompare(activeAgentKey(b));
}

async function renderLiveActiveAgents(
    registry: ActiveAgentRegistry,
    input: NodeJS.ReadStream,
    output: NodeJS.WriteStream,
): Promise<void> {
    return new Promise((resolve) => {
        const wasRaw = (input as unknown as { isRaw?: boolean }).isRaw;
        const wasPaused = typeof input.isPaused === 'function' ? input.isPaused() : false;
        let completed = false;
        let interval: ReturnType<typeof setInterval> | null = null;

        const cleanup = () => {
            if (completed) return;
            completed = true;
            if (interval) clearInterval(interval);
            if (escapeTimer) clearTimeout(escapeTimer);
            input.off('data', onData);
            if (!wasRaw && typeof input.setRawMode === 'function') {
                try { input.setRawMode(false); } catch {}
            }
            if (wasPaused && typeof input.pause === 'function') {
                input.pause();
            }
            output.write('\x1B[2J\x1B[H\x1B[?25h');
            resolve();
        };

        // Rows keep their start order and the selection follows a session, not a
        // row: the registry returns most-recently-updated first, so every
        // heartbeat would otherwise reshuffle the list under the cursor.
        let records: ActiveAgentRecord[] = [];
        let selectedKey: string | undefined;
        let selectedIndex = 0;
        let detailsOpen = false;
        let lastFrame: string | undefined;
        let refreshing = false;
        let pending = '';
        let escapeTimer: ReturnType<typeof setTimeout> | null = null;

        const paint = () => {
            if (completed) return;
            const found = records.findIndex((record) => activeAgentKey(record) === selectedKey);
            if (found === -1) detailsOpen = false;
            selectedIndex = Math.max(0, Math.min(records.length - 1, found === -1 ? selectedIndex : found));
            const selected = records[selectedIndex];
            selectedKey = selected ? activeAgentKey(selected) : undefined;
            const now = new Date();
            const frame = detailsOpen && selected
                ? formatActiveAgentDetails(selected, now, { index: selectedIndex, total: records.length })
                : formatActiveAgents(records, now, { selectedKey: selectedKey ?? '', maxRows: output.rows });
            if (frame === lastFrame) return;
            const clear = lastFrame === undefined ? '\x1B[?25l\x1B[2J' : '';
            lastFrame = frame;
            output.write(`${clear}\x1B[H${frame.split('\n').map((line) => `${line}\x1B[K`).join('\n')}\n\x1B[J`);
        };

        const select = (offset: number) => {
            selectedIndex = Math.max(0, Math.min(records.length - 1, selectedIndex + offset));
            const next = records[selectedIndex];
            if (next) selectedKey = activeAgentKey(next);
        };

        const handleKey = (key: string | undefined) => {
            if (key === CTRL_C || (key === ESCAPE && !detailsOpen)) cleanup();
            else if (key === ESCAPE) detailsOpen = false;
            else if (key === '\u001b[A' || key === '\u001bOA') select(-1);
            else if (key === '\u001b[B' || key === '\u001bOB') select(1);
            else if (key === '\r' || key === '\n') detailsOpen = records.length > 0;
        };

        const onData = (chunk: Buffer | string) => {
            if (escapeTimer) clearTimeout(escapeTimer);
            escapeTimer = null;
            pending += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
            while (!completed && pending && !INCOMPLETE_SEQUENCE_PATTERN.test(pending)) {
                const key = LIVE_KEY_PATTERN.exec(pending)?.[0] ?? pending[0]!;
                pending = pending.slice(key.length);
                handleKey(normalizeLiveKey(key));
            }
            paint();
            if (completed || !pending) return;
            // A lone ESC is the Escape key only if the rest of a sequence does not follow.
            escapeTimer = setTimeout(() => {
                escapeTimer = null;
                const key = pending === ESCAPE ? ESCAPE : undefined;
                pending = '';
                handleKey(key);
                paint();
            }, LONE_ESCAPE_TIMEOUT_MS);
        };

        const render = async () => {
            if (refreshing) return;
            refreshing = true;
            try {
                records = [...await registry.listActive()].sort(byStartOrder);
                paint();
            } finally {
                refreshing = false;
            }
        };

        if (wasPaused && typeof input.resume === 'function') {
            input.resume();
        }
        readline.emitKeypressEvents(input);
        if (!wasRaw && typeof input.setRawMode === 'function') {
            try { input.setRawMode(true); } catch {}
        }
        input.setEncoding?.('utf8');
        input.on('data', onData);
        render().catch(() => {});
        // Left ref'd on purpose. When /agents runs as a slash command, Ink's
        // teardown in onBeforeModal leaves stdin unref'd, so the 'data' listener
        // above does not hold the event loop open. An unref'd refresh timer let
        // the loop drain and the whole CLI exited cleanly (code 0) right after
        // the first paint instead of showing this view. cleanup() clears it.
        interval = setInterval(() => {
            render().catch(() => {});
        }, 1000);
    });
}

function truncate(value: string, width: number): string {
    if (value.length <= width) return value;
    return `${value.slice(0, Math.max(0, width - 1))}…`;
}

function compactNumber(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return '0';
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return String(Math.round(value));
}

function formatAge(ageMs: number): string {
    if (!Number.isFinite(ageMs) || ageMs < 0) return 'now';
    const seconds = Math.floor(ageMs / 1000);
    if (seconds < 2) return 'now';
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h`;
}

function sanitizePeerText(value: string | undefined, maxCharacters = 200): string | undefined {
    if (!value) return undefined;
    const sanitized = sanitizeAnnouncementText(value, {
        maxCharacters,
        preserveParagraphs: false,
    });
    return sanitized || undefined;
}

function sanitizedPaths(paths: string[], limit: number): string[] {
    return paths.slice(0, limit)
        .map((filePath) => sanitizePeerText(filePath))
        .filter((filePath): filePath is string => Boolean(filePath));
}
