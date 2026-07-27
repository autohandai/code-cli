/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import { atomicRemoveFile, atomicWriteJson, withFileLock } from '../utils/atomicFile.js';
import type {
  MemoryEntry,
  MemoryLevel,
  MemoryOutline,
  MemoryOutlineNode,
  MemoryOutlineOptions,
} from './types.js';

const CACHE_VERSION = 1;
const DEFAULT_MAX_LINES = 12;
const DEFAULT_MAX_CHARS = 4_000;
const DEFAULT_RECENT_RAW_COUNT = 4;
const SUMMARY_LIMIT = 320;
const MAX_DERIVED_SNAPSHOTS_PER_LEVEL = 8;
const CACHE_LOCK_OPTIONS = {
  staleMs: 30_000,
  waitTimeoutMs: 5_000,
  retryDelayMs: 10,
} as const;

interface MemorySummaryCache {
  version: 1;
  level: MemoryLevel;
  snapshotId: string;
  entries: MemoryEntry[];
  rootId: string | null;
  nodes: Record<string, MemoryOutlineNode>;
}

export class MemorySummaryCorruptionError extends Error {
  constructor(snapshotId: string, detail: string) {
    super(
      `Memory summary snapshot ${snapshotId} is corrupt: ${detail}. `
      + 'Forget the derived snapshot and rebuild it from the event log.',
    );
    this.name = 'MemorySummaryCorruptionError';
  }
}

function clampInteger(value: number | undefined, fallback: number, minimum: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minimum, Math.floor(value));
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  if (limit <= 1) {
    return value.slice(0, limit);
  }
  return `${value.slice(0, limit - 1)}…`;
}

function normalizeContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

function isMemoryEntry(value: unknown): value is MemoryEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Partial<MemoryEntry>;
  return typeof entry.id === 'string'
    && typeof entry.content === 'string'
    && typeof entry.createdAt === 'string'
    && typeof entry.updatedAt === 'string'
    && (entry.tags === undefined
      || (Array.isArray(entry.tags) && entry.tags.every((tag) => typeof tag === 'string')));
}

export class MemorySummaryTree {
  private readonly summariesDirectory: string;
  private readonly lockPath: string;

  constructor(memoryDirectory: string) {
    this.summariesDirectory = path.join(memoryDirectory, 'derived', 'summaries');
    this.lockPath = path.join(memoryDirectory, 'derived', '.summaries.lock');
  }

  async wake(
    level: MemoryLevel,
    entries: MemoryEntry[],
    snapshotId: string,
    options: MemoryOutlineOptions = {},
  ): Promise<MemoryOutline> {
    this.assertSnapshotId(snapshotId);
    return this.withLock(async () => {
      const cache = await this.loadOrBuildLocked(level, entries, snapshotId);
      return this.createWakeOutline(cache, options);
    });
  }

  async zoom(
    level: MemoryLevel,
    snapshotId: string,
    nodeId: string,
    options: MemoryOutlineOptions = {},
  ): Promise<MemoryOutline> {
    this.assertSnapshotId(snapshotId);
    return this.withLock(async () => {
      const cache = await this.readCacheLocked(level, snapshotId);
      const node = cache.nodes[nodeId];
      if (!node) {
        throw new Error(`Memory summary node not found in snapshot ${snapshotId}: ${nodeId}`);
      }
      const maxLines = clampInteger(options.maxLines, DEFAULT_MAX_LINES, 1);
      const maxChars = clampInteger(options.maxChars, DEFAULT_MAX_CHARS, 1);
      let nodes = node.children && maxLines >= 2
        ? node.children.map((childId) => this.requireNode(cache, childId))
        : [node];
      if (this.minimumOutlineLength(nodes) > maxChars) {
        nodes = [node];
      }
      return this.formatOutline(cache, nodes, maxChars);
    });
  }

  async forget(level: MemoryLevel, snapshotId?: string): Promise<number> {
    if (snapshotId) {
      this.assertSnapshotId(snapshotId);
    }
    return this.withLock(async () => {
      if (snapshotId) {
        let cache: MemorySummaryCache | null = null;
        try {
          cache = await this.readCacheLocked(level, snapshotId);
        } catch (error) {
          if (!(error instanceof MemorySummaryCorruptionError)) {
            throw error;
          }
        }
        await atomicRemoveFile(this.cachePath(level, snapshotId));
        return cache ? Object.keys(cache.nodes).length : 0;
      }

      const levelDirectory = this.levelDirectory(level);
      if (!(await fs.pathExists(levelDirectory))) {
        return 0;
      }
      const files = (await fs.readdir(levelDirectory)).filter((file) => file.endsWith('.json'));
      let invalidated = 0;
      for (const file of files) {
        const candidateSnapshotId = file.slice(0, -'.json'.length);
        try {
          const cache = await this.readCacheLocked(level, candidateSnapshotId);
          invalidated += Object.keys(cache.nodes).length;
        } catch (error) {
          if (!(error instanceof MemorySummaryCorruptionError)) {
            throw error;
          }
        }
        await atomicRemoveFile(path.join(levelDirectory, file));
      }
      return invalidated;
    });
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await fs.ensureDir(this.summariesDirectory);
    return withFileLock(this.lockPath, operation, CACHE_LOCK_OPTIONS);
  }

  private async loadOrBuildLocked(
    level: MemoryLevel,
    entries: MemoryEntry[],
    snapshotId: string,
  ): Promise<MemorySummaryCache> {
    const cachePath = this.cachePath(level, snapshotId);
    if (await fs.pathExists(cachePath)) {
      return this.readCacheLocked(level, snapshotId);
    }

    const nodes: Record<string, MemoryOutlineNode> = {};
    const buildNode = (start: number, end: number): MemoryOutlineNode => {
      const id = `${snapshotId}:${start}-${end}`;
      if (end - start === 1) {
        const entry = entries[start]!;
        const leaf: MemoryOutlineNode = {
          id,
          snapshotId,
          level,
          kind: 'memory',
          start,
          end,
          summary: normalizeContent(entry.content),
          memoryId: entry.id,
          tags: entry.tags,
        };
        nodes[id] = leaf;
        return leaf;
      }

      const middle = start + Math.floor((end - start) / 2);
      const left = buildNode(start, middle);
      const right = buildNode(middle, end);
      const first = entries[start]!;
      const last = entries[end - 1]!;
      const summary: MemoryOutlineNode = {
        id,
        snapshotId,
        level,
        kind: 'summary',
        start,
        end,
        summary: truncate(
          `${end - start} memories: ${normalizeContent(first.content)}`
          + `${end - start > 1 ? ` … ${normalizeContent(last.content)}` : ''}`,
          SUMMARY_LIMIT,
        ),
        children: [left.id, right.id],
      };
      nodes[id] = summary;
      return summary;
    };

    const root = entries.length > 0 ? buildNode(0, entries.length) : null;
    const cache: MemorySummaryCache = {
      version: CACHE_VERSION,
      level,
      snapshotId,
      entries,
      rootId: root?.id ?? null,
      nodes,
    };
    await atomicWriteJson(cachePath, cache);
    await this.pruneOldSnapshotsLocked(level, snapshotId);
    return cache;
  }

  private async pruneOldSnapshotsLocked(
    level: MemoryLevel,
    currentSnapshotId: string,
  ): Promise<void> {
    const directory = this.levelDirectory(level);
    const files = (await fs.readdir(directory))
      .filter((file) => file.endsWith('.json'));
    if (files.length <= MAX_DERIVED_SNAPSHOTS_PER_LEVEL) {
      return;
    }

    const candidates = await Promise.all(files.map(async (file) => ({
      file,
      mtimeMs: (await fs.stat(path.join(directory, file))).mtimeMs,
    })));
    candidates.sort((left, right) =>
      left.mtimeMs - right.mtimeMs || left.file.localeCompare(right.file)
    );

    let remaining = candidates.length;
    for (const candidate of candidates) {
      if (remaining <= MAX_DERIVED_SNAPSHOTS_PER_LEVEL) {
        break;
      }
      if (candidate.file === `${currentSnapshotId}.json`) {
        continue;
      }
      await atomicRemoveFile(path.join(directory, candidate.file));
      remaining -= 1;
    }
  }

  private createWakeOutline(
    cache: MemorySummaryCache,
    options: MemoryOutlineOptions,
  ): MemoryOutline {
    if (!cache.rootId) {
      return {
        snapshotId: cache.snapshotId,
        totalEntries: 0,
        nodes: [],
        text: '',
      };
    }

    const maxLines = clampInteger(options.maxLines, DEFAULT_MAX_LINES, 1);
    const maxChars = clampInteger(options.maxChars, DEFAULT_MAX_CHARS, 1);
    let recentRawCount = Math.min(
      cache.entries.length,
      clampInteger(options.recentRawCount, DEFAULT_RECENT_RAW_COUNT, 0),
    );
    let nodes: MemoryOutlineNode[] = [];

    while (recentRawCount >= 0) {
      const recentStart = cache.entries.length - recentRawCount;
      nodes = this.cover(cache, this.requireNode(cache, cache.rootId), recentStart);
      const formatted = this.formatOutline(cache, nodes, maxChars);
      if (
        nodes.length <= maxLines
        && this.minimumOutlineLength(nodes) <= maxChars
        && formatted.text.length <= maxChars
      ) {
        return formatted;
      }
      recentRawCount -= 1;
    }

    return this.formatOutline(cache, [this.requireNode(cache, cache.rootId)], maxChars);
  }

  private cover(
    cache: MemorySummaryCache,
    node: MemoryOutlineNode,
    recentStart: number,
  ): MemoryOutlineNode[] {
    if (node.end <= recentStart || node.kind === 'memory' || !node.children) {
      return [node];
    }
    return node.children.flatMap((childId) =>
      this.cover(cache, this.requireNode(cache, childId), recentStart)
    );
  }

  private formatOutline(
    cache: MemorySummaryCache,
    nodes: MemoryOutlineNode[],
    maxChars: number,
  ): MemoryOutline {
    const prefixes = nodes.map((node) => this.nodePrefix(node));
    const fixedLength = prefixes.reduce((total, prefix) => total + prefix.length, 0)
      + Math.max(0, nodes.length - 1);
    const contentBudget = Math.max(0, maxChars - fixedLength);
    const perNodeBudget = nodes.length > 0 ? Math.floor(contentBudget / nodes.length) : 0;
    const lines = nodes.map((node, index) =>
      `${prefixes[index]}${truncate(node.summary, perNodeBudget)}`
    );
    let text = lines.join('\n');
    if (text.length > maxChars) {
      text = truncate(text, maxChars);
    }
    return {
      snapshotId: cache.snapshotId,
      totalEntries: cache.entries.length,
      nodes,
      text,
    };
  }

  private minimumOutlineLength(nodes: readonly MemoryOutlineNode[]): number {
    return nodes.reduce(
      (total, node) => total + this.nodePrefix(node).length + 1,
      Math.max(0, nodes.length - 1),
    );
  }

  private nodePrefix(node: MemoryOutlineNode): string {
    return node.kind === 'memory'
      ? `- memory ${node.memoryId ?? node.id}: `
      : `- summary ${node.id} (${node.end - node.start} memories): `;
  }

  private async readCacheLocked(
    level: MemoryLevel,
    snapshotId: string,
  ): Promise<MemorySummaryCache> {
    const cachePath = this.cachePath(level, snapshotId);
    if (!(await fs.pathExists(cachePath))) {
      throw new Error(`Memory summary snapshot is unavailable: ${snapshotId}`);
    }
    let value: unknown;
    try {
      value = await fs.readJson(cachePath) as unknown;
    } catch (error) {
      throw new MemorySummaryCorruptionError(snapshotId, (error as Error).message);
    }
    if (!this.isCache(value, level, snapshotId)) {
      throw new MemorySummaryCorruptionError(snapshotId, 'unexpected cache structure');
    }
    return value;
  }

  private isCache(
    value: unknown,
    level: MemoryLevel,
    snapshotId: string,
  ): value is MemorySummaryCache {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const cache = value as Partial<MemorySummaryCache>;
    return cache.version === CACHE_VERSION
      && cache.level === level
      && cache.snapshotId === snapshotId
      && Array.isArray(cache.entries)
      && cache.entries.every(isMemoryEntry)
      && (cache.rootId === null || typeof cache.rootId === 'string')
      && typeof cache.nodes === 'object'
      && cache.nodes !== null;
  }

  private requireNode(cache: MemorySummaryCache, nodeId: string): MemoryOutlineNode {
    const node = cache.nodes[nodeId];
    if (!node) {
      throw new MemorySummaryCorruptionError(cache.snapshotId, `missing node ${nodeId}`);
    }
    return node;
  }

  private cachePath(level: MemoryLevel, snapshotId: string): string {
    this.assertSnapshotId(snapshotId);
    return path.join(this.levelDirectory(level), `${snapshotId}.json`);
  }

  private levelDirectory(level: MemoryLevel): string {
    return path.join(this.summariesDirectory, level);
  }

  private assertSnapshotId(snapshotId: string): void {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(snapshotId)
      || snapshotId.includes('..')
    ) {
      throw new Error(`Invalid memory snapshot identifier: ${snapshotId}`);
    }
  }
}
