/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import { AUTOHAND_PATHS } from '../constants.js';
import type { AgentRuntime, ProviderName, TokenUsageStatus } from '../types.js';
import type { Session } from './SessionManager.js';

export const ACTIVE_AGENT_HEARTBEAT_INTERVAL_MS = 5_000;
export const ACTIVE_AGENT_STALE_MS = 15_000;

export type ActiveAgentMode = 'interactive' | 'command' | 'rpc' | 'acp' | 'teammate';
export type ActiveAgentStatus = 'idle' | 'working';

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
    await fs.ensureDir(this.dir);
    await fs.writeJson(this.recordPath(record.sessionId), record, { spaces: 2 });
  }

  async remove(sessionId: string): Promise<void> {
    await fs.remove(this.recordPath(sessionId));
  }

  async listActive(): Promise<ActiveAgentRecord[]> {
    await fs.ensureDir(this.dir);
    const filenames = await fs.readdir(this.dir);
    const records: ActiveAgentRecord[] = [];

    await Promise.all(filenames
      .filter((filename) => filename.endsWith('.json'))
      .map(async (filename) => {
        const filePath = path.join(this.dir, filename);
        try {
          const record = await fs.readJson(filePath) as ActiveAgentRecord;
          if (!isValidActiveAgentRecord(record) || this.isStale(record)) {
            await fs.remove(filePath);
            return;
          }
          records.push(record);
        } catch {
          await fs.remove(filePath).catch(() => {});
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
}

export class ActiveAgentHeartbeat {
  private timer: ReturnType<typeof setInterval> | null = null;
  private status: ActiveAgentStatus = 'idle';

  constructor(
    private readonly registry: ActiveAgentRegistry,
    private readonly options: ActiveAgentHeartbeatOptions,
  ) {}

  async start(): Promise<void> {
    await this.update('idle');
    this.timer = setInterval(() => {
      this.update().catch(() => {});
    }, ACTIVE_AGENT_HEARTBEAT_INTERVAL_MS);
    this.timer.unref?.();
  }

  async update(status = this.status): Promise<void> {
    const session = this.options.getSession();
    if (!session) return;

    this.status = status;
    const snapshot = this.options.getStatusSnapshot();
    const now = new Date().toISOString();
    await this.registry.write({
      version: 1,
      pid: process.pid,
      sessionId: session.metadata.sessionId,
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
    });
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
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
    && typeof record.tokensUsed === 'number';
}
