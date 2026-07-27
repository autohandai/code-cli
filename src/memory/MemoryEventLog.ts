/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { withFileLock } from '../utils/atomicFile.js';
import type {
  MemoryEntry,
  MemoryEvent,
  MemoryEventInput,
  MemoryEventSnapshot,
  MemoryLevel,
} from './types.js';
import { assertSafeMemoryId, isSafeMemoryId } from './MemoryPathSafety.js';

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
  if (typeof event.memoryId !== 'string' || !isSafeMemoryId(event.memoryId)) {
    throw new MemoryEventLogCorruptionError('memoryId is unsafe or invalid', lineNumber);
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

function compareMemoryEvents(left: MemoryEvent, right: MemoryEvent): number {
  return left.occurredAt.localeCompare(right.occurredAt)
    || left.eventId.localeCompare(right.eventId);
}

function parseEventLogContent(content: string | Buffer): MemoryEvent[] {
  const text = typeof content === 'string' ? content : content.toString('utf8');
  if (!text) {
    return [];
  }
  if (!text.endsWith('\n')) {
    throw new MemoryEventLogCorruptionError('record is missing its trailing newline', 1);
  }
  const events = text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return parseMemoryEvent(JSON.parse(line), index + 1);
      } catch (error) {
        if (error instanceof MemoryEventLogCorruptionError) {
          throw error;
        }
        throw new MemoryEventLogCorruptionError((error as Error).message, index + 1);
      }
    });
  const eventLines = new Map<string, number>();
  for (const [index, event] of events.entries()) {
    const previousLine = eventLines.get(event.eventId);
    if (previousLine !== undefined) {
      throw new MemoryEventLogCorruptionError(
        `duplicate eventId ${event.eventId} also appears at line ${previousLine}`,
        index + 1,
      );
    }
    eventLines.set(event.eventId, index + 1);
  }
  return events;
}

export function mergeMemoryEventLogContents(
  localContent: string | Buffer,
  remoteContent: string | Buffer,
): string {
  const localText = typeof localContent === 'string'
    ? localContent
    : localContent.toString('utf8');
  const localEvents = parseEventLogContent(localText);
  const remoteEvents = parseEventLogContent(remoteContent);
  const eventsById = new Map(localEvents.map((event) => [event.eventId, event]));
  const missing: MemoryEvent[] = [];

  for (const event of remoteEvents) {
    const existing = eventsById.get(event.eventId);
    if (existing) {
      if (!isDeepStrictEqual(existing, event)) {
        throw new MemoryEventLogCorruptionError(
          `duplicate eventId ${event.eventId} has conflicting content`,
          1,
        );
      }
      continue;
    }
    eventsById.set(event.eventId, event);
    missing.push(event);
  }

  if (missing.length === 0) {
    return localText;
  }
  const prefix = localText && !localText.endsWith('\n') ? `${localText}\n` : localText;
  return `${prefix}${missing.map((event) => JSON.stringify(event)).join('\n')}\n`;
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
        .reduce<MemoryEvent[]>((events, entry) => {
          events.push(this.createEvent(
            {
              operation: 'snapshot',
              level,
              entry,
            },
            events.at(-1)?.occurredAt,
          ));
          return events;
        }, []);
      await this.appendEventsLocked(snapshots);
    });
  }

  async append(input: MemoryEventInput): Promise<MemoryEvent> {
    return this.withLock(async () => {
      const existingEvents = await this.readAllLocked();
      const event = this.createEvent(input, existingEvents.at(-1)?.occurredAt);
      await this.appendEventsLocked([event]);
      return event;
    });
  }

  async readAll(): Promise<MemoryEvent[]> {
    return this.withLock(() => this.readAllLocked());
  }

  async replay(): Promise<MemoryEntry[]> {
    const events = await this.readAll();
    return this.replayEvents(events);
  }

  async snapshot(eventCount?: number): Promise<MemoryEventSnapshot> {
    const allEvents = await this.readAll();
    const resolvedCount = eventCount ?? allEvents.length;
    if (!Number.isInteger(resolvedCount) || resolvedCount < 0 || resolvedCount > allEvents.length) {
      throw new Error(`Invalid memory event snapshot count: ${resolvedCount}`);
    }
    const events = allEvents.slice(0, resolvedCount);
    const snapshotId = crypto
      .createHash('sha256')
      .update(events.map((event) => event.eventId).join('\n'))
      .digest('hex')
      .slice(0, 20);
    return {
      snapshotId,
      eventCount: resolvedCount,
      events,
      entries: this.replayEvents(events),
    };
  }

  private replayEvents(events: readonly MemoryEvent[]): MemoryEntry[] {
    const entries = new Map<string, MemoryEntry>();

    for (const event of [...events].sort(compareMemoryEvents)) {
      if (event.operation === 'delete') {
        entries.delete(event.memoryId);
      } else if (event.operation === 'snapshot') {
        if (!entries.has(event.memoryId)) {
          entries.set(event.memoryId, event.entry);
        }
      } else {
        entries.set(event.memoryId, event.entry);
      }
    }

    return [...entries.values()].sort((left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      || left.id.localeCompare(right.id)
    );
  }

  private createEvent(input: MemoryEventInput, previousOccurredAt?: string): MemoryEvent {
    const eventId = crypto.randomUUID();
    const now = Date.now();
    const previous = previousOccurredAt ? Date.parse(previousOccurredAt) : Number.NaN;
    const occurredAt = new Date(
      Number.isNaN(previous) ? now : Math.max(now, previous + 1),
    ).toISOString();
    if (input.operation === 'delete') {
      assertSafeMemoryId(input.memoryId);
      return {
        version: EVENT_LOG_VERSION,
        eventId,
        operation: 'delete',
        level: input.level,
        memoryId: input.memoryId,
        occurredAt,
      };
    }

    assertSafeMemoryId(input.entry.id);
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
    return parseEventLogContent(content);
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
