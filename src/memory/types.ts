/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type MemoryLevel = 'project' | 'user';

export interface MemoryEntry {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  source?: string;
}

export interface MemoryIndex {
  version: number;
  entries: MemoryIndexEntry[];
}

export interface MemoryIndexEntry {
  id: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
}

export interface SimilarityMatch {
  entry: MemoryEntry;
  score: number;
}

export type MemoryEventOperation = 'snapshot' | 'create' | 'update' | 'delete';

interface MemoryEventBase {
  version: 1;
  eventId: string;
  operation: MemoryEventOperation;
  level: MemoryLevel;
  memoryId: string;
  occurredAt: string;
}

export type MemoryEvent =
  | (MemoryEventBase & {
      operation: 'snapshot' | 'create' | 'update';
      entry: MemoryEntry;
    })
  | (MemoryEventBase & {
      operation: 'delete';
      entry?: never;
    });

export type MemoryEventInput =
  | {
      operation: 'snapshot' | 'create' | 'update';
      level: MemoryLevel;
      entry: MemoryEntry;
    }
  | {
      operation: 'delete';
      level: MemoryLevel;
      memoryId: string;
    };

export interface MemoryEventSnapshot {
  snapshotId: string;
  eventCount: number;
  events: MemoryEvent[];
  entries: MemoryEntry[];
}

export interface MemoryOutlineOptions {
  maxLines?: number;
  maxChars?: number;
  recentRawCount?: number;
  snapshotEventCount?: number;
}

export interface MemoryOutlineNode {
  id: string;
  snapshotId: string;
  level: MemoryLevel;
  kind: 'summary' | 'memory';
  start: number;
  end: number;
  summary: string;
  memoryId?: string;
  tags?: string[];
  children?: [string, string];
}

export interface MemoryOutline {
  snapshotId: string;
  eventCount?: number;
  totalEntries: number;
  nodes: MemoryOutlineNode[];
  text: string;
}

export interface RecalledMemory {
  id: string;
  content: string;
  level: MemoryLevel;
  tags?: string[];
  updatedAt: string;
  score: number;
}
