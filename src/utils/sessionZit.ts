/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

export type SessionZitOption = boolean | string | undefined;

export interface SessionZitInput {
  cwd: string;
  /** The --zit flag value: an explicit intent string, or true. */
  zit: Exclude<SessionZitOption, undefined | false>;
  /** The one-shot prompt, used for the intent when --zit has no value. */
  prompt?: string;
  mode?: 'cli' | 'rpc' | 'acp' | 'patch';
}

export interface SessionZitInfo {
  repoRoot: string;
  workspacePath: string;
  workspaceId: string;
  zitBin: string;
  /** How the agent's shell invokes zit: `zit` when it is on PATH, else the binary's path. */
  zitCommand: string;
  initialized: boolean;
}

export interface SessionZitRecordResult {
  /** The recorded change id, or null when the workspace had no edits. */
  changeId: string | null;
  writes: string[];
}

const DEFAULT_INTENT = 'Autohand session';
const ZIT_AGENT_NAME = 'autohand';
const MAX_SUMMARY_LENGTH = 8000;

interface CommandResult {
  stdout: string;
  stderr: string;
  status: number | null;
  error?: Error;
}

function run(command: string, cwd: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
  });

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
    error: result.error,
  };
}

function failureDetails(result: CommandResult): string {
  return result.stderr.trim() || result.stdout.trim() || result.error?.message || 'unknown error';
}

function ensureGitRepo(cwd: string): string {
  const result = run('git', cwd, ['rev-parse', '--show-toplevel']);
  if (result.status !== 0) {
    throw new Error(`--zit requires a git repository (git rev-parse failed: ${failureDetails(result)})`);
  }

  return result.stdout.trim();
}

export function resolveZitBin(): string {
  const fromEnv = process.env.ZIT_BIN?.trim();
  return fromEnv || 'zit';
}

function ensureZitBin(zitBin: string, cwd: string): void {
  const result = run(zitBin, cwd, ['--version']);
  if (result.error || result.status !== 0) {
    throw new Error(
      `--zit requires the zit CLI, but \`${zitBin}\` could not be run (${failureDetails(result)}). ` +
      'Install it with `cargo install zit`, or set ZIT_BIN to its path.'
    );
  }
}

function hasZitGraph(repoRoot: string): boolean {
  const result = run('git', repoRoot, ['rev-parse', '--verify', '--quiet', 'refs/zit/current']);
  return result.status === 0;
}

/**
 * A ZIT_BIN outside PATH is invisible to the agent's shell commands; put its
 * directory on PATH so `zit claim` works there too.
 */
function exposeZitToShell(zitBin: string): string {
  if (!zitBin.includes(path.sep)) {
    return zitBin;
  }

  const dir = path.dirname(path.resolve(zitBin));
  const entries = (process.env.PATH ?? '').split(path.delimiter);
  if (!entries.includes(dir)) {
    process.env.PATH = [dir, ...entries.filter(Boolean)].join(path.delimiter);
  }
  return path.basename(zitBin) === 'zit' ? 'zit' : path.resolve(zitBin);
}

export function resolveZitIntent(zit: SessionZitInput['zit'], prompt?: string): string {
  if (typeof zit === 'string' && zit.trim()) {
    return zit.trim();
  }

  const firstLine = prompt
    ?.split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return firstLine || DEFAULT_INTENT;
}

/** Keep the end of long summaries: the conclusion of a response is the part worth storing. */
export function trimZitSummary(summary: string): string {
  const trimmed = summary.trim();
  if (trimmed.length <= MAX_SUMMARY_LENGTH) {
    return trimmed;
  }

  return trimmed.slice(trimmed.length - MAX_SUMMARY_LENGTH);
}

export function isSessionZitEnabled(zit: SessionZitOption): zit is Exclude<SessionZitOption, undefined | false> {
  return zit !== undefined && zit !== false;
}

export function buildZitSessionInstructions(info: Pick<SessionZitInfo, 'workspaceId'> & { zitCommand?: string }): string {
  const zit = info.zitCommand ?? 'zit';
  return [
    '## Zit workspace',
    `You are working in a Zit workspace (id ${info.workspaceId}) that is shared with other agents working on the same repository.`,
    '- Your file tools (write, edit, patch, delete, rename) claim each file in Zit before writing it.',
    `- Shell commands are not claimed for you: before changing a file through the shell, run \`${zit} claim <path>\` yourself (or narrower: \`${zit} claim "path#Symbol"\`, \`${zit} claim "path#Section heading"\`).`,
    '- If a claim is refused, another agent holds that resource: pick other work or stop and explain why.',
    `- \`${zit} status\` shows the changes and workspaces other agents hold.`,
    '- Do not commit, branch, or push with git. Zit records your work as a change when the session ends.',
    '- End with a short summary of what you did and why; it is stored with the change.',
  ].join('\n');
}

export function prepareSessionZit(input: SessionZitInput): SessionZitInfo {
  const repoRoot = ensureGitRepo(input.cwd);
  const zitBin = resolveZitBin();
  ensureZitBin(zitBin, repoRoot);

  let initialized = false;
  if (!hasZitGraph(repoRoot)) {
    const init = run(zitBin, repoRoot, ['init']);
    if (init.status !== 0) {
      throw new Error(`Failed to initialise zit: ${failureDetails(init)}`);
    }
    initialized = true;
  }

  const intent = resolveZitIntent(input.zit, input.prompt);
  const result = run(zitBin, repoRoot, [
    'materialise',
    '--json',
    '--agent',
    ZIT_AGENT_NAME,
    '--intent',
    intent,
  ]);
  if (result.status !== 0) {
    throw new Error(`Failed to create zit workspace: ${failureDetails(result)}`);
  }

  let workspace: { id?: unknown; path?: unknown };
  try {
    workspace = JSON.parse(result.stdout) as { id?: unknown; path?: unknown };
  } catch {
    throw new Error(`Failed to create zit workspace: unexpected output: ${result.stdout.trim()}`);
  }
  if (typeof workspace.path !== 'string' || !workspace.path) {
    throw new Error(`Failed to create zit workspace: no path in output: ${result.stdout.trim()}`);
  }

  const workspacePath = workspace.path;
  const workspaceId = typeof workspace.id === 'string' && workspace.id
    ? workspace.id
    : path.basename(path.dirname(workspacePath));

  const zitCommand = exposeZitToShell(zitBin);

  // Shell commands the agent runs (`zit claim`, `zit status`) target this workspace.
  process.env.ZIT_WORKSPACE = workspaceId;

  return {
    repoRoot,
    workspacePath,
    workspaceId,
    zitBin,
    zitCommand,
    initialized,
  };
}

/**
 * Record the workspace as a change and delete it. Synchronous so it can run
 * from process exit handlers.
 */
export function finishSessionZit(info: SessionZitInfo, summary?: string): SessionZitRecordResult {
  const args = ['record', '--json', '--workspace', info.workspaceId, '--dispose'];
  const trimmedSummary = summary ? trimZitSummary(summary) : '';
  if (trimmedSummary) {
    args.push('--summary', trimmedSummary);
  }

  const result = run(info.zitBin, info.repoRoot, args);
  if (result.status !== 0) {
    throw new Error(`Failed to record zit workspace ${info.workspaceId}: ${failureDetails(result)}`);
  }

  let parsed: { change?: { id?: unknown } | null; writes?: unknown };
  try {
    parsed = JSON.parse(result.stdout) as typeof parsed;
  } catch {
    throw new Error(`Failed to record zit workspace ${info.workspaceId}: unexpected output: ${result.stdout.trim()}`);
  }

  const changeId = typeof parsed.change?.id === 'string' ? parsed.change.id : null;
  const writes = Array.isArray(parsed.writes)
    ? parsed.writes.filter((write): write is string => typeof write === 'string')
    : [];

  return { changeId, writes };
}

export interface SessionZitFinalizer {
  /** Record the workspace once; later calls do nothing. */
  finish(summary?: string): void;
}

export interface SessionZitFinalizerOptions {
  /** Summary used when the session ends without an explicit finish (exit or signal). */
  getSummary?: () => string | undefined;
  /**
   * Whether to record and exit on SIGINT/SIGTERM. Interactive sessions leave
   * signals to the agent's own graceful shutdown, which ends in process.exit
   * and so reaches the exit hook.
   */
  exitOnSignal?: () => boolean;
  log?: (line: string) => void;
}

export function createSessionZitFinalizer(
  info: SessionZitInfo,
  options: SessionZitFinalizerOptions = {},
): SessionZitFinalizer {
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  let finished = false;

  const finish = (summary?: string): void => {
    if (finished) return;
    finished = true;
    try {
      const result = finishSessionZit(info, summary);
      log(result.changeId ? `zit: recorded ${result.changeId}` : 'zit: nothing to record');
    } catch (error) {
      log(`zit: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const finishWithDefaultSummary = () => finish(options.getSummary?.());
  process.once('exit', finishWithDefaultSummary);

  const exitOnSignal = options.exitOnSignal;
  if (exitOnSignal) {
    const onSignal = (exitCode: number) => () => {
      if (!exitOnSignal()) return;
      finishWithDefaultSummary();
      process.exit(exitCode);
    };
    process.on('SIGINT', onSignal(130));
    process.on('SIGTERM', onSignal(143));
  }

  return { finish };
}

export type ZitClaimResult = { ok: true } | { ok: false; message: string };

/**
 * Claims files in the session's Zit workspace before a tool writes them.
 * Paths are relative to the workspace; each one is claimed once per session.
 */
export class ZitClaimGuard {
  private readonly granted = new Set<string>();

  constructor(private readonly info: Pick<SessionZitInfo, 'zitBin' | 'workspaceId' | 'workspacePath'>) {}

  claim(paths: string[]): ZitClaimResult {
    const pending = [...new Set(paths)].filter((candidate) => !this.granted.has(candidate));
    if (pending.length === 0) {
      return { ok: true };
    }

    const result = run(this.info.zitBin, this.info.workspacePath, [
      'claim',
      '--workspace',
      this.info.workspaceId,
      ...pending,
    ]);
    if (result.status === 0) {
      for (const candidate of pending) {
        this.granted.add(candidate);
      }
      return { ok: true };
    }

    const output = `${result.stdout}${result.stderr}`.trim();
    if (!result.error && output.startsWith('refused')) {
      return {
        ok: false,
        message: `Zit refused the claim on ${pending.join(', ')}; nothing was written.\n${output}\nAnother agent holds this. Pick other work or stop.`,
      };
    }
    return {
      ok: false,
      message: `zit claim failed for ${pending.join(', ')}; nothing was written: ${failureDetails(result)}`,
    };
  }
}
