/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { withFileLock } from '../utils/atomicFile.js';
import type {
  MemoryEntry,
  MemoryEvent,
  MemoryEventInput,
  MemoryLevel,
} from './types.js';

const EVENT_LOG_VERSION = 1;
const EVENT_DIRECTORY = 'events';
const EVENT_LOG_FILE = 'LOG.jsonl';
const EVENT_LOG_LOCK = '.LOG.jsonl.lock';
const EVENT_LOG_LOCK_OPTIONS = {
  staleMs: 30_000,
  waitTimeoutMs: 5_000,
  retryDelayMs: 10,
} as const;

const MEMORY_OPERATIONS = new Set<MemoryEvent['operation']>([
  'snapshot',
  'create',
  'update',
  'delete',
]);

export class MemoryEventLogCorruptionError extends Error {
  constructor(
    message: string,
    readonly lineNumber: number,
  ) {
    super(`Memory event log is corrupt at line ${lineNumber}: ${message}`);
    this.name = 'MemoryEventLogCorruptionError';
  }
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
      || (Array.isArray(entry.tags) && entry.tags.every((tag) => typeof tag === 'string')))
    && (entry.source === undefined || typeof entry.source === 'string');
}

function parseMemoryEvent(value: unknown, lineNumber: number): MemoryEvent {
  if (typeof value !== 'object' || value === null) {
    throw new MemoryEventLogCorruptionError('record must be an object', lineNumber);
  }

  const event = value as Partial<MemoryEvent>;
  if (event.version !== EVENT_LOG_VERSION) {
    throw new MemoryEventLogCorruptionError('unsupported version', lineNumber);
  }
  if (typeof event.eventId !== 'string' || !event.eventId) {
    throw new MemoryEventLogCorruptionError('eventId must be a non-empty string', lineNumber);
  }
  if (!MEMORY_OPERATIONS.has(event.operation as MemoryEvent['operation'])) {
    throw new MemoryEventLogCorruptionError('operation is invalid', lineNumber);
  }
  if (event.level !== 'user' && event.level !== 'project') {
    throw new MemoryEventLogCorruptionError('level is invalid', lineNumber);
  }
  if (typeof event.memoryId !== 'string' || !event.memoryId) {
    throw new MemoryEventLogCorruptionError('memoryId must be a non-empty string', lineNumber);
  }
  if (typeof event.occurredAt !== 'string' || Number.isNaN(Date.parse(event.occurredAt))) {
    throw new MemoryEventLogCorruptionError('occurredAt must be an ISO timestamp', lineNumber);
  }

  if (event.operation === 'delete') {
    if (event.entry !== undefined) {
      throw new MemoryEventLogCorruptionError('delete events cannot contain an entry', lineNumber);
    }
  } else if (!isMemoryEntry(event.entry) || event.entry.id !== event.memoryId) {
    throw new MemoryEventLogCorruptionError('event entry is invalid', lineNumber);
  }

  return event as MemoryEvent;
}

export class MemoryEventLog {
  private readonly eventsDirectory: string;
  private readonly logPath: string;
  private readonly lockPath: string;

  constructor(private readonly memoryDirectory: string) {
    this.eventsDirectory = path.join(memoryDirectory, EVENT_DIRECTORY);
    this.logPath = path.join(this.eventsDirectory, EVENT_LOG_FILE);
    this.lockPath = path.join(this.eventsDirectory, EVENT_LOG_LOCK);
  }

  async initialize(level: MemoryLevel, existingEntries: MemoryEntry[]): Promise<void> {
    await this.withLock(async () => {
      const existingEvents = await this.readAllLocked();
      if (existingEvents.length > 0 || existingEntries.length === 0) {
        return;
      }

      const snapshots = [...existingEntries]
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
        .map((entry): MemoryEvent => this.createEvent({
          operation: 'snapshot',
          level,
          entry,
        }));
      await this.appendEventsLocked(snapshots);
    });
  }

  async append(input: MemoryEventInput): Promise<MemoryEvent> {
    return this.withLock(async () => {
      await this.readAllLocked();
      const event = this.createEvent(input);
      await this.appendEventsLocked([event]);
      return event;
    });
  }

  async readAll(): Promise<MemoryEvent[]> {
    return this.withLock(() => this.readAllLocked());
  }

  async replay(): Promise<MemoryEntry[]> {
    const events = await this.readAll();
    const entries = new Map<string, MemoryEntry>();

    for (const event of events) {
      if (event.operation === 'delete') {
        entries.delete(event.memoryId);
      } else {
        entries.set(event.memoryId, event.entry);
      }
    }

    return [...entries.values()].sort((left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      || left.id.localeCompare(right.id)
    );
  }

  private createEvent(input: MemoryEventInput): MemoryEvent {
    const eventId = crypto.randomUUID();
    const occurredAt = new Date().toISOString();
    if (input.operation === 'delete') {
      return {
        version: EVENT_LOG_VERSION,
        eventId,
        operation: 'delete',
        level: input.level,
        memoryId: input.memoryId,
        occurredAt,
      };
    }

    return {
      version: EVENT_LOG_VERSION,
      eventId,
      operation: input.operation,
      level: input.level,
      memoryId: input.entry.id,
      occurredAt,
      entry: input.entry,
    };
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await fs.ensureDir(this.eventsDirectory);
    return withFileLock(this.lockPath, operation, EVENT_LOG_LOCK_OPTIONS);
  }

  private async readAllLocked(): Promise<MemoryEvent[]> {
    const content = await this.readRepairedContentLocked();
    if (!content) {
      return [];
    }

    return content
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line, index) => {
        try {
          return parseMemoryEvent(JSON.parse(line), index + 1);
        } catch (error) {
          if (error instanceof MemoryEventLogCorruptionError) {
            throw error;
          }
          const message = error instanceof Error ? error.message : String(error);
          throw new MemoryEventLogCorruptionError(message, index + 1);
        }
      });
  }

  private async readRepairedContentLocked(): Promise<string> {
    if (!(await fs.pathExists(this.logPath))) {
      return '';
    }

    const content = await nodeFs.readFile(this.logPath);
    if (content.length === 0 || content[content.length - 1] === 0x0a) {
      return content.toString('utf8');
    }

    const lastNewline = content.lastIndexOf(0x0a);
    const repairedLength = lastNewline < 0 ? 0 : lastNewline + 1;
    const handle = await nodeFs.open(this.logPath, 'r+');
    try {
      await handle.truncate(repairedLength);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return content.subarray(0, repairedLength).toString('utf8');
  }

  private async appendEventsLocked(events: MemoryEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const content = `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
    const handle = await nodeFs.open(this.logPath, 'a', 0o600);
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
