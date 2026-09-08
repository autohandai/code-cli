/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import readline from 'node:readline';
import { t } from '../i18n/index.js';
import { AgentRegistry } from '../core/agents/AgentRegistry.js';
import { getProviderConfig, loadConfig, saveConfig } from '../config.js';
import { getProviderModelOptions } from '../providers/modelCatalog.js';
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
        { name: 'view', description: 'inspect this session’s agent runs, results, and usage' },
        { name: 'provider [agent]', description: 'set the default provider/model or an agent-specific override' },
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
            '  /agents                   Watch global Autohand session heartbeats',
            '  /agents --once            Print one global heartbeat snapshot',
            '  /agents definitions       List configured agent definitions',
            '  /agents provider [agent]  Set default or agent-specific provider/model',
            '  /agents new               Create an agent definition',
            '  /team view                Open the current team’s compact activity view',
            '  /squad view               Inspect recorded external Squad runs (independent sessions; read-only)',
        ].join('\n');
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
    const catalogModels = getProviderModelOptions(provider as BuiltInProviderName).map((entry) => entry.id);
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

export function formatActiveAgents(records: ActiveAgentRecord[], now = new Date()): string {
    if (records.length === 0) {
        return [
            chalk.gray('No active Autohand agents found.'),
            chalk.gray('Start another `autohand` session, then run `autohand agents` to see it here.'),
            chalk.gray('Use `autohand agents definitions` or `/agents definitions` for configured sub-agents.'),
        ].join('\n');
    }

    const lines = [
        chalk.bold('Active Autohand Agents'),
        '',
        `${'Status'.padEnd(10)} ${'Project'.padEnd(20)} ${'Session'.padEnd(10)} ${'Model'.padEnd(24)} ${'Ctx'.padEnd(6)} ${'Tokens'.padEnd(8)} ${'Updated'.padEnd(9)} PID`,
        chalk.gray('─'.repeat(100)),
    ];

    for (const record of records) {
        const statusLabel = record.status === 'working' ? 'working' : 'idle';
        const status = record.status === 'working' ? chalk.yellow(statusLabel.padEnd(10)) : chalk.green(statusLabel.padEnd(10));
        const project = truncate(record.projectName, 20).padEnd(20);
        const session = record.sessionId.slice(0, 8).padEnd(10);
        const model = truncate(record.model, 24).padEnd(24);
        const context = `${Math.round(record.contextPercent)}%`.padEnd(6);
        const tokens = compactNumber(record.sessionTokensUsed ?? record.tokensUsed).padEnd(8);
        const updated = formatAge(now.getTime() - Date.parse(record.updatedAt)).padEnd(9);
        lines.push(`${status} ${project} ${chalk.cyan(session)} ${model} ${context} ${tokens} ${updated} ${record.pid}`);
        if (record.activity) {
            const phase = record.activity.phase.replace(/_/gu, ' ');
            lines.push(`  ${chalk.blue('Phase:')} ${phase}`);
            const instruction = sanitizePeerText(record.activity.instruction);
            const command = sanitizePeerText(record.activity.command);
            if (instruction) lines.push(`  ${chalk.blue('Instruction:')} ${instruction}`);
            if (command) lines.push(`  ${chalk.blue('Command:')} ${command}`);
            if (record.activity.pathsWritten.length > 0) {
                const recentPaths = record.activity.pathsWritten
                    .slice(0, 3)
                    .map((filePath) => sanitizePeerText(filePath))
                    .filter((filePath): filePath is string => Boolean(filePath));
                if (recentPaths.length > 0) {
                    lines.push(`  ${chalk.blue('Recent paths:')} ${recentPaths.join(', ')}`);
                }
            }
        }
    }

    lines.push('', chalk.gray('Esc/Ctrl+C to exit • `autohand agents --once` for a static snapshot'));
    return lines.join('\n');
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
            input.off('data', onData);
            if (!wasRaw && typeof input.setRawMode === 'function') {
                try { input.setRawMode(false); } catch {}
            }
            if (wasPaused && typeof input.pause === 'function') {
                input.pause();
            }
            output.write('\x1B[2J\x1B[H');
            resolve();
        };

        const onData = (chunk: Buffer | string) => {
            const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
            if (text.includes('\u001b') || text.includes('\u0003')) {
                cleanup();
            }
        };

        const render = async () => {
            const records = await registry.listActive();
            output.write('\x1B[2J\x1B[H');
            output.write(`${formatActiveAgents(records)}\n`);
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

function sanitizePeerText(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const sanitized = sanitizeAnnouncementText(value, {
        maxCharacters: 200,
        preserveParagraphs: false,
    });
    return sanitized || undefined;
}
