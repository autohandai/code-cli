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
import { replayExperiment } from '../autoresearch/replay.js';
import {
  compareExperiments,
  getAutoresearchHistory,
  getParetoExperiments,
  pinExperiment,
  pruneArtifacts,
  rescoreExperiments,
} from '../autoresearch/analysis.js';
import type {
  ExperimentConstraintConfig,
  ExperimentRetentionConfig,
  ExperimentSamplingConfig,
  SecondaryObjectiveConfig,
} from '../autoresearch/session.js';

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
    { name: 'history', description: 'List immutable attempts, replayability, decisions, and materialization' },
    { name: 'replay', description: 'Replay an attempt with its original or current evaluator' },
    { name: 'rescore', description: 'Append decisions using stored measurements and the current policy' },
    { name: 'compare', description: 'Compare samples, aggregates, constraints, and decisions' },
    { name: 'pareto', description: 'List constraint-passing non-dominated candidates' },
    { name: 'pin', description: 'Protect candidate artifacts from automatic retention' },
    { name: 'unpin', description: 'Release candidate artifacts for automatic retention' },
    { name: 'prune', description: 'Preview artifact retention, applying only with --yes' },
  ],
};

interface ParsedArgs {
  subcommand?: 'off' | 'clear' | 'export' | 'finalize' | 'status' | 'history'
    | 'replay' | 'rescore' | 'compare' | 'pareto' | 'pin' | 'unpin' | 'prune';
  subcommandArgs?: string[];
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
  secondaryObjectives: SecondaryObjectiveConfig[];
  constraints: ExperimentConstraintConfig[];
  sampling: Partial<ExperimentSamplingConfig>;
  retention: ExperimentRetentionConfig;
  environmentAllowlist: string[];
}

function parseArgs(args: string[]): ParsedArgs {
  const first = args[0]?.toLowerCase();
  if (['off', 'clear', 'export', 'finalize', 'status', 'history', 'replay', 'rescore', 'compare', 'pareto', 'pin', 'unpin', 'prune'].includes(first)) {
    return {
      subcommand: first as ParsedArgs['subcommand'],
      subcommandArgs: args.slice(1),
      prompt: args.slice(1).join(' ').trim() || undefined,
    };
  }

  return parseStartArgs(args);
}

function parseStartArgs(args: string[]): ParsedArgs {
  const promptParts: string[] = [];
  const options: StartOptions = {
    filesInScope: [],
    secondaryObjectives: [],
    constraints: [],
    sampling: {},
    retention: {},
    environmentAllowlist: [],
  };

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
      case '--secondary-objective': {
        const objective = parseSecondaryObjective(readValue());
        if (objective) options.secondaryObjectives.push(objective);
        break;
      }
      case '--constraint': {
        const constraint = parseConstraint(readValue());
        if (constraint) options.constraints.push(constraint);
        break;
      }
      case '--min-samples':
        options.sampling.minSamples = parsePositiveInteger(readValue());
        break;
      case '--max-samples':
        options.sampling.maxSamples = parsePositiveInteger(readValue());
        break;
      case '--confidence':
      case '--confidence-threshold':
        options.sampling.confidenceThreshold = parsePositiveNumber(readValue());
        break;
      case '--max-artifact-bytes':
        options.retention.maxArtifactBytes = parseNonNegativeNumber(readValue());
        break;
      case '--max-artifact-age-days':
        options.retention.maxArtifactAgeDays = parseNonNegativeNumber(readValue());
        break;
      case '--allow-env': {
        const value = readValue();
        if (value) options.environmentAllowlist.push(value);
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

function parsePositiveNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNonNegativeNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseSecondaryObjective(value?: string): SecondaryObjectiveConfig | undefined {
  if (!value) return undefined;
  const match = value.match(/^([^:]+):([^:]*):(lower|higher)$/);
  if (!match) throw new Error(`Invalid --secondary-objective ${value}; expected name:unit:lower|higher.`);
  return { name: match[1], unit: match[2], direction: match[3] as OptimizationDirection };
}

function parseConstraint(value?: string): ExperimentConstraintConfig | undefined {
  if (!value) return undefined;
  const match = value.match(/^([^:]+):(<=|>=|<|>):(.+)$/);
  const threshold = match ? Number(match[3]) : Number.NaN;
  if (!match || !Number.isFinite(threshold)) {
    throw new Error(`Invalid --constraint ${value}; expected metric:operator:value.`);
  }
  return {
    metricName: match[1],
    operator: match[2] as ExperimentConstraintConfig['operator'],
    threshold,
  };
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

    case 'history': {
      return formatHistory(await getAutoresearchHistory(workspaceRoot));
    }

    case 'replay': {
      const attemptId = parsed.subcommandArgs?.[0];
      if (!attemptId) return 'Usage: /autoresearch replay <id> [--evaluator original|current]';
      const evaluatorFlag = parsed.subcommandArgs?.indexOf('--evaluator') ?? -1;
      const evaluatorValue = evaluatorFlag >= 0 ? parsed.subcommandArgs?.[evaluatorFlag + 1] : undefined;
      if (evaluatorValue !== undefined && evaluatorValue !== 'original' && evaluatorValue !== 'current') {
        return 'Replay evaluator must be original or current.';
      }
      const result = await replayExperiment(workspaceRoot, attemptId, {
        evaluator: evaluatorValue as 'original' | 'current' | undefined,
      });
      return result.success
        ? `Attempt ${attemptId} replayed with ${result.evaluatorMode} evaluator: ${result.decision?.outcome}.\n${formatMetricVector(result.metrics)}`
        : `Replay failed for ${attemptId}: ${result.error}`;
    }

    case 'rescore': {
      const all = parsed.subcommandArgs?.includes('--all') ?? false;
      const attemptId = all ? undefined : parsed.subcommandArgs?.[0];
      if (!all && !attemptId) return 'Usage: /autoresearch rescore <id>|--all';
      const result = await rescoreExperiments(workspaceRoot, { attemptId, all });
      return `${result.decisions.length} attempt${result.decisions.length === 1 ? '' : 's'} rescored with the current policy.\n${result.decisions.map((decision) => `${decision.attemptId}: ${decision.outcome}`).join('\n')}`;
    }

    case 'compare': {
      const [left, right] = parsed.subcommandArgs ?? [];
      if (!left || !right) return 'Usage: /autoresearch compare <a> <b>';
      const comparison = await compareExperiments(workspaceRoot, left, right);
      return [
        `Comparison: ${left} vs ${right}`,
        formatComparisonSide(comparison.left),
        formatComparisonSide(comparison.right),
      ].join('\n');
    }

    case 'pareto': {
      const pareto = await getParetoExperiments(workspaceRoot);
      return pareto.attemptIds.length > 0
        ? `Pareto candidates (advisory, not committed winners):\n${pareto.attemptIds.join('\n')}`
        : 'No constraint-passing Pareto candidates are available.';
    }

    case 'pin':
    case 'unpin': {
      const attemptId = parsed.subcommandArgs?.[0];
      if (!attemptId) return `Usage: /autoresearch ${parsed.subcommand} <id>`;
      const pinned = parsed.subcommand === 'pin';
      await pinExperiment(workspaceRoot, attemptId, pinned);
      return `Attempt ${attemptId} ${pinned ? 'pinned' : 'unpinned'}.`;
    }

    case 'prune': {
      const confirmed = parsed.subcommandArgs?.includes('--yes') ?? false;
      const result = await pruneArtifacts(workspaceRoot, {
        dryRun: !confirmed,
        includeProtected: true,
      });
      if (!confirmed) {
        return `Artifact prune preview: ${result.candidates.length} candidate(s), ${result.bytesFreed} bytes. Run /autoresearch prune --yes to apply.`;
      }
      return `Artifact retention pruned ${result.candidates.length} candidate(s) and ${result.bytesFreed} bytes; metadata remains permanent.`;
    }

    default: {
      if (!parsed.prompt) {
        return showHelp();
      }

      const canResume = await manager.canResume();
      let initialized: Awaited<ReturnType<typeof initExperiment>> | undefined;
      if (!canResume && hasCompleteBenchmarkOptions(parsed.startOptions)) {
        initialized = await initExperiment(workspaceRoot, {
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
          secondaryObjectives: parsed.startOptions.secondaryObjectives,
          constraints: parsed.startOptions.constraints,
          sampling: parsed.startOptions.sampling,
          retention: parsed.startOptions.retention,
          environmentAllowlist: parsed.startOptions.environmentAllowlist,
        });
        if (!initialized.success) {
          return `Auto-research initialization failed: ${initialized.message}`;
        }
      }
      const subcommand = canResume ? 'resume' : 'start';
      const { message, instruction } = canResume
        ? await manager.resume(parsed.prompt)
        : await manager.start(parsed.prompt, parsed.startOptions?.maxIterations);

      let response = message;
      if (initialized) {
        response = `${response}\nInitialized benchmark config from command options. Initialized replayable benchmark config with baseline ${initialized.baselineAttemptId}.`;
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
    '  /autoresearch history           List immutable attempts and replayability',
    '  /autoresearch replay <id>       Replay in an isolated detached worktree',
    '  /autoresearch rescore <id>      Append a decision using the current policy',
    '  /autoresearch compare <a> <b>   Compare samples, aggregates, and decisions',
    '  /autoresearch pareto            List advisory non-dominated candidates',
    '  /autoresearch pin|unpin <id>    Change artifact retention protection',
    '  /autoresearch prune [--yes]     Preview or explicitly apply retention',
    '',
    'Examples:',
    '  /autoresearch optimize unit test runtime',
    '  /autoresearch reduce bundle size',
  ].join('\n');
}

function formatHistory(history: Awaited<ReturnType<typeof getAutoresearchHistory>>): string {
  if (history.attempts.length === 0) return 'No auto-research attempts recorded.';
  return [
    'Auto-research history:',
    ...history.attempts.map((attempt) => [
      attempt.attemptId,
      attempt.latestDecision?.outcome ?? 'unknown',
      attempt.replayable ? 'replayable' : 'non-replayable',
      attempt.materialization,
      attempt.pinned ? 'pinned' : '',
      `- ${attempt.description}`,
    ].filter(Boolean).join(' | ')),
  ].join('\n');
}

function formatMetricVector(metrics?: Record<string, number>): string {
  if (!metrics || Object.keys(metrics).length === 0) return 'No metric aggregates.';
  return Object.entries(metrics).map(([name, value]) => `${name}=${value}`).join(', ');
}

function formatComparisonSide(side: Awaited<ReturnType<typeof compareExperiments>>['left']): string {
  return `${side.attemptId}: ${formatMetricVector(Object.fromEntries(Object.entries(side.aggregates).map(([name, aggregate]) => [name, aggregate.median])))} | checks=${side.checks.passed ? 'passed' : 'failed'} | decision=${side.decision?.outcome ?? 'unknown'} | samples=${side.samples.length}`;
}
