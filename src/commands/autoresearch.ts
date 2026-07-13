/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommand, SlashCommandContext } from '../core/slashCommandTypes.js';
import { clearSession, type OptimizationDirection, type SubagentDelegationConfig } from '../autoresearch/session.js';
import { AutoResearchManager, type AutoResearchState } from '../autoresearch/manager.js';
import { exportDashboard } from '../autoresearch/export.js';
import { finalizeSession } from '../autoresearch/finalize.js';
import { initExperiment } from '../autoresearch/tools.js';

export const metadata: SlashCommand = {
  command: '/autoresearch',
  description: 'Run autonomous experiment loops: edit, benchmark, keep or revert, repeat.',
  implemented: true,
  subcommands: [
    { name: 'off', description: 'Leave auto-research mode and stop auto-resume' },
    { name: 'clear', description: 'Delete session state after explicit confirmation' },
    { name: 'export', description: 'Open the experiment dashboard' },
    { name: 'finalize', description: 'Write a reviewable finalization plan for kept runs' },
    { name: 'status', description: 'Show current session state and stats' },
  ],
};

interface ParsedArgs {
  subcommand?: 'off' | 'clear' | 'export' | 'finalize' | 'status';
  prompt?: string;
  startOptions?: StartOptions;
}

interface StartOptions {
  metricName?: string;
  metricUnit?: string;
  direction?: OptimizationDirection;
  measureCommand?: string;
  checksCommand?: string;
  maxIterations?: number;
  timeoutMs?: number;
  filesInScope: string[];
  subagents?: SubagentDelegationConfig;
}

function parseArgs(args: string[]): ParsedArgs {
  const first = args[0]?.toLowerCase();
  if (['off', 'clear', 'export', 'finalize', 'status'].includes(first)) {
    return { subcommand: first as ParsedArgs['subcommand'], prompt: args.slice(1).join(' ').trim() || undefined };
  }

  return parseStartArgs(args);
}

function parseStartArgs(args: string[]): ParsedArgs {
  const promptParts: string[] = [];
  const options: StartOptions = { filesInScope: [] };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inlineValue] = splitFlag(arg);
    if (!flag) {
      promptParts.push(arg);
      continue;
    }

    const readValue = (): string | undefined => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }
      const next = args[index + 1];
      if (!next || next.startsWith('--')) {
        return undefined;
      }
      index += 1;
      return next;
    };

    switch (flag) {
      case '--metric':
      case '--metric-name':
        options.metricName = readValue();
        break;
      case '--unit':
      case '--metric-unit':
        options.metricUnit = readValue();
        break;
      case '--direction':
        options.direction = parseDirection(readValue());
        break;
      case '--measure':
      case '--measure-command':
        options.measureCommand = readValue();
        break;
      case '--checks':
      case '--checks-command':
        options.checksCommand = readValue();
        break;
      case '--max-iterations':
        options.maxIterations = parsePositiveInteger(readValue());
        break;
      case '--timeout-ms':
      case '--timeout':
        options.timeoutMs = parsePositiveInteger(readValue());
        break;
      case '--scope': {
        const value = readValue();
        if (value) options.filesInScope.push(value);
        break;
      }
      case '--subagent-ideas':
      case '--subagent-idea-generation':
        options.subagents = { ...options.subagents, ideaGeneration: true };
        break;
      case '--subagent-analysis':
      case '--subagent-measurement-analysis':
        options.subagents = { ...options.subagents, measurementAnalysis: true };
        break;
      case '--subagent-finalization':
        options.subagents = { ...options.subagents, finalization: true };
        break;
      default:
        promptParts.push(arg);
        break;
    }
  }

  const prompt = promptParts.join(' ').trim();
  return prompt ? { prompt, startOptions: options } : {};
}

function splitFlag(arg: string): [string | null, string | undefined] {
  if (!arg.startsWith('--')) {
    return [null, undefined];
  }

  const separator = arg.indexOf('=');
  if (separator === -1) {
    return [arg, undefined];
  }

  return [arg.slice(0, separator), arg.slice(separator + 1)];
}

function parseDirection(value?: string): OptimizationDirection | undefined {
  if (value === 'lower' || value === 'higher') {
    return value;
  }

  return undefined;
}

function parsePositiveInteger(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function hasCompleteBenchmarkOptions(options?: StartOptions): options is StartOptions & {
  metricName: string;
  metricUnit: string;
  direction: OptimizationDirection;
  measureCommand: string;
} {
  return Boolean(options?.metricName && options.metricUnit && options.direction && options.measureCommand);
}

function commandToScript(command: string): string {
  return command.startsWith('#!')
    ? command
    : ['#!/bin/bash', 'set -euo pipefail', command, ''].join('\n');
}

function isClearConfirmed(prompt?: string): boolean {
  const token = prompt?.trim().toLowerCase();
  return token === '--yes' || token === 'yes' || token === 'confirm';
}

/**
 * /autoresearch slash command handler.
 */
export async function autoresearch(
  ctx: SlashCommandContext,
  args: string[] = []
): Promise<string | null> {
  const parsed = parseArgs(args);
  const { workspaceRoot } = ctx;
  const manager = new AutoResearchManager(workspaceRoot);

  switch (parsed.subcommand) {
    case 'clear': {
      if (!isClearConfirmed(parsed.prompt)) {
        return 'Auto-research clear requires confirmation because it deletes .auto session artifacts. Run /autoresearch clear --yes to continue.';
      }
      await clearSession(workspaceRoot);
      return 'Auto-research session cleared. .auto/log.jsonl and state have been reset.';
    }

    case 'off': {
      const message = await manager.pause();
      await emitLifecycleHook(ctx, 'autoresearch:pause', 'off', await manager.getState());
      return message;
    }

    case 'export': {
      const result = await exportDashboard(workspaceRoot);
      return result.message;
    }

    case 'finalize': {
      const result = await finalizeSession(workspaceRoot);
      return result.message;
    }

    case 'status': {
      return manager.getStatus();
    }

    default: {
      if (!parsed.prompt) {
        return showHelp();
      }

      const canResume = await manager.canResume();
      const subcommand = canResume ? 'resume' : 'start';
      const { message, instruction } = canResume
        ? await manager.resume(parsed.prompt)
        : await manager.start(parsed.prompt, parsed.startOptions?.maxIterations);

      let response = message;
      if (!canResume && hasCompleteBenchmarkOptions(parsed.startOptions)) {
        await initExperiment(workspaceRoot, {
          name: parsed.prompt,
          metricName: parsed.startOptions.metricName,
          metricUnit: parsed.startOptions.metricUnit,
          direction: parsed.startOptions.direction,
          measureScript: commandToScript(parsed.startOptions.measureCommand),
          maxIterations: parsed.startOptions.maxIterations,
          timeoutMs: parsed.startOptions.timeoutMs,
          filesInScope: parsed.startOptions.filesInScope,
          checksScript: parsed.startOptions.checksCommand
            ? commandToScript(parsed.startOptions.checksCommand)
            : undefined,
          subagents: parsed.startOptions.subagents,
        });
        response = `${response}\nInitialized benchmark config from command options.`;
      }

      ctx.queueInstruction?.(instruction);
      await emitLifecycleHook(ctx, 'autoresearch:start', subcommand, await manager.getState());
      return response;
    }
  }
}

export async function runAutoResearchCli(workspaceRoot: string, args: string[] = []): Promise<string> {
  const queuedInstructions: string[] = [];
  const result = await autoresearch(
    {
      workspaceRoot,
      isNonInteractive: true,
      queueInstruction: (instruction: string) => {
        queuedInstructions.push(instruction);
      },
    } as SlashCommandContext,
    args
  );

  if (queuedInstructions.length === 0) {
    return result ?? '';
  }

  return [
    result ?? 'Auto-research session updated.',
    '',
    'Loop instruction:',
    queuedInstructions.join('\n\n---\n\n'),
  ].join('\n');
}

async function emitLifecycleHook(
  ctx: SlashCommandContext,
  event: 'autoresearch:start' | 'autoresearch:pause',
  subcommand: 'start' | 'resume' | 'off',
  state: AutoResearchState | null
): Promise<void> {
  await ctx.hookManager?.executeHooks(event, {
    autoresearchGoal: state?.goal,
    autoresearchActive: state?.active,
    autoresearchIteration: state?.iteration,
    autoresearchMaxIterations: state?.maxIterations,
    autoresearchSubcommand: subcommand,
  });
}

function showHelp(): string {
  return [
    'Auto-research: autonomous experiment loops',
    '',
    'Usage:',
    '  /autoresearch <goal>            Start or resume a session',
    '  /autoresearch off               Leave auto-research mode',
    '  /autoresearch clear --yes       Delete session state',
    '  /autoresearch export            Open the dashboard',
    '  /autoresearch finalize          Write a reviewable finalization plan',
    '  /autoresearch status            Show session summary',
    '',
    'Examples:',
    '  /autoresearch optimize unit test runtime',
    '  /autoresearch reduce bundle size',
  ].join('\n');
}
