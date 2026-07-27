/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
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

const SIMILARITY_THRESHOLD = 0.6;
const MEMORY_INDEX_LOCK_OPTIONS = {
  staleMs: 30_000,
  waitTimeoutMs: 5_000,
  retryDelayMs: 10,
} as const;

export class MemoryManager {
  private readonly userMemoryDir: string;
  private projectMemoryDir: string | null = null;
  private readonly eventLogs = new Map<MemoryLevel, MemoryEventLog>();
  private readonly summaryTrees = new Map<MemoryLevel, MemorySummaryTree>();

  constructor(workspaceRoot?: string) {
    this.userMemoryDir = AUTOHAND_PATHS.memory;
    if (workspaceRoot) {
      this.projectMemoryDir = path.join(workspaceRoot, PROJECT_DIR_NAME, 'memory');
    }
  }

  setWorkspace(workspaceRoot: string): void {
    this.projectMemoryDir = path.join(workspaceRoot, PROJECT_DIR_NAME, 'memory');
    this.eventLogs.delete('project');
    this.summaryTrees.delete('project');
  }

  async initialize(): Promise<void> {
    await fs.ensureDir(this.userMemoryDir);
    await this.initializeLevel('user');
    if (this.projectMemoryDir) {
      await fs.ensureDir(this.projectMemoryDir);
      await this.initializeLevel('project');
    }
  }

  private getMemoryDir(level: MemoryLevel): string {
    if (level === 'project') {
      if (!this.projectMemoryDir) {
        throw new Error('Project memory directory not set. Use setWorkspace() first.');
      }
      return this.projectMemoryDir;
    }
    return this.userMemoryDir;
  }

  async store(content: string, level: MemoryLevel, tags?: string[], source?: string): Promise<MemoryEntry> {
    return this.withMemoryMutationLock(level, () => this.storeUnlocked(content, level, tags, source));
  }

  private async storeUnlocked(
    content: string,
    level: MemoryLevel,
    tags?: string[],
    source?: string,
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
      source
    };

    const entryPath = path.join(dir, `${id}.json`);
    await eventLog.append({ operation: 'create', level, entry });
    await atomicWriteJson(entryPath, entry);
    await this.updateIndex(level, entry);
    scheduleBackgroundSync();

    return entry;
  }

  async updateMemory(id: string, content: string, level: MemoryLevel, tags?: string[]): Promise<MemoryEntry> {
    return this.withMemoryMutationLock(level, () => this.updateMemoryUnlocked(id, content, level, tags));
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
    scheduleBackgroundSync();

    return updated;
  }

  async get(id: string, level: MemoryLevel): Promise<MemoryEntry | null> {
    const dir = this.getMemoryDir(level);
    const entryPath = path.join(dir, `${id}.json`);

    if (!(await fs.pathExists(entryPath))) {
      return null;
    }

    return fs.readJson(entryPath) as Promise<MemoryEntry>;
  }

  async list(level: MemoryLevel): Promise<MemoryEntry[]> {
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

  async delete(id: string, level: MemoryLevel): Promise<void> {
    await this.withMemoryMutationLock(level, () => this.deleteUnlocked(id, level));
  }

  private async deleteUnlocked(id: string, level: MemoryLevel): Promise<void> {
    const dir = this.getMemoryDir(level);
    const entryPath = path.join(dir, `${id}.json`);

    if (await fs.pathExists(entryPath)) {
      const eventLog = await this.initializeEventLog(level);
      await eventLog.append({ operation: 'delete', level, memoryId: id });
      await atomicRemoveFile(entryPath);
      await this.removeFromIndex(level, id);
      scheduleBackgroundSync();
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
    const { project, user } = await this.listAll();
    const parts: string[] = [];

    if (project.length > 0) {
      await this.appendContextLevel(parts, 'project', project, limit);
    }

    if (user.length > 0) {
      await this.appendContextLevel(parts, 'user', user, limit);
    }

    return parts.join('\n');
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
    return this.getSummaryTree(level).zoom(level, snapshotId, nodeId, options);
  }

  async forgetMemorySummaries(level: MemoryLevel, snapshotId?: string): Promise<number> {
    return this.getSummaryTree(level).forget(level, snapshotId);
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
    const replayedById = new Map(replayed.map((entry) => [entry.id, entry]));
    const files = await fs.readdir(dir);
    let restored = 0;
    let removed = 0;

    for (const entry of replayed) {
      const entryPath = path.join(dir, `${entry.id}.json`);
      if (!(await fs.pathExists(entryPath))) {
        restored += 1;
      }
      await atomicWriteJson(entryPath, entry);
    }

    for (const file of files) {
      if (!file.endsWith('.json') || file === 'index.json') {
        continue;
      }
      const id = file.slice(0, -'.json'.length);
      if (!replayedById.has(id)) {
        await atomicRemoveFile(path.join(dir, file));
        removed += 1;
      }
    }

    const index: MemoryIndex = {
      version: 1,
      entries: replayed.map((entry) => this.toIndexEntry(entry)),
    };
    await atomicWriteJson(path.join(dir, 'index.json'), index);
    if (syncAfterRebuild) {
      scheduleBackgroundSync();
    }
    return { restored, removed };
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
    let eventLog = this.eventLogs.get(level);
    if (!eventLog) {
      eventLog = new MemoryEventLog(this.getMemoryDir(level));
      this.eventLogs.set(level, eventLog);
    }
    await eventLog.initialize(level, await this.list(level));
    return eventLog;
  }

  private getSummaryTree(level: MemoryLevel): MemorySummaryTree {
    let tree = this.summaryTrees.get(level);
    if (!tree) {
      tree = new MemorySummaryTree(this.getMemoryDir(level));
      this.summaryTrees.set(level, tree);
    }
    return tree;
  }

  private async initializeLevel(level: MemoryLevel): Promise<void> {
    await this.withMemoryMutationLock(level, async () => {
      const eventLog = await this.initializeEventLog(level);
      await this.rebuildProjectionUnlocked(level, eventLog, false);
    });
  }

  private async withMemoryMutationLock<T>(
    level: MemoryLevel,
    operation: () => Promise<T>,
  ): Promise<T> {
    const lockPath = path.join(this.getMemoryDir(level), 'events', '.view.lock');
    return withFileLock(lockPath, operation, MEMORY_INDEX_LOCK_OPTIONS);
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
    if (entries.length <= limit) {
      parts.push(level === 'project' ? '## Project Memories' : '## User Preferences');
      for (const entry of entries.slice(0, limit)) {
        parts.push(`- ${entry.content}`);
      }
      return;
    }

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
  }

  private toIndexEntry(entry: MemoryEntry): MemoryIndex['entries'][number] {
    return {
      id: entry.id,
      preview: entry.content.slice(0, 100),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      tags: entry.tags,
    };
  }
}
