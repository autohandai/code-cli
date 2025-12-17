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
