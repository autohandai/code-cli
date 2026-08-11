/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  ReadFileCoverageRange,
  ReadFileRevision,
  SessionReadFileEntry,
  SessionReadFileState,
} from '../../session/types.js';
import type { LoadedConfig } from '../../types.js';

const READ_LEDGER_SCHEMA_VERSION = 1 as const;
const MAX_LEDGER_ENTRIES = 128;
const MAX_VIEWS_PER_ENTRY = 16;
const MAX_COVERAGE_RANGES_PER_ENTRY = 256;

export type StatefulReadMode = 'off' | 'ledger' | 'dedup' | 'enforce';

export interface ReadStateSession {
  metadata: { sessionId: string };
  getReadFileState(): SessionReadFileState | null;
  updateReadFileState(state: SessionReadFileState): Promise<void>;
}

export interface ReadStateStore {
  getCurrentSession(): ReadStateSession | null;
}

export interface ModelVisibleReadRecord {
  path: string;
  revision: ReadFileRevision;
  revisionStable: boolean;
  visibleLines: number[];
  reachedEof: boolean;
  totalLines: number;
  sha256?: string;
  offset: number;
  viewKey?: string;
}

export interface ReadDedupCandidate {
  path: string;
  revision: ReadFileRevision;
  viewKey: string;
  offset: number;
}

export type ReadMutationAuthorization =
  | { allowed: true }
  | { allowed: false; reason: 'unread' | 'partial' | 'changed' };

export function resolveStatefulReadMode(
  config: Pick<LoadedConfig, 'features'>,
  env: NodeJS.ProcessEnv = process.env,
): StatefulReadMode {
  if (env.AUTOHAND_DISABLE_STATEFUL_READ === '1') {
    return 'off';
  }
  if (config.features?.readBeforeWrite === true) {
    return 'enforce';
  }
  if (config.features?.readStateDedup === true) {
    return 'dedup';
  }
  if (config.features?.readStateLedger === true) {
    return 'ledger';
  }
  return 'off';
}

export class ReadSessionLedger {
  private activeSessionKey: string | null = null;
  private state: SessionReadFileState = createEmptyState();
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly store?: ReadStateStore) {}

  async authorizeMutation(filePath: string, currentSha256: string): Promise<ReadMutationAuthorization> {
    return this.runExclusive(async () => {
      await this.activateCurrentSession();
      const normalizedPath = normalizeLedgerPath(filePath);
      const entry = this.state.entries.find(current => current.path === normalizedPath);
      if (!entry) {
        return { allowed: false, reason: 'unread' };
      }
      if (!entry.complete || !entry.sha256) {
        return { allowed: false, reason: 'partial' };
      }
      if (entry.sha256 !== currentSha256) {
        return { allowed: false, reason: 'changed' };
      }
      return { allowed: true };
    });
  }

  async consumeDuplicate(candidate: ReadDedupCandidate): Promise<boolean> {
    return this.runExclusive(async () => {
      await this.activateCurrentSession();
      const normalizedPath = normalizeLedgerPath(candidate.path);
      const entry = this.state.entries.find(current => current.path === normalizedPath);
      if (!entry
        || !sameRevision(entry.revision, candidate.revision)
        || (candidate.offset === 0 && !entry.complete)) {
        return false;
      }
      const viewIndex = entry.views.findIndex(view => view.key === candidate.viewKey);
      if (viewIndex === -1) {
        return false;
      }

      entry.views.splice(viewIndex, 1);
      entry.lastReadAt = new Date().toISOString();
      this.state.entries = [
        entry,
        ...this.state.entries.filter(current => current.path !== normalizedPath),
      ];
      await this.persistCurrentState();
      return true;
    });
  }

  async recordRead(record: ModelVisibleReadRecord): Promise<void> {
    if (!record.revisionStable) {
      return;
    }

    await this.runExclusive(async () => {
      await this.activateCurrentSession();
      const now = new Date().toISOString();
      const normalizedPath = normalizeLedgerPath(record.path);
      const existing = this.state.entries.find(entry => entry.path === normalizedPath);
      const entry = existing && sameRevision(existing.revision, record.revision)
        ? existing
        : createEntry(normalizedPath, record.revision, now);

      entry.coverage = mergeCoverage([
        ...entry.coverage,
        ...coverageForVisibleLines(record.visibleLines),
      ]).slice(0, MAX_COVERAGE_RANGES_PER_ENTRY);
      if (record.reachedEof && record.sha256) {
        entry.totalLines = record.totalLines;
        entry.sha256 = record.sha256;
      }
      entry.complete = entry.sha256 !== undefined
        && entry.totalLines !== undefined
        && (
          entry.totalLines === 0
            ? entry.complete || record.offset === 0
            : coversAllLines(entry.coverage, entry.totalLines)
        );
      entry.lastReadAt = now;
      if (record.viewKey) {
        entry.views = [
          { key: record.viewKey, recordedAt: now },
          ...entry.views.filter(view => view.key !== record.viewKey),
        ].slice(0, MAX_VIEWS_PER_ENTRY);
      }

      this.state.entries = [
        entry,
        ...this.state.entries.filter(candidate => candidate.path !== normalizedPath),
      ].slice(0, MAX_LEDGER_ENTRIES);
      await this.persistCurrentState();
    });
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async activateCurrentSession(): Promise<void> {
    const session = this.store?.getCurrentSession() ?? null;
    const sessionKey = session?.metadata.sessionId ?? 'in-memory';
    if (sessionKey === this.activeSessionKey) {
      return;
    }
    this.activeSessionKey = sessionKey;
    this.state = normalizeState(session?.getReadFileState());
  }

  private async persistCurrentState(): Promise<void> {
    const session = this.store?.getCurrentSession() ?? null;
    if (!session || session.metadata.sessionId !== this.activeSessionKey) {
      return;
    }
    try {
      await session.updateReadFileState(this.state);
    } catch {
      // Reads remain usable when auxiliary session persistence is unavailable.
    }
  }
}

function createEmptyState(): SessionReadFileState {
  return { schemaVersion: READ_LEDGER_SCHEMA_VERSION, entries: [] };
}

function createEntry(
  filePath: string,
  revision: ReadFileRevision,
  now: string,
): SessionReadFileEntry {
  return {
    path: filePath,
    revision: { ...revision },
    coverage: [],
    complete: false,
    views: [],
    lastReadAt: now,
  };
}

function normalizeState(state: SessionReadFileState | null | undefined): SessionReadFileState {
  if (!isRecord(state)
    || state.schemaVersion !== READ_LEDGER_SCHEMA_VERSION
    || !Array.isArray(state.entries)) {
    return createEmptyState();
  }
  return {
    schemaVersion: READ_LEDGER_SCHEMA_VERSION,
    entries: state.entries
      .slice(0, MAX_LEDGER_ENTRIES)
      .map(normalizeEntry)
      .filter((entry): entry is SessionReadFileEntry => entry !== null),
  };
}

function normalizeEntry(value: unknown): SessionReadFileEntry | null {
  if (!isRecord(value)
    || typeof value.path !== 'string'
    || value.path.length === 0
    || value.path.length > 16_384
    || !isReadFileRevision(value.revision)
    || !Array.isArray(value.coverage)
    || !Array.isArray(value.views)) {
    return null;
  }
  const coverage = mergeCoverage(
    value.coverage
      .slice(0, MAX_COVERAGE_RANGES_PER_ENTRY * 2)
      .filter(isCoverageRange),
  ).slice(0, MAX_COVERAGE_RANGES_PER_ENTRY);
  const totalLines = Number.isSafeInteger(value.totalLines) && Number(value.totalLines) >= 0
    ? Number(value.totalLines)
    : undefined;
  const sha256 = typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(value.sha256)
    ? value.sha256
    : undefined;
  const complete = sha256 !== undefined
    && totalLines !== undefined
    && (totalLines === 0
      ? value.complete === true
      : coversAllLines(coverage, totalLines));

  return {
    path: normalizeLedgerPath(value.path),
    revision: { ...value.revision },
    coverage,
    ...(totalLines === undefined ? {} : { totalLines }),
    ...(sha256 === undefined ? {} : { sha256 }),
    complete,
    views: value.views
      .slice(0, MAX_VIEWS_PER_ENTRY * 2)
      .filter(isReadFileView)
      .slice(0, MAX_VIEWS_PER_ENTRY)
      .map(view => ({ key: view.key, recordedAt: view.recordedAt })),
    lastReadAt: typeof value.lastReadAt === 'string'
      ? value.lastReadAt
      : new Date(0).toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReadFileRevision(value: unknown): value is ReadFileRevision {
  if (!isRecord(value)) {
    return false;
  }
  return isNonNegativeFiniteNumber(value.sizeBytes)
    && isNonNegativeFiniteNumber(value.mtimeMs)
    && isNonNegativeFiniteNumber(value.ctimeMs)
    && (value.inode === undefined || isNonNegativeFiniteNumber(value.inode))
    && (value.device === undefined || isNonNegativeFiniteNumber(value.device));
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isCoverageRange(value: unknown): value is ReadFileCoverageRange {
  return isRecord(value)
    && Number.isSafeInteger(value.startLine)
    && Number(value.startLine) >= 0
    && Number.isSafeInteger(value.endLineExclusive)
    && Number(value.endLineExclusive) > Number(value.startLine);
}

function isReadFileView(value: unknown): value is { key: string; recordedAt: string } {
  return isRecord(value)
    && typeof value.key === 'string'
    && value.key.length <= 4_096
    && typeof value.recordedAt === 'string';
}

function normalizeLedgerPath(filePath: string): string {
  return filePath.replace(/\\/gu, '/');
}

function sameRevision(left: ReadFileRevision, right: ReadFileRevision): boolean {
  return left.sizeBytes === right.sizeBytes
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.inode === right.inode
    && left.device === right.device;
}

function coverageForVisibleLines(lines: number[]): ReadFileCoverageRange[] {
  const ordered = [...new Set(lines)]
    .filter(line => Number.isSafeInteger(line) && line >= 0)
    .sort((left, right) => left - right);
  const ranges: ReadFileCoverageRange[] = [];
  for (const line of ordered) {
    const previous = ranges.at(-1);
    if (previous && previous.endLineExclusive === line) {
      previous.endLineExclusive = line + 1;
    } else {
      ranges.push({ startLine: line, endLineExclusive: line + 1 });
    }
  }
  return ranges;
}

function mergeCoverage(ranges: ReadFileCoverageRange[]): ReadFileCoverageRange[] {
  const ordered = ranges
    .filter(range => range.startLine >= 0 && range.endLineExclusive > range.startLine)
    .map(range => ({ ...range }))
    .sort((left, right) => left.startLine - right.startLine || left.endLineExclusive - right.endLineExclusive);
  const merged: ReadFileCoverageRange[] = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (previous && range.startLine <= previous.endLineExclusive) {
      previous.endLineExclusive = Math.max(previous.endLineExclusive, range.endLineExclusive);
    } else {
      merged.push(range);
    }
  }
  return merged;
}

function coversAllLines(coverage: ReadFileCoverageRange[], totalLines: number): boolean {
  return coverage.length === 1
    && coverage[0].startLine === 0
    && coverage[0].endLineExclusive >= totalLines;
}
