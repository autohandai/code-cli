/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import crypto from 'node:crypto';
import type { MemoryEntry, MemoryIndex, MemoryLevel, SimilarityMatch } from './types.js';
import { AUTOHAND_PATHS, PROJECT_DIR_NAME } from '../constants.js';
import { scheduleBackgroundSync } from '../sync/runtimeSyncService.js';
import { atomicRemoveFile, atomicWriteJson, withFileLock } from '../utils/atomicFile.js';
import { MemoryEventLog } from './MemoryEventLog.js';

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

  constructor(workspaceRoot?: string) {
    this.userMemoryDir = AUTOHAND_PATHS.memory;
    if (workspaceRoot) {
      this.projectMemoryDir = path.join(workspaceRoot, PROJECT_DIR_NAME, 'memory');
    }
  }

  setWorkspace(workspaceRoot: string): void {
    this.projectMemoryDir = path.join(workspaceRoot, PROJECT_DIR_NAME, 'memory');
    this.eventLogs.delete('project');
  }

  async initialize(): Promise<void> {
    await fs.ensureDir(this.userMemoryDir);
    if (this.projectMemoryDir) {
      await fs.ensureDir(this.projectMemoryDir);
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

  async recall(query?: string, level?: MemoryLevel): Promise<Array<{ content: string; level: MemoryLevel }>> {
    const levels: MemoryLevel[] = level ? [level] : ['user', 'project'];
    const results: Array<{ content: string; level: MemoryLevel }> = [];

    for (const lvl of levels) {
      try {
        const entries = await this.list(lvl);
        for (const entry of entries) {
          if (!query || entry.content.toLowerCase().includes(query.toLowerCase())) {
            results.push({ content: entry.content, level: lvl });
          }
        }
      } catch {
        // Level not available
      }
    }

    return results;
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
      parts.push('## Project Memories');
      for (const entry of project.slice(0, limit)) {
        parts.push(`- ${entry.content}`);
      }
    }

    if (user.length > 0) {
      parts.push('## User Preferences');
      for (const entry of user.slice(0, limit)) {
        parts.push(`- ${entry.content}`);
      }
    }

    return parts.join('\n');
  }

  async rebuildFromEventLog(level: MemoryLevel): Promise<{ restored: number; removed: number }> {
    return this.withMemoryMutationLock(level, () => this.rebuildFromEventLogUnlocked(level));
  }

  private async rebuildFromEventLogUnlocked(
    level: MemoryLevel,
  ): Promise<{ restored: number; removed: number }> {
    const dir = this.getMemoryDir(level);
    const eventLog = await this.initializeEventLog(level);
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
    scheduleBackgroundSync();
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
