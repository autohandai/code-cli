/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import readline from 'node:readline';
import { t } from '../i18n/index.js';
import { AgentRegistry } from '../core/agents/AgentRegistry.js';
import { loadConfig } from '../config.js';
import { ActiveAgentRegistry, type ActiveAgentRecord } from '../session/ActiveAgentRegistry.js';

export const metadata = {
    command: '/agents',
    description: t('commands.agents.description'),
    implemented: true,
    subcommands: [
        { name: 'definitions', description: 'list configured sub-agent definitions' },
        { name: 'new', description: 'create a new sub-agent from a description' },
    ],
    prd: 'prd/sub_agents_architecture.md'
};

interface AgentsCommandDeps {
    registry?: ActiveAgentRegistry;
    input?: NodeJS.ReadStream;
    output?: NodeJS.WriteStream;
}

const DEFINITION_SUBCOMMANDS = new Set(['definitions', 'defs', 'list-definitions']);

export async function handler(args: string[] = [], deps: AgentsCommandDeps = {}): Promise<string | null> {
    const subcommand = args.find((arg) => !arg.startsWith('-'))?.toLowerCase();
    if (subcommand && DEFINITION_SUBCOMMANDS.has(subcommand)) {
        return listAgentDefinitions();
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

export async function listAgentDefinitions(): Promise<string> {
    const registry = AgentRegistry.getInstance();
    const config = await loadConfig(undefined, process.cwd());
    registry.configureExternalAgents(config.externalAgents);
    await registry.loadAgents();
    const agents = registry.getAllAgents();

    if (agents.length === 0) {
        return `${t('commands.agents.noAgents')}\n${chalk.gray(`Path: ${chalk.cyan(registry.getAgentsDirectory())}`)}`;
    }

    let output = chalk.bold(`${t('commands.agents.definitionsTitle') ?? 'Sub-Agent Definitions'}:\n\n`);

    for (const agent of agents) {
        output += `${chalk.green('🤖 ' + agent.name)}\n`;
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
        interval = setInterval(() => {
            render().catch(() => {});
        }, 1000);
        interval.unref?.();
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
