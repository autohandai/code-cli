/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs-extra';
import path from 'node:path';
import {
  computeSessionStats,
  readConfigJson,
  readLogEntries,
  readPromptMd,
  type ExperimentLogEntry,
  type SessionConfig,
  type SessionStats,
} from './session.js';
import {
  getAutoresearchHistory,
  getParetoExperiments,
  type AutoresearchHistoryAttempt,
} from './analysis.js';

const STATE_FILE = '.auto/state.json';
const DEFAULT_MAX_ITERATIONS = 30;

export interface AutoResearchState {
  /** Whether the loop should continue on the next turn. */
  active: boolean;
  /** Original user goal. */
  goal: string;
  /** Number of completed iterations. */
  iteration: number;
  /** Hard cap on iterations. */
  maxIterations: number;
}

export interface AutoResearchSnapshot {
  active: boolean;
  state: AutoResearchState | null;
  config: SessionConfig | null;
  runs: ExperimentLogEntry[];
  stats?: SessionStats;
  attempts?: AutoresearchHistoryAttempt[];
  paretoAttemptIds?: string[];
  statusText: string;
}

/**
 * Coordinates an autonomous auto-research session.
 *
 * The manager does not run the loop itself — it persists state and builds the
 * loop instruction that the agent follows. The agent uses existing tools
 * (write_file, run_experiment, log_experiment, git_commit, delegate_task, etc.)
 * to execute each iteration.
 */
export class AutoResearchManager {
  private statePath: string;

  constructor(private workspaceRoot: string) {
    this.statePath = path.join(workspaceRoot, STATE_FILE);
  }

  private async ensureAutoDir(): Promise<void> {
    await fs.ensureDir(path.join(this.workspaceRoot, '.auto'));
  }

  async getState(): Promise<AutoResearchState | null> {
    if (!(await fs.pathExists(this.statePath))) {
      return null;
    }
    try {
      return (await fs.readJson(this.statePath)) as AutoResearchState;
    } catch {
      return null;
    }
  }

  /**
   * Return true when persisted state or prompt metadata can continue a session.
   */
  async canResume(): Promise<boolean> {
    if (await this.getState()) {
      return true;
    }

    return (await readPromptMd(this.workspaceRoot)) !== null;
  }

  private async setState(state: AutoResearchState): Promise<void> {
    await this.ensureAutoDir();
    await fs.writeJson(this.statePath, state, { spaces: 2 });
  }

  /**
   * Start a new auto-research session.
   */
  async start(goal: string, maxIterations = DEFAULT_MAX_ITERATIONS): Promise<{ message: string; instruction: string }> {
    const state: AutoResearchState = {
      active: true,
      goal,
      iteration: 0,
      maxIterations,
    };
    await this.setState(state);

    return {
      message: `Auto-research session started: ${goal}`,
      instruction: this.buildLoopInstruction(goal),
    };
  }

  /**
   * Resume an active session with additional context.
   */
  async resume(context: string): Promise<{ message: string; instruction: string }> {
    const state = await this.getState();
    const promptDoc = state ? null : await readPromptMd(this.workspaceRoot);
    const goal = state?.goal ?? promptDoc?.goal ?? context;

    await this.setState({
      active: true,
      goal,
      iteration: state?.iteration ?? 0,
      maxIterations: state?.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    });

    return {
      message: `Resuming auto-research session: ${goal}`,
      instruction: this.buildLoopInstruction(goal, context),
    };
  }

  /**
   * Pause the session without deleting state.
   */
  async pause(): Promise<string> {
    const state = await this.getState();
    if (state) {
      state.active = false;
      await this.setState(state);
    }
    return 'Auto-research session paused. Send /autoresearch <goal> to resume.';
  }

  /**
   * Record that a run has been logged without changing active/off state.
   */
  async recordLoggedIteration(iteration: number): Promise<void> {
    const state = await this.getState();
    if (!state) {
      return;
    }

    await this.setState({
      ...state,
      iteration: Math.max(state.iteration, iteration),
    });
  }

  /**
   * Build the system instruction that drives the autonomous experiment loop.
   */
  buildLoopInstruction(goal: string, context?: string): string {
    return [
      '🧪 Auto-research loop',
      '',
      `Goal: ${goal}`,
      context ? `Additional context: ${context}` : '',
      '',
      'You are in an autonomous experiment loop. Each iteration you must propose ONE focused change, let the deterministic engine measure and decide it, then commit only accepted candidates.',
      '',
      'Session setup contract:',
      '- If .auto/config.json or .auto/measure.sh is missing, infer the initial experiment contract from the user goal, repository scripts, nearby tests, and workspace context before editing code.',
      '- Establish the objective, benchmark command, metric name, metric unit, and optimization direction.',
      '- Establish the editable scope, correctness checks, maximum iterations, and optional subagent phases for idea generation, measurement analysis, and finalization.',
      '- Ask concise setup questions only for fields that remain uncertain after inference. Do not start an experiment run until the required benchmark and metric fields are known.',
      '- A new replayable session requires a clean Git repository. Once the setup contract is complete, call init_experiment so it captures a sampled zero-diff baseline and persists the versioned .auto/ledger.',
      '',
      'Before each iteration, read .auto/config.json, .auto/prompt.md, and the tail of .auto/log.jsonl to understand what has been tried.',
      'If .auto/config.json enables subagent phases or .auto/prompt.md has a "Subagent delegation" section, use the existing delegate_task or delegate_parallel tools for those phases.',
      '',
      'Iteration steps:',
      '1. Reflect on immutable attempts from /autoresearch history and the compatibility projection in .auto/log.jsonl.',
      '2. Optionally delegate configured idea generation or measurement analysis to a sub-agent using delegate_task or delegate_parallel. Example: ask a sub-agent to "list 3 ways to reduce ${goal}" or to "analyze why run 5 regressed"',
      '3. Propose a single, testable change to code/tests/config. Apply it with write_file, apply_patch, or run_command.',
      '4. Run run_experiment with a short description. Every benchmark invocation must print exactly one finite METRIC <name>=<number> for every configured objective. The tool returns attemptId, samples, metric vectors, and the engine decision.',
      '5. If the engine decision is accepted, stage and commit the retained candidate using git_add and git_commit. Rejected, checks-failed, crashed, and inconclusive candidates are already reverted but remain replayable in the ledger.',
      '6. Call log_experiment with attemptId and description (plus the accepted commit hash when applicable). Never supply a model status to override a ledger decision.',
      '7. Update .auto/prompt.md to record the new idea in Tried, DeadEnds, or Wins as appropriate.',
      '8. Repeat from step 1 unless iteration count reaches maxIterations or the user sends /autoresearch off.',
      '',
      'Backpressure and sampling are engine-owned: hard constraints and .auto/checks.sh fail closed; noisy overlap samples adaptively from 3 up to 9 by default.',
      '',
      'Stop conditions:',
      '- maxIterations reached',
      '- No measurable improvement across several runs',
      '- The user sends /autoresearch off',
      '- A change is too risky or touches files outside the stated scope',
      '',
      'Always be concise in your reasoning and keep the loop moving.',
    ].join('\n');
  }

  /**
   * Return a human-readable status summary.
   */
  async getStatus(): Promise<string> {
    const config = await readConfigJson(this.workspaceRoot);
    const state = await this.getState();
    const entries = await readLogEntries(this.workspaceRoot);

    if (!config) {
      return state?.goal
        ? `Session goal: ${state.goal}\nNo config yet — run init_experiment to configure the benchmark.`
        : 'No active auto-research session.';
    }

    const kept = entries.filter((e) => e.status === 'kept').length;
    const discarded = entries.filter((e) => e.status === 'discarded').length;
    const checksFailed = entries.filter((e) => e.status === 'checks_failed').length;
    const crashed = entries.filter((e) => e.status === 'crashed').length;
    const iteration = Math.max(state?.iteration ?? 0, entries.length);
    const stats = computeSessionStats(entries, config.direction);

    const lines = [
      `Session: ${config.name}`,
      `Goal: ${state?.goal ?? config.name}`,
      `Metric: ${config.metricName} (${config.metricUnit}) — ${config.direction} is better`,
      `Iterations: ${iteration} / ${config.maxIterations ?? state?.maxIterations ?? DEFAULT_MAX_ITERATIONS}`,
      `Runs logged: ${entries.length} (${kept} kept, ${discarded} discarded, ${checksFailed} checks failed, ${crashed} crashed)`,
    ];

    if (stats.runCount > 0) {
      lines.push(
        `Best: run ${stats.bestRun} at ${formatMetric(stats.bestMetric, config.metricUnit)} (baseline ${formatMetric(stats.baselineMetric, config.metricUnit)})`
      );
    }

    if (stats.confidence !== undefined) {
      lines.push(`Confidence: ${stats.confidence.toFixed(2)} (MAD ${formatMetric(stats.mad ?? 0, config.metricUnit)})`);
    }

    if (config.ledgerVersion) {
      const [history, pareto] = await Promise.all([
        getAutoresearchHistory(this.workspaceRoot),
        getParetoExperiments(this.workspaceRoot),
      ]);
      const replayable = history.attempts.filter((attempt) => attempt.replayable).length;
      const drifted = history.attempts.filter((attempt) =>
        (attempt.latestEvaluation?.driftWarnings.length ?? 0) > 0
      ).length;
      lines.push(`Ledger: ${history.attempts.length} attempts (${replayable} replayable, ${drifted} with replay drift)`);
      lines.push(`Pareto candidates (advisory): ${pareto.attemptIds.length > 0 ? pareto.attemptIds.join(', ') : 'none'}`);
    }

    return lines.join('\n');
  }

  /**
   * Return structured state for non-terminal clients.
   */
  async getSnapshot(): Promise<AutoResearchSnapshot> {
    const config = await readConfigJson(this.workspaceRoot);
    const state = await this.getState();
    const runs = await readLogEntries(this.workspaceRoot);
    const stats = config ? computeSessionStats(runs, config.direction) : undefined;
    const history = config?.ledgerVersion ? await getAutoresearchHistory(this.workspaceRoot) : undefined;
    const pareto = config?.ledgerVersion ? await getParetoExperiments(this.workspaceRoot) : undefined;

    return {
      active: state?.active ?? false,
      state,
      config,
      runs,
      stats,
      attempts: history?.attempts,
      paretoAttemptIds: pareto?.attemptIds,
      statusText: await this.getStatus(),
    };
  }
}

function formatMetric(value: number, unit: string): string {
  const rounded = Number.isInteger(value)
    ? value.toString()
    : value.toFixed(4).replace(/\.?0+$/, '');

  return unit ? `${rounded} ${unit}` : rounded;
}
