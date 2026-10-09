/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  CapabilityUsageInput,
  LearnedProjectCapability,
  MemoryEntry,
  MemoryIndex,
  MemoryLevel,
  MemoryOutline,
  MemoryOutlineOptions,
  RecalledMemory,
  SimilarityMatch,
} from './types.js';
import { AUTOHAND_PATHS, PROJECT_DIR_NAME } from '../constants.js';
import { scheduleBackgroundSync } from '../sync/runtimeSyncService.js';
import { atomicRemoveFile, atomicWriteJson, withFileLock } from '../utils/atomicFile.js';
import { MemoryEventLog } from './MemoryEventLog.js';
import { MemorySummaryTree } from './MemorySummaryTree.js';
import { materializeMemoryProjection } from './MemoryProjection.js';
import { assertSafeMemoryId } from './MemoryPathSafety.js';

const SIMILARITY_THRESHOLD = 0.6;
const MAX_SHARED_MEMORY_CONTEXT_CHARS = 4_000;
const SHARED_PROJECT_MEMORY_START = '<autohand_shared_project_memory>';
const SHARED_PROJECT_MEMORY_END = '</autohand_shared_project_memory>';
const MEMORY_INDEX_LOCK_OPTIONS = {
  staleMs: 30_000,
  waitTimeoutMs: 5_000,
  retryDelayMs: 10,
} as const;

function isStorageCapacityError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error.code === 'ENOSPC' || error.code === 'EDQUOT');
}

export function wrapSharedProjectMemory(content: string): string {
  const escaped = content
    .replaceAll(SHARED_PROJECT_MEMORY_START, '&lt;autohand_shared_project_memory&gt;')
    .replaceAll(SHARED_PROJECT_MEMORY_END, '&lt;/autohand_shared_project_memory&gt;');
  return `${SHARED_PROJECT_MEMORY_START}\n${escaped}\n${SHARED_PROJECT_MEMORY_END}`;
}

export function stripSharedProjectMemory(content: string): string {
  return content.replace(/<autohand_shared_project_memory>[\s\S]*?<\/autohand_shared_project_memory>/g, '');
}

export interface ProjectMemoryAdapter {
  refresh(workspaceRoot: string, localDirectory: string): Promise<void>;
  directory(workspaceRoot: string): string | undefined;
  scope?(workspaceRoot: string): string | undefined;
  assertWritable(workspaceRoot: string): void;
  publish(workspaceRoot: string, localDirectory: string, expectedDirectory?: string): Promise<void>;
}

interface ProjectMemoryOperation {
  workspaceRoot: string;
  localDirectory: string;
  directory: string;
  shared: boolean;
}

export interface MemoryManagerOptions {
  userMemoryDir?: string;
  getSessionId?: () => string | undefined;
  projectMemory?: ProjectMemoryAdapter;
  onProjectMemoryError?: (error: Error) => void;
}

export class MemoryManager {
  private readonly userMemoryDir: string;
  private readonly getSessionId?: () => string | undefined;
  private readonly projectMemory?: ProjectMemoryAdapter;
  private readonly onProjectMemoryError?: (error: Error) => void;
  private workspaceRoot?: string;
  private projectMemoryDir: string | null = null;
  private readonly projectOperation = new AsyncLocalStorage<ProjectMemoryOperation>();
  private selectedProjectDirectory?: string;
  private readonly eventLogs = new Map<MemoryLevel, { directory: string; value: MemoryEventLog }>();
  private readonly summaryTrees = new Map<MemoryLevel, { directory: string; value: MemorySummaryTree }>();

  constructor(workspaceRoot?: string, options: MemoryManagerOptions = {}) {
    this.userMemoryDir = options.userMemoryDir ?? AUTOHAND_PATHS.memory;
    this.getSessionId = options.getSessionId;
    this.projectMemory = options.projectMemory;
    this.onProjectMemoryError = options.onProjectMemoryError;
    this.workspaceRoot = workspaceRoot;
    if (workspaceRoot) {
      this.projectMemoryDir = path.join(workspaceRoot, PROJECT_DIR_NAME, 'memory');
    }
  }

  setWorkspace(workspaceRoot: string): void {
    this.workspaceRoot = workspaceRoot;
    this.projectMemoryDir = path.join(workspaceRoot, PROJECT_DIR_NAME, 'memory');
    this.eventLogs.delete('project');
    this.summaryTrees.delete('project');
  }

  async initialize(): Promise<void> {
    const levels: MemoryLevel[] = this.projectMemoryDir ? ['user', 'project'] : ['user'];
    for (const level of levels) {
      try {
        await this.initializeLevel(level);
      } catch (error) {
        if (!isStorageCapacityError(error)) {
          throw error;
        }
      }
    }
  }

  private getMemoryDir(level: MemoryLevel): string {
    if (level === 'project') {
      if (!this.projectMemoryDir) {
        throw new Error('Project memory directory not set. Use setWorkspace() first.');
      }
      const pinned = this.projectOperation.getStore();
      if (pinned) {
        return pinned.directory;
      }
      const directory = this.workspaceRoot && this.projectMemory?.directory(this.workspaceRoot)
        || this.projectMemoryDir;
      if (directory !== this.selectedProjectDirectory) {
        this.eventLogs.delete('project');
        this.summaryTrees.delete('project');
        this.selectedProjectDirectory = directory;
      }
      return directory;
    }
    return this.userMemoryDir;
  }

  getProjectMemoryScope(): string | undefined {
    if (!this.workspaceRoot || !this.projectMemoryDir) return undefined;
    const directory = this.projectMemory?.directory(this.workspaceRoot) ?? this.projectMemoryDir;
    return JSON.stringify([
      path.resolve(this.workspaceRoot),
      path.resolve(directory),
      this.projectMemory?.scope?.(this.workspaceRoot) ?? null,
    ]);
  }

  hasSharedProjectMemory(): boolean {
    return !!(this.workspaceRoot && this.projectMemory?.directory(this.workspaceRoot));
  }

  async store(content: string, level: MemoryLevel, tags?: string[], source?: string, origin?: MemoryEntry['origin'] | null, expectedProjectScope?: string): Promise<MemoryEntry> {
    const sessionId = origin === undefined ? this.getSessionId?.() : undefined;
    const creationOrigin = origin ?? (sessionId ? { sessionId } : undefined);
    return this.withMemoryMutationLock(level, () => {
      if (level === 'project' && expectedProjectScope !== undefined && expectedProjectScope !== this.getProjectMemoryScope()) {
        throw new Error('The project memory scope changed. Reflection must stay in its original account and workspace.');
      }
      return this.storeUnlocked(content, level, tags, source, creationOrigin);
    }, true);
  }

  private async storeUnlocked(
    content: string,
    level: MemoryLevel,
    tags?: string[],
    source?: string,
    origin?: MemoryEntry['origin'],
  ): Promise<MemoryEntry> {
    const dir = this.getMemoryDir(level);
    await fs.ensureDir(dir);

    // Check for similar existing memories
    const similar = await this.findSimilar(content, level);

    if (similar && similar.score >= SIMILARITY_THRESHOLD) {
      // Update existing memory
      return this.updateMemoryUnlocked(similar.entry.id, content, level, tags);
    }
    const eventLog = await this.initializeEventLog(level);

    // Create new memory
    const id = this.generateId();
    const now = new Date().toISOString();
    const entry: MemoryEntry = {
      id,
      content,
      createdAt: now,
      updatedAt: now,
      tags,
      source,
      ...(origin ? { origin } : {}),
    };

    const entryPath = path.join(dir, `${id}.json`);
    await eventLog.append({ operation: 'create', level, entry });
    await atomicWriteJson(entryPath, entry);
    await this.updateIndex(level, entry);
    this.scheduleMemorySync(level);

    return entry;
  }

  async updateMemory(id: string, content: string, level: MemoryLevel, tags?: string[]): Promise<MemoryEntry> {
    assertSafeMemoryId(id);
    return this.withMemoryMutationLock(level, () => this.updateMemoryUnlocked(id, content, level, tags), true);
  }

  private async updateMemoryUnlocked(
    id: string,
    content: string,
    level: MemoryLevel,
    tags?: string[],
  ): Promise<MemoryEntry> {
    const dir = this.getMemoryDir(level);
    const entryPath = path.join(dir, `${id}.json`);

    if (!(await fs.pathExists(entryPath))) {
      throw new Error(`Memory entry not found: ${id}`);
    }

    const existing = await fs.readJson(entryPath) as MemoryEntry;
    const eventLog = await this.initializeEventLog(level);
    const updated: MemoryEntry = {
      ...existing,
      content,
      updatedAt: new Date().toISOString(),
      tags: tags ?? existing.tags
    };

    await eventLog.append({ operation: 'update', level, entry: updated });
    await atomicWriteJson(entryPath, updated);
    await this.updateIndex(level, updated);
    this.scheduleMemorySync(level);

    return updated;
  }

  async get(id: string, level: MemoryLevel): Promise<MemoryEntry | null> {
    assertSafeMemoryId(id);
    return this.withMemoryRead(level, () => this.getUnlocked(id, level));
  }

  private async getUnlocked(id: string, level: MemoryLevel): Promise<MemoryEntry | null> {
    const dir = this.getMemoryDir(level);
    const entryPath = path.join(dir, `${id}.json`);

    if (!(await fs.pathExists(entryPath))) {
      return null;
    }

    return fs.readJson(entryPath) as Promise<MemoryEntry>;
  }

  async list(level: MemoryLevel): Promise<MemoryEntry[]> {
    return this.withMemoryRead(level, () => this.listUnlocked(level));
  }

  private async listUnlocked(level: MemoryLevel): Promise<MemoryEntry[]> {
    const dir = this.getMemoryDir(level);

    if (!(await fs.pathExists(dir))) {
      return [];
    }

    const files = await fs.readdir(dir);
    const entries: MemoryEntry[] = [];

    for (const file of files) {
      if (file.endsWith('.json') && file !== 'index.json') {
        const entryPath = path.join(dir, file);
        const entry = await fs.readJson(entryPath) as MemoryEntry;
        entries.push(entry);
      }
    }

    return entries.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  async listAll(): Promise<{ project: MemoryEntry[]; user: MemoryEntry[] }> {
    const user = await this.list('user');
    let project: MemoryEntry[] = [];

    if (this.projectMemoryDir) {
      try {
        project = await this.list('project');
      } catch {
        // Project memory not available
      }
    }

    return { project, user };
  }

  async recordCapabilityUse(usage: CapabilityUsageInput): Promise<void> {
    if (!this.projectMemoryDir) {
      return;
    }
    await this.withMemoryMutationLock('project', async () => {
      const eventLog = await this.initializeEventLog('project');
      await eventLog.append({
        operation: 'capability_used',
        level: 'project',
        capability: {
          kind: usage.kind,
          name: usage.name,
          source: usage.source,
        },
        origin: usage.origin,
        outcome: usage.outcome,
      });
      this.scheduleMemorySync('project');
    }, true);
  }

  async getLearnedProjectCapabilities(limit = 5): Promise<LearnedProjectCapability[]> {
    if (!this.projectMemoryDir || !Number.isInteger(limit) || limit <= 0) {
      return [];
    }
    return this.withMemoryRead('project', () => this.getLearnedProjectCapabilitiesUnlocked(limit));
  }

  private async getLearnedProjectCapabilitiesUnlocked(limit: number): Promise<LearnedProjectCapability[]> {
    const eventLog = await this.initializeEventLog('project');
    const events = await eventLog.readAll();
    const learned = new Map<string, LearnedProjectCapability>();
    const now = Date.now();

    for (const event of events) {
      if (event.operation !== 'capability_used') {
        continue;
      }
      const key = JSON.stringify([
        event.capability.kind,
        event.capability.name,
        event.capability.source,
      ]);
      const existing = learned.get(key) ?? {
        ...event.capability,
        uses: 0,
        successfulUses: 0,
        failedUses: 0,
        userUses: 0,
        agentUses: 0,
        lastUsedAt: event.occurredAt,
        score: 0,
      };
      existing.uses += 1;
      existing.successfulUses += event.outcome === 'succeeded' ? 1 : 0;
      existing.failedUses += event.outcome === 'failed' ? 1 : 0;
      existing.userUses += event.origin === 'user' ? 1 : 0;
      existing.agentUses += event.origin === 'agent' ? 1 : 0;
      if (event.occurredAt > existing.lastUsedAt) {
        existing.lastUsedAt = event.occurredAt;
      }
      learned.set(key, existing);
    }

    for (const capability of learned.values()) {
      const recency = this.calculateRecencyScore(capability.lastUsedAt, now);
      capability.score = Math.max(0, (capability.successfulUses * 4)
        + (Math.min(capability.userUses, capability.successfulUses) * 2)
        + capability.agentUses
        - (capability.failedUses * 2)
        + recency);
    }

    return [...learned.values()]
      .sort((left, right) =>
        right.score - left.score
        || right.lastUsedAt.localeCompare(left.lastUsedAt)
        || left.kind.localeCompare(right.kind)
        || left.name.localeCompare(right.name)
        || left.source.localeCompare(right.source)
      )
      .slice(0, limit);
  }

  async delete(id: string, level: MemoryLevel): Promise<void> {
    assertSafeMemoryId(id);
    await this.withMemoryMutationLock(level, () => this.deleteUnlocked(id, level), true);
  }

  private async deleteUnlocked(id: string, level: MemoryLevel): Promise<void> {
    const dir = this.getMemoryDir(level);
    const entryPath = path.join(dir, `${id}.json`);

    if (await fs.pathExists(entryPath)) {
      const eventLog = await this.initializeEventLog(level);
      await eventLog.append({ operation: 'delete', level, memoryId: id });
      await atomicRemoveFile(entryPath);
      await this.removeFromIndex(level, id);
      this.scheduleMemorySync(level);
    }
  }

  async findSimilar(content: string, level: MemoryLevel): Promise<SimilarityMatch | null> {
    const entries = await this.list(level);
    let bestMatch: SimilarityMatch | null = null;

    for (const entry of entries) {
      const score = this.calculateSimilarity(content, entry.content);
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { entry, score };
      }
    }

    return bestMatch;
  }

  async search(query: string, level?: MemoryLevel): Promise<MemoryEntry[]> {
    const levels: MemoryLevel[] = level ? [level] : ['project', 'user'];
    const results: MemoryEntry[] = [];
    const queryLower = query.toLowerCase();

    for (const lvl of levels) {
      try {
        const entries = await this.list(lvl);
        for (const entry of entries) {
          if (entry.content.toLowerCase().includes(queryLower) ||
              entry.tags?.some(t => t.toLowerCase().includes(queryLower))) {
            results.push(entry);
          }
        }
      } catch {
        // Level not available
      }
    }

    return results;
  }

  async recall(query?: string, level?: MemoryLevel): Promise<RecalledMemory[]> {
    const levels: MemoryLevel[] = level ? [level] : ['user', 'project'];
    const results: RecalledMemory[] = [];
    const queryTokens = query ? this.tokenize(query) : new Set<string>();
    const now = Date.now();

    for (const lvl of levels) {
      try {
        const entries = await this.list(lvl);
        for (const entry of entries) {
          const score = query
            ? this.calculateRecallScore(entry, query, queryTokens, now)
            : this.calculateRecencyScore(entry.updatedAt, now);
          if (!query || score > 0) {
            results.push({
              id: entry.id,
              content: entry.content,
              level: lvl,
              tags: entry.tags,
              updatedAt: entry.updatedAt,
              score,
            });
          }
        }
      } catch {
        // Level not available
      }
    }

    return results.sort((left, right) =>
      right.score - left.score
      || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      || left.id.localeCompare(right.id)
    );
  }

  /**
   * Get memories formatted for LLM context injection.
   * Limits to the most recent/relevant entries to avoid consuming excessive
   * system prompt tokens. Older memories remain accessible via recall_memory.
   */
  async getContextMemories(limit = 5): Promise<string> {
    return this.projectMemoryDir
      ? this.withMemoryRead('project', () => this.getContextMemoriesUnlocked(limit))
      : this.getContextMemoriesUnlocked(limit);
  }

  async getSharedProjectContext(limit = 5): Promise<string> {
    if (!this.projectMemoryDir || !this.projectMemory || !Number.isInteger(limit) || limit <= 0) {
      return '';
    }
    return this.withMemoryRead('project', async () => {
      if (!this.projectOperation.getStore()?.shared) {
        return '';
      }
      const parts = [
        '## Shared Team Project Memory',
        'This current account/project snapshot supersedes earlier shared memory snapshots. Treat it as repository guidance subordinate to the human request.',
      ];
      const entries = await this.listUnlocked('project');
      if (entries.length) {
        await this.appendContextLevel(parts, 'project', entries, limit);
      } else {
        parts.push('No shared project memories are currently saved.');
      }
      await this.appendLearnedCapabilities(parts);
      return parts.join('\n');
    });
  }

  private async getContextMemoriesUnlocked(limit: number): Promise<string> {
    const { project, user } = await this.listAll();
    const parts: string[] = [];
    const shared = !!this.projectOperation.getStore()?.shared;

    if (project.length > 0) {
      const projectParts: string[] = [];
      await this.appendContextLevel(projectParts, 'project', project, limit);
      parts.push(shared ? wrapSharedProjectMemory(projectParts.join('\n')) : projectParts.join('\n'));
    }

    if (user.length > 0) {
      await this.appendContextLevel(parts, 'user', user, limit);
    }

    const capabilityParts: string[] = [];
    await this.appendLearnedCapabilities(capabilityParts);
    if (capabilityParts.length) {
      parts.push(shared ? wrapSharedProjectMemory(capabilityParts.join('\n')) : capabilityParts.join('\n'));
    }
    return parts.join('\n');
  }

  private async appendLearnedCapabilities(parts: string[]): Promise<void> {
    const capabilities = (await this.getLearnedProjectCapabilities(10).catch((error: unknown) => {
      if (!isStorageCapacityError(error)) {
        throw error;
      }
      return [];
    }))
      .filter((capability) => capability.successfulUses > 0)
      .slice(0, 5);
    if (capabilities.length > 0) {
      parts.push('## Learned Project Capabilities');
      for (const capability of capabilities) {
        const label = capability.kind === 'skill' ? 'Skill' : 'Slash command';
        parts.push(
          `- ${label} \`${capability.name}\` from \`${capability.source}\``
          + ` — ${capability.uses} ${capability.uses === 1 ? 'use' : 'uses'}`
          + ` (${capability.successfulUses} successful;`
          + ` user ${capability.userUses}, agent ${capability.agentUses})`,
        );
      }
      parts.push(
        'Use learned skills when they match the task. Slash commands are user workflows: suggest relevant commands, but never execute them automatically.',
      );
    }
  }

  async getMemoryOutline(
    level: MemoryLevel,
    options: MemoryOutlineOptions = {},
  ): Promise<MemoryOutline> {
    return this.withMemoryMutationLock(level, async () => {
      const eventLog = await this.initializeEventLog(level);
      const snapshot = await eventLog.snapshot(options.snapshotEventCount);
      const entries = [...snapshot.entries].sort((left, right) =>
        new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime()
        || left.id.localeCompare(right.id)
      );
      const outline = await this.getSummaryTree(level).wake(
        level,
        entries,
        snapshot.snapshotId,
        options,
      );
      return { ...outline, eventCount: snapshot.eventCount };
    });
  }

  async zoomMemory(
    level: MemoryLevel,
    snapshotId: string,
    nodeId: string,
    options: MemoryOutlineOptions = {},
  ): Promise<MemoryOutline> {
    return this.withMemoryRead(level, () => this.getSummaryTree(level).zoom(level, snapshotId, nodeId, options));
  }

  async forgetMemorySummaries(level: MemoryLevel, snapshotId?: string): Promise<number> {
    return this.withMemoryRead(level, () => this.getSummaryTree(level).forget(level, snapshotId));
  }

  async rebuildFromEventLog(level: MemoryLevel): Promise<{ restored: number; removed: number }> {
    return this.withMemoryMutationLock(level, () => this.rebuildFromEventLogUnlocked(level));
  }

  private async rebuildFromEventLogUnlocked(
    level: MemoryLevel,
  ): Promise<{ restored: number; removed: number }> {
    const eventLog = await this.initializeEventLog(level);
    return this.rebuildProjectionUnlocked(level, eventLog, true);
  }

  private async rebuildProjectionUnlocked(
    level: MemoryLevel,
    eventLog: MemoryEventLog,
    syncAfterRebuild: boolean,
  ): Promise<{ restored: number; removed: number }> {
    const dir = this.getMemoryDir(level);
    const replayed = await eventLog.replay();
    const result = await materializeMemoryProjection(dir, replayed);
    if (syncAfterRebuild) {
      this.scheduleMemorySync(level);
    }
    return result;
  }

  private calculateSimilarity(a: string, b: string): number {
    const wordsA = this.tokenize(a);
    const wordsB = this.tokenize(b);

    if (wordsA.size === 0 || wordsB.size === 0) {
      return 0;
    }

    const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);

    return intersection.size / union.size;
  }

  private calculateRecallScore(
    entry: MemoryEntry,
    query: string,
    queryTokens: ReadonlySet<string>,
    now: number,
  ): number {
    const content = entry.content.toLowerCase();
    const normalizedQuery = query.toLowerCase().trim();
    const contentTokens = this.tokenize(entry.content);
    const tagTokens = new Set((entry.tags ?? []).flatMap((tag) => [...this.tokenize(tag)]));
    let lexicalScore = normalizedQuery && content.includes(normalizedQuery) ? 12 : 0;

    for (const token of queryTokens) {
      if (contentTokens.has(token)) {
        lexicalScore += 3;
      }
      if (tagTokens.has(token)) {
        lexicalScore += 4;
      }
    }
    if (lexicalScore === 0) {
      return 0;
    }
    return lexicalScore + this.calculateRecencyScore(entry.updatedAt, now);
  }

  private calculateRecencyScore(updatedAt: string, now: number): number {
    const ageMs = Math.max(0, now - new Date(updatedAt).getTime());
    const ageDays = ageMs / 86_400_000;
    return 1 / (1 + ageDays / 30);
  }

  private tokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2)
    );
  }

  private generateId(): string {
    return crypto.randomUUID().split('-')[0];
  }

  private async updateIndex(level: MemoryLevel, entry: MemoryEntry): Promise<void> {
    const dir = this.getMemoryDir(level);
    const indexPath = path.join(dir, 'index.json');
    await withFileLock(`${indexPath}.lock`, async () => {
      const index = await this.readIndex(indexPath);
      const existingIdx = index.entries.findIndex(e => e.id === entry.id);
      const indexEntry = this.toIndexEntry(entry);

      if (existingIdx >= 0) {
        index.entries[existingIdx] = indexEntry;
      } else {
        index.entries.push(indexEntry);
      }

      await atomicWriteJson(indexPath, index);
    }, MEMORY_INDEX_LOCK_OPTIONS);
  }

  private async removeFromIndex(level: MemoryLevel, id: string): Promise<void> {
    const dir = this.getMemoryDir(level);
    const indexPath = path.join(dir, 'index.json');

    await withFileLock(`${indexPath}.lock`, async () => {
      if (!(await fs.pathExists(indexPath))) {
        return;
      }

      const index = await this.readIndex(indexPath);
      index.entries = index.entries.filter(e => e.id !== id);
      await atomicWriteJson(indexPath, index);
    }, MEMORY_INDEX_LOCK_OPTIONS);
  }

  private async initializeEventLog(level: MemoryLevel): Promise<MemoryEventLog> {
    const directory = this.getMemoryDir(level);
    const cached = this.eventLogs.get(level);
    let eventLog = cached?.directory === directory ? cached.value : undefined;
    if (!eventLog) {
      eventLog = new MemoryEventLog(directory);
      this.eventLogs.set(level, { directory, value: eventLog });
    }
    await eventLog.initialize(level, await this.list(level));
    return eventLog;
  }

  private getSummaryTree(level: MemoryLevel): MemorySummaryTree {
    const directory = this.getMemoryDir(level);
    const cached = this.summaryTrees.get(level);
    let tree = cached?.directory === directory ? cached.value : undefined;
    if (!tree) {
      tree = new MemorySummaryTree(directory);
      this.summaryTrees.set(level, { directory, value: tree });
    }
    return tree;
  }

  private async initializeLevel(level: MemoryLevel): Promise<void> {
    await this.withMemoryMutationLock(level, async () => {
      await fs.ensureDir(this.getMemoryDir(level));
      const eventLog = await this.initializeEventLog(level);
      await this.rebuildProjectionUnlocked(level, eventLog, false);
    });
  }

  private async withMemoryMutationLock<T>(
    level: MemoryLevel,
    operation: () => Promise<T>,
    publish = false,
  ): Promise<T> {
    return this.withMemoryRead(level, async () => {
      const pinned = level === 'project' ? this.projectOperation.getStore() : undefined;
      const assertWritable = () => {
        if (!publish || !pinned || !this.projectMemory) return;
        const directory = this.projectMemory.directory(pinned.workspaceRoot) ?? pinned.localDirectory;
        if (directory !== pinned.directory || this.workspaceRoot !== pinned.workspaceRoot) {
          throw new Error('The project memory account or workspace changed. Retry the memory operation.');
        }
        this.projectMemory.assertWritable(pinned.workspaceRoot);
      };
      assertWritable();
      const lockPath = path.join(this.getMemoryDir(level), 'events', '.view.lock');
      const result = await withFileLock(lockPath, async () => {
        assertWritable();
        return operation();
      }, MEMORY_INDEX_LOCK_OPTIONS);
      if (publish && pinned?.shared && this.projectMemory) {
        try {
          await this.projectMemory.publish(pinned.workspaceRoot, pinned.localDirectory, pinned.directory);
        } catch (error) {
          this.reportProjectMemoryError(error);
        }
      }
      return result;
    });
  }

  private async withMemoryRead<T>(level: MemoryLevel, operation: () => Promise<T>): Promise<T> {
    if (level !== 'project' || this.projectOperation.getStore()) {
      return operation();
    }
    const workspaceRoot = this.workspaceRoot;
    const localDirectory = this.projectMemoryDir;
    if (!workspaceRoot || !localDirectory) {
      return operation();
    }
    if (this.projectMemory) {
      try {
        await this.projectMemory.refresh(workspaceRoot, localDirectory);
      } catch (error) {
        this.reportProjectMemoryError(error);
      }
    }
    const sharedDirectory = this.projectMemory?.directory(workspaceRoot);
    const directory = sharedDirectory ?? localDirectory;
    if (directory !== this.selectedProjectDirectory) {
      this.eventLogs.delete('project');
      this.summaryTrees.delete('project');
      this.selectedProjectDirectory = directory;
    }
    return this.projectOperation.run({ workspaceRoot, localDirectory, directory, shared: !!sharedDirectory }, operation);
  }

  private reportProjectMemoryError(error: unknown): void {
    this.onProjectMemoryError?.(error instanceof Error ? error : new Error(String(error)));
  }

  private scheduleMemorySync(level: MemoryLevel): void {
    if (level !== 'project' || !this.projectOperation.getStore()?.shared) {
      scheduleBackgroundSync();
    }
  }

  private async readIndex(indexPath: string): Promise<MemoryIndex> {
    return await fs.pathExists(indexPath)
      ? await fs.readJson(indexPath) as MemoryIndex
      : { version: 1, entries: [] };
  }

  private async appendContextLevel(
    parts: string[],
    level: MemoryLevel,
    entries: MemoryEntry[],
    limit: number,
  ): Promise<void> {
    if (entries.length > limit) {
      try {
        const outline = await this.getMemoryOutline(level, {
          maxLines: Math.max(1, limit),
          maxChars: 4_000,
          recentRawCount: Math.min(3, Math.max(1, limit - 1)),
        });
        parts.push(
          level === 'project' ? '## Project Memory Outline' : '## User Memory Outline',
          `[snapshot=${outline.snapshotId} events=${outline.eventCount ?? 0} memories=${outline.totalEntries}]`,
          outline.text,
        );
        return;
      } catch (error) {
        if (!isStorageCapacityError(error)) {
          throw error;
        }
      }
    }

    const rawParts = [
      level === 'project' ? '## Project Memories' : '## User Preferences',
      ...entries.slice(0, limit).map((entry) => `- ${entry.content}`),
    ];
    if (level === 'project' && this.projectOperation.getStore()?.shared) {
      const text = rawParts.join('\n');
      const hint = '\n[Shared project memory truncated. Use recall_memory with level="project" to retrieve more.]';
      parts.push(text.length > MAX_SHARED_MEMORY_CONTEXT_CHARS
        ? `${text.slice(0, MAX_SHARED_MEMORY_CONTEXT_CHARS - hint.length)}${hint}`
        : text);
    } else {
      parts.push(...rawParts);
    }
  }

  private toIndexEntry(entry: MemoryEntry): MemoryIndex['entries'][number] {
    return {
      id: entry.id,
      preview: entry.content.slice(0, 100),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      ...(entry.tags === undefined ? {} : { tags: entry.tags }),
    };
  }
}
