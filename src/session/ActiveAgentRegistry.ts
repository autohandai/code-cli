/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fse from 'fs-extra';
import path from 'node:path';
import { atomicWriteJson, withFileLock } from '../utils/atomicFile.js';
import { validatePeerAdvertisement, type PeerAdvertisement } from './peers/PeerProtocol.js';
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
  communication?: PeerAdvertisement;
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
    await this.prepareDirectory();
    const communication = validatePeerAdvertisement(record.communication);
    const published: ActiveAgentRecord = { ...record };
    if (communication) published.communication = communication;
    else delete published.communication;
    const filePath = this.recordPath(record.sessionId, communication?.instanceId);
    await withFileLock(`${filePath}.lock`, async () => {
      if (await fse.pathExists(filePath) && !await this.isOwnedFile(filePath)) throw new Error('Active-agent record is not a private regular file.');
      await atomicWriteJson(filePath, published);
      await fse.chmod(filePath, 0o600).catch(error => { if (process.platform !== 'win32') throw error; });
    }, { waitTimeoutMs: 2_000, retryDelayMs: 5 });
  }

  async remove(sessionId: string, instanceId?: string): Promise<void> {
    const filePath = this.recordPath(sessionId, instanceId);
    if (!await this.isOwnedFile(filePath)) return;
    await withFileLock(`${filePath}.lock`, async () => {
      if (await this.isOwnedFile(filePath)) await fse.unlink(filePath);
    }, { waitTimeoutMs: 2_000, retryDelayMs: 5 });
  }

  async listActive(): Promise<ActiveAgentRecord[]> {
    await this.prepareDirectory();
    const filenames = await fse.readdir(this.dir);
    const records: ActiveAgentRecord[] = [];

    await Promise.all(filenames
      .filter((filename) => filename.endsWith('.json'))
      .map(async (filename) => {
        const filePath = path.join(this.dir, filename);
        if (!await this.isOwnedFile(filePath)) return;
        try {
          const record: unknown = await fse.readJson(filePath);
          if (!isValidActiveAgentRecord(record) || this.isStale(record)) {
            await this.pruneStaleFile(filePath);
            return;
          }
          const { communication: extension, ...presence } = record;
          const communication = validatePeerAdvertisement(extension);
          records.push({ ...presence, ...(communication ? { communication } : {}) });
        } catch {
          await this.pruneStaleFile(filePath).catch(() => {});
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

  private async prepareDirectory(): Promise<void> {
    await fse.ensureDir(this.dir, { mode: 0o700 });
    const info = await fse.lstat(this.dir);
    if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== 'win32' && info.uid !== process.geteuid?.()) throw new Error('Active-agent registry must be a directory owned by the current OS user.');
    await fse.chmod(this.dir, 0o700).catch(error => { if (process.platform !== 'win32') throw error; });
  }

  private async isOwnedFile(filename: string): Promise<boolean> {
    try {
      const info = await fse.lstat(filename);
      return info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size <= 131_072
        && (process.platform === 'win32' || info.uid === process.geteuid?.() && (info.mode & 0o077) === 0);
    } catch { return false; }
  }

  private async pruneStaleFile(filename: string): Promise<void> {
    await withFileLock(`${filename}.lock`, async () => {
      if (!await this.isOwnedFile(filename)) return;
      try {
        const current: unknown = await fse.readJson(filename);
        if (isValidActiveAgentRecord(current)) {
          if (this.isStale(current)) await fse.unlink(filename);
          return;
        }
      } catch {
        // Older clients publish non-atomically; a fresh incomplete write is not stale.
      }
      const info = await fse.lstat(filename);
      if (this.now().getTime() - info.mtimeMs > ACTIVE_AGENT_STALE_MS) await fse.unlink(filename);
    }, { waitTimeoutMs: 100, retryDelayMs: 5 });
  }

  private recordPath(sessionId: string, instanceId?: string): string {
    const safeName = sessionId.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const suffix = instanceId ? `.${instanceId.replace(/[^a-zA-Z0-9-]/g, '_')}` : '';
    return path.join(this.dir, `${safeName}${suffix}.json`);
  }
}

export interface ActiveAgentHeartbeatOptions {
  runtime: AgentRuntime;
  getProvider: () => ProviderName | string;
  getSession: () => Session | null;
  getStatusSnapshot: () => ActiveAgentStatusSnapshot;
  getActivity?: () => ActiveAgentActivity | undefined;
  getCommunication?: () => PeerAdvertisement | undefined;
  onHeartbeat?: (record: ActiveAgentRecord) => Promise<void> | void;
}

export class ActiveAgentHeartbeat {
  private timer: ReturnType<typeof setInterval> | null = null;
  private status: ActiveAgentStatus = 'idle';
  private stopped = false;
  private stopPromise: Promise<void> | null = null;
  private readonly pendingUpdates = new Set<Promise<void>>();
  private updateChain: Promise<void> = Promise.resolve();
  private readonly registeredRecords = new Map<string, { sessionId: string; instanceId?: string }>();

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
    const communication = this.options.getCommunication?.();
    const record: ActiveAgentRecord = {
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
      ...(communication ? { communication } : {}),
    };
    const updatePromise = this.updateChain.then(() => this.writeUpdate(record));
    this.updateChain = updatePromise.catch(() => {});
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

  private async writeUpdate(record: ActiveAgentRecord): Promise<void> {
    await this.registry.write(record);
    const identity = { sessionId: record.sessionId, instanceId: record.communication?.instanceId };
    const key = JSON.stringify(identity);
    this.registeredRecords.set(key, identity);
    if (this.stopped) {
      await this.removeRegisteredSessions();
      return;
    }

    const priorRecords = [...this.registeredRecords].filter(([registered]) => registered !== key);
    await Promise.all(priorRecords.map(async ([registered, previous]) => {
      await this.registry.remove(previous.sessionId, previous.instanceId);
      this.registeredRecords.delete(registered);
    }));
    try {
      await this.options.onHeartbeat?.(record);
    } catch {
      // Peer awareness is advisory; a failed registry poll must not stop the heartbeat.
    }
  }

  private async finishStop(): Promise<void> {
    await Promise.allSettled([...this.pendingUpdates]);
    await this.removeRegisteredSessions();
  }

  private async removeRegisteredSessions(): Promise<void> {
    const records = [...this.registeredRecords];
    await Promise.all(records.map(async ([key, record]) => {
      await this.registry.remove(record.sessionId, record.instanceId);
      this.registeredRecords.delete(key);
    }));
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
