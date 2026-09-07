/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { AUTOHAND_HOME } from '../constants.js';
import { atomicWriteJson, withFileLock } from '../utils/atomicFile.js';

export interface TypedMessageEntry {
  id: string;
  text: string;
  cwd: string;
  createdAt: string;
}

function isEntry(value: unknown): value is TypedMessageEntry {
  return typeof value === 'object' && value !== null
    && 'id' in value && typeof value.id === 'string'
    && 'text' in value && typeof value.text === 'string' && value.text.trim().length > 0
    && 'cwd' in value && typeof value.cwd === 'string'
    && 'createdAt' in value && typeof value.createdAt === 'string'
    && Number.isFinite(Date.parse(value.createdAt));
}

function mergeEntries(...groups: ReadonlyArray<readonly TypedMessageEntry[]>): TypedMessageEntry[] {
  return [...new Map(groups.flat().map(entry => [entry.id, entry])).values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 200);
}

export class TypedMessageHistory {
  private recent: TypedMessageEntry[] = [];
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly filePath?: string) {}

  entries(): readonly TypedMessageEntry[] {
    return this.recent;
  }

  record(text: string, cwd: string): Promise<void> {
    if (!text.trim() || /^\/whatityped(?:\s|$)/.test(text.trim())) return Promise.resolve();
    const entry = { id: randomUUID(), text, cwd, createdAt: new Date().toISOString() };
    this.recent = mergeEntries([entry], this.recent);
    return this.enqueue(async () => {
      if (!this.filePath) return;
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await withFileLock(`${this.filePath}.lock`, async () => {
        const entries = mergeEntries([entry], await this.readEntries());
        await atomicWriteJson(this.filePath!, entries);
        this.recent = mergeEntries(this.recent, entries);
      }, { waitTimeoutMs: 5_000 });
    });
  }

  refresh(): Promise<void> {
    return this.enqueue(async () => {
      this.recent = mergeEntries(await this.readEntries(), this.recent);
    });
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => {});
    return result;
  }

  private async readEntries(): Promise<TypedMessageEntry[]> {
    if (!this.filePath) return [];
    try {
      const value: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      return Array.isArray(value) ? value.filter(isEntry) : [];
    } catch (error) {
      if (error instanceof SyntaxError || (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) return [];
      throw error;
    }
  }
}

let sharedHistory: TypedMessageHistory | undefined;

export function getTypedMessageHistory(): TypedMessageHistory {
  return sharedHistory ??= new TypedMessageHistory(path.join(AUTOHAND_HOME, 'typed-message-history.json'));
}
