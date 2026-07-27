/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fse from 'fs-extra';
import path from 'node:path';
import { AUTOHAND_PATHS } from '../constants.js';
import type { AgentRuntime, ProviderName, TokenUsageStatus } from '../types.js';
import type { Session } from './SessionManager.js';

export const ACTIVE_AGENT_HEARTBEAT_INTERVAL_MS = 5_000;
export const ACTIVE_AGENT_STALE_MS = 15_000;

export type ActiveAgentMode = 'interactive' | 'command' | 'rpc' | 'acp' | 'teammate';
export type ActiveAgentStatus = 'idle' | 'working';
export type ActiveAgentPhase =
  | 'idle'
  | 'thinking'
  | 'editing'
  | 'running_command'
  | 'waiting_input';

export interface ActiveAgentActivity {
  phase: ActiveAgentPhase;
  instruction?: string;
  command?: string;
  pathsWritten: string[];
  claims?: string[];
  headRef?: { branch: string | null; sha: string };
}

export interface ActiveAgentRecord {
  version: 1;
  pid: number;
  sessionId: string;
  workspaceRoot: string;
  projectName: string;
  provider: ProviderName | string;
  model: string;
  mode: ActiveAgentMode;
  status: ActiveAgentStatus;
  startedAt: string;
  updatedAt: string;
  messageCount: number;
  contextPercent: number;
  tokensUsed: number;
  tokensUsageStatus?: TokenUsageStatus;
  sessionTokensUsed?: number;
  activity?: ActiveAgentActivity;
}

export interface ActiveAgentStatusSnapshot {
  model: string;
  workspace: string;
  contextPercent: number;
  tokensUsed: number;
  tokensUsageStatus?: TokenUsageStatus;
  sessionTokensUsed?: number;
}

export interface ActiveAgentRegistryDeps {
  now?: () => Date;
  isPidAlive?: (pid: number) => boolean;
}

export class ActiveAgentRegistry {
  private readonly now: () => Date;
  private readonly isPidAlive: (pid: number) => boolean;

  constructor(
    private readonly dir = AUTOHAND_PATHS.activeAgents,
    deps: ActiveAgentRegistryDeps = {},
  ) {
    this.now = deps.now ?? (() => new Date());
    this.isPidAlive = deps.isPidAlive ?? isProcessAlive;
  }

  async write(record: ActiveAgentRecord): Promise<void> {
    await fse.ensureDir(this.dir, { mode: 0o700 });
    await fse.chmod(this.dir, 0o700).catch(() => {});
    const filePath = this.recordPath(record.sessionId);
    await fse.writeJson(filePath, record, { spaces: 2, mode: 0o600 });
    await fse.chmod(filePath, 0o600).catch(() => {});
  }

  async remove(sessionId: string): Promise<void> {
    await fse.remove(this.recordPath(sessionId));
  }

  async listActive(): Promise<ActiveAgentRecord[]> {
    await fse.ensureDir(this.dir, { mode: 0o700 });
    await fse.chmod(this.dir, 0o700).catch(() => {});
    const filenames = await fse.readdir(this.dir);
    const records: ActiveAgentRecord[] = [];

    await Promise.all(filenames
      .filter((filename) => filename.endsWith('.json'))
      .map(async (filename) => {
        const filePath = path.join(this.dir, filename);
        try {
          const record = await fse.readJson(filePath) as ActiveAgentRecord;
          if (!isValidActiveAgentRecord(record) || this.isStale(record)) {
            await fse.remove(filePath);
            return;
          }
          records.push(record);
        } catch {
          await fse.remove(filePath).catch(() => {});
        }
      }));

    return records.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  private isStale(record: ActiveAgentRecord): boolean {
    if (!this.isPidAlive(record.pid)) {
      return true;
    }
    return this.now().getTime() - Date.parse(record.updatedAt) > ACTIVE_AGENT_STALE_MS;
  }

  private recordPath(sessionId: string): string {
    const safeName = sessionId.replace(/[^a-zA-Z0-9_.-]/g, '_');
    return path.join(this.dir, `${safeName}.json`);
  }
}

export interface ActiveAgentHeartbeatOptions {
  runtime: AgentRuntime;
  getProvider: () => ProviderName | string;
  getSession: () => Session | null;
  getStatusSnapshot: () => ActiveAgentStatusSnapshot;
  getActivity?: () => ActiveAgentActivity | undefined;
  onHeartbeat?: () => Promise<void> | void;
}

export class ActiveAgentHeartbeat {
  private timer: ReturnType<typeof setInterval> | null = null;
  private status: ActiveAgentStatus = 'idle';
  private stopped = false;
  private stopPromise: Promise<void> | null = null;
  private readonly pendingUpdates = new Set<Promise<void>>();

  constructor(
    private readonly registry: ActiveAgentRegistry,
    private readonly options: ActiveAgentHeartbeatOptions,
  ) {}

  async start(): Promise<void> {
    if (this.stopped || this.timer) return;
    await this.update('idle');
    if (this.stopped || this.timer) return;
    this.timer = setInterval(() => {
      this.update().catch(() => {});
    }, ACTIVE_AGENT_HEARTBEAT_INTERVAL_MS);
    this.timer.unref?.();
  }

  update(status = this.status): Promise<void> {
    if (this.stopped) return Promise.resolve();

    const session = this.options.getSession();
    if (!session) return Promise.resolve();

    this.status = status;
    const snapshot = this.options.getStatusSnapshot();
    const now = new Date().toISOString();
    const sessionId = session.metadata.sessionId;
    const activity = this.options.getActivity?.();
    const updatePromise = this.writeUpdate({
        version: 1,
        pid: process.pid,
        sessionId,
        workspaceRoot: this.options.runtime.workspaceRoot,
        projectName: path.basename(this.options.runtime.workspaceRoot),
        provider: this.options.getProvider(),
        model: snapshot.model,
        mode: resolveActiveAgentMode(this.options.runtime),
        status,
        startedAt: session.metadata.createdAt,
        updatedAt: now,
        messageCount: session.metadata.messageCount,
        contextPercent: snapshot.contextPercent,
        tokensUsed: snapshot.tokensUsed,
        tokensUsageStatus: snapshot.tokensUsageStatus,
        sessionTokensUsed: snapshot.sessionTokensUsed,
        ...(activity ? { activity } : {}),
      }, sessionId);
    this.pendingUpdates.add(updatePromise);
    void updatePromise.then(
      () => this.pendingUpdates.delete(updatePromise),
      () => this.pendingUpdates.delete(updatePromise),
    );
    return updatePromise;
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;

    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stopPromise = this.finishStop();
    return this.stopPromise;
  }

  private async writeUpdate(record: ActiveAgentRecord, sessionId: string): Promise<void> {
    await this.registry.write(record);
    if (this.stopped) {
      await this.registry.remove(sessionId).catch(() => {});
      return;
    }
    try {
      await this.options.onHeartbeat?.();
    } catch {
      // Peer awareness is advisory; a failed registry poll must not stop the heartbeat.
    }
  }

  private async finishStop(): Promise<void> {
    await Promise.allSettled([...this.pendingUpdates]);
    const session = this.options.getSession();
    if (session) {
      await this.registry.remove(session.metadata.sessionId);
    }
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid < 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

function resolveActiveAgentMode(runtime: AgentRuntime): ActiveAgentMode {
  if (runtime.isRpcMode) return 'rpc';
  if (runtime.isCommandMode || runtime.options.prompt) return 'command';
  return 'interactive';
}

function isValidActiveAgentRecord(value: unknown): value is ActiveAgentRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ActiveAgentRecord>;
  return record.version === 1
    && typeof record.pid === 'number'
    && typeof record.sessionId === 'string'
    && typeof record.workspaceRoot === 'string'
    && typeof record.projectName === 'string'
    && typeof record.model === 'string'
    && typeof record.startedAt === 'string'
    && typeof record.updatedAt === 'string'
    && typeof record.messageCount === 'number'
    && typeof record.contextPercent === 'number'
    && typeof record.tokensUsed === 'number'
    && (record.activity === undefined || isValidActiveAgentActivity(record.activity));
}

function isValidActiveAgentActivity(value: unknown): value is ActiveAgentActivity {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const activity = value as Partial<ActiveAgentActivity>;
  const phases: ActiveAgentPhase[] = [
    'idle',
    'thinking',
    'editing',
    'running_command',
    'waiting_input',
  ];
  return typeof activity.phase === 'string'
    && phases.includes(activity.phase as ActiveAgentPhase)
    && Array.isArray(activity.pathsWritten)
    && activity.pathsWritten.every((candidate) => typeof candidate === 'string')
    && (activity.claims === undefined
      || (Array.isArray(activity.claims)
        && activity.claims.every((candidate) => typeof candidate === 'string')))
    && (activity.instruction === undefined || typeof activity.instruction === 'string')
    && (activity.command === undefined || typeof activity.command === 'string')
    && (activity.headRef === undefined || (
      typeof activity.headRef === 'object'
      && activity.headRef !== null
      && (activity.headRef.branch === null || typeof activity.headRef.branch === 'string')
      && typeof activity.headRef.sha === 'string'
    ));
}
