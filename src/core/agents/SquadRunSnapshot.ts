/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import type { AgentRun, AgentRunStore } from './AgentRunStore.js';

const MAX_RECORD_BYTES = 65_536;
const MAX_DIRECTORY_ENTRIES = 1_000;
const MAX_RUNS = 100;
const RECORDED_STATUS = 'Squad runs are independent sessions with their own budgets. Showing last recorded daemon state; control these runs in Squad.';
const RUN_STATUSES = ['queued', 'running', 'completed', 'failed', 'rejected'] as const;
type SquadRunStatus = typeof RUN_STATUSES[number];

export interface SquadRunSummary {
  id: string;
  workspaceRoot: string;
  agentName: string;
  task: string;
  status: SquadRunStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  exitCode?: number;
  channelId?: string;
  threadId?: string;
}

export interface SquadRunSnapshot {
  runs: SquadRunSummary[];
  available: boolean;
  message: string;
}

export interface SquadRunSnapshotOptions {
  workspaceRoot: string;
  env?: NodeJS.ProcessEnv;
  limit?: number;
}

function recordObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function displayText(value: string, limit: number): string {
  return [...stripVTControlCharacters(value)]
    .map(char => char === '\n' || char === '\t' ? ' ' : char)
    .filter(char => char.codePointAt(0)! >= 32 && char.codePointAt(0)! !== 127)
    .join('').slice(0, limit).trim();
}

function timestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function readRecord(filePath: string): Promise<unknown> {
  const handle = await fs.open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > MAX_RECORD_BYTES) throw new Error('Invalid record size.');
    const buffer = Buffer.alloc(MAX_RECORD_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_RECORD_BYTES) throw new Error('Record size changed.');
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) as unknown;
  } finally {
    await handle.close();
  }
}

function parseRun(value: unknown): { workspace: string; run: SquadRunSummary } | undefined {
  if (!recordObject(value)
    || typeof value.workspace !== 'string'
    || !path.isAbsolute(value.workspace)
    || typeof value.id !== 'string' || !value.id.trim()
    || typeof value.prompt !== 'string'
    || !RUN_STATUSES.includes(value.status as SquadRunStatus)) return undefined;
  const createdAt = timestamp(value.createdAt);
  if (createdAt === undefined) return undefined;
  const startedAt = timestamp(value.startedAt);
  const completedAt = timestamp(value.completedAt);
  return {
    workspace: value.workspace,
    run: {
      id: displayText(value.id, 256),
      workspaceRoot: value.workspace,
      agentName: typeof value.agentId === 'string' ? displayText(value.agentId, 128) : 'Squad agent',
      task: displayText(value.prompt, 4_096),
      status: value.status as SquadRunStatus,
      createdAt,
      ...(startedAt !== undefined ? { startedAt } : {}),
      ...(completedAt !== undefined ? { completedAt } : {}),
      ...(typeof value.exitCode === 'number' && Number.isSafeInteger(value.exitCode) ? { exitCode: value.exitCode } : {}),
      ...(typeof value.channelId === 'string' ? { channelId: displayText(value.channelId, 256) } : {}),
      ...(typeof value.threadId === 'string' ? { threadId: displayText(value.threadId, 256) } : {}),
    },
  };
}

export async function readSquadRunSnapshot(options: SquadRunSnapshotOptions): Promise<SquadRunSnapshot> {
  const env = options.env ?? process.env;
  const root = env.AUTOHAND_SQUAD_HOME
    || path.join(env.AUTOHAND_HOME || path.join(homedir(), '.autohand'), 'squad');
  const runsDirectory = path.join(root, 'runs');
  const workspace = await fs.realpath(options.workspaceRoot).catch(() => path.resolve(options.workspaceRoot));
  const limit = Number.isSafeInteger(options.limit) && options.limit! > 0
    ? Math.min(options.limit!, MAX_RUNS) : MAX_RUNS;
  const candidates: string[] = [];
  let skipped = 0;
  let truncated = false;
  try {
    const directory = await fs.opendir(runsDirectory);
    let scanned = 0;
    for await (const entry of directory) {
      if (++scanned > MAX_DIRECTORY_ENTRIES) { truncated = true; break; }
      if (!entry.name.endsWith('.json')) continue;
      if (!entry.isFile()) { skipped++; continue; }
      candidates.push(entry.name);
    }
  } catch {
    return { available: false, runs: [], message: `Squad run records are unavailable. ${RECORDED_STATUS}` };
  }
  const runs: SquadRunSummary[] = [];
  const seen = new Set<string>();
  for (const name of candidates.sort().reverse()) {
    try {
      const parsed = parseRun(await readRecord(path.join(runsDirectory, name)));
      if (!parsed) { skipped++; continue; }
      const runWorkspace = await fs.realpath(parsed.workspace).catch(() => path.resolve(parsed.workspace));
      if (runWorkspace !== workspace || seen.has(parsed.run.id)) continue;
      seen.add(parsed.run.id);
      runs.push({ ...parsed.run, workspaceRoot: runWorkspace });
    } catch {
      skipped++;
    }
  }
  return {
    available: true,
    runs: runs.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit),
    message: [RECORDED_STATUS, skipped ? `${skipped} invalid or unsafe records skipped.` : '',
      truncated ? `Listing limited to ${MAX_DIRECTORY_ENTRIES} directory entries.` : ''].filter(Boolean).join(' '),
  };
}

interface SquadRunMonitorOptions extends SquadRunSnapshotOptions {
  getWorkspaceRoot?: () => string;
  isVisible?: () => boolean;
  signal?: AbortSignal;
}

export class SquadRunMonitor {
  private timer?: ReturnType<typeof setInterval>;
  private refreshing = false;
  private stopped = false;
  private readonly onAbort = () => this.stop();

  constructor(private readonly store: AgentRunStore, private readonly options: SquadRunMonitorOptions) {
    this.stopped = options.signal?.aborted === true;
    if (!this.stopped) options.signal?.addEventListener('abort', this.onAbort, { once: true });
  }

  start(): void {
    if (this.stopped) return;
    if (!this.timer) {
      this.timer = setInterval(() => { void this.refresh(); }, 5_000);
      this.timer.unref();
    }
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.stopped || this.refreshing || this.options.isVisible?.() === false) return;
    const workspaceRoot = this.options.getWorkspaceRoot?.() ?? this.options.workspaceRoot;
    this.refreshing = true;
    try {
      const snapshot = await readSquadRunSnapshot({ ...this.options, workspaceRoot });
      if (this.stopped || workspaceRoot !== (this.options.getWorkspaceRoot?.() ?? this.options.workspaceRoot)) return;
      const runs: AgentRun[] = snapshot.runs.map(run => ({
        id: `squad:${run.id}`,
        source: 'squad',
        name: run.agentName,
        task: run.task,
        workspaceRoot: run.workspaceRoot,
        status: run.status === 'queued' ? 'pending' : run.status === 'rejected' ? 'failed' : run.status,
        startedAt: run.startedAt ?? run.createdAt,
        updatedAt: run.completedAt ?? run.startedAt ?? run.createdAt,
        ...(run.completedAt !== undefined ? { finishedAt: run.completedAt } : {}),
        activity: [run.channelId ? `Channel ${run.channelId}` : '', run.threadId ? `Thread ${run.threadId}` : '',
          run.exitCode !== undefined ? `Exit ${run.exitCode}` : ''].filter(Boolean).join(' · '),
        cancellable: false,
      }));
      this.store.replaceExternal(runs, snapshot.message);
    } catch {
      if (!this.stopped && workspaceRoot === (this.options.getWorkspaceRoot?.() ?? this.options.workspaceRoot)) {
        this.store.replaceExternal([], `Squad run records are unavailable. ${RECORDED_STATUS}`);
      }
    } finally {
      this.refreshing = false;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.options.signal?.removeEventListener('abort', this.onAbort);
  }
}
