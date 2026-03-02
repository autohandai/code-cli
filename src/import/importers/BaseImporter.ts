/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import fse from 'fs-extra';
import type {
  Importer,
  ImportSource,
  ImportCategory,
  ImportScanResult,
  ImportResult,
  ProgressCallback,
} from '../types.js';
import type { SessionMetadata, SessionMessage, SessionIndex } from '../../session/types.js';
import { AUTOHAND_PATHS } from '../../constants.js';

/**
 * Options for writing an imported session to the Autohand session store.
 */
export interface WriteSessionOptions {
  projectPath: string;
  projectName: string;
  model: string;
  messages: SessionMessage[];
  source: ImportSource;
  originalId: string;
  createdAt: string;
  closedAt?: string;
  summary?: string;
  status?: SessionMetadata['status'];
}

/**
 * Abstract base class that all agent importers extend.
 *
 * Provides shared helpers for filesystem detection, JSONL parsing,
 * retry logic, and writing Autohand-native session data.
 */
export abstract class BaseImporter implements Importer {
  abstract readonly name: ImportSource;
  abstract readonly displayName: string;
  abstract readonly homePath: string;

  // ---------------------------------------------------------------
  // Resolved home path
  // ---------------------------------------------------------------

  /**
   * Expands a `~/` prefix to the user's home directory.
   * Returns absolute paths unchanged.
   */
  get resolvedHomePath(): string {
    if (this.homePath.startsWith('~/') || this.homePath === '~') {
      return path.join(os.homedir(), this.homePath.slice(2));
    }
    return this.homePath;
  }

  // ---------------------------------------------------------------
  // Detection
  // ---------------------------------------------------------------

  /**
   * Checks whether this agent's data directory exists on disk.
   */
  async detect(): Promise<boolean> {
    return fse.pathExists(this.resolvedHomePath);
  }

  // ---------------------------------------------------------------
  // Abstract methods (delegated to concrete importers)
  // ---------------------------------------------------------------

  abstract scan(): Promise<ImportScanResult>;
  abstract import(categories: ImportCategory[], onProgress?: ProgressCallback): Promise<ImportResult>;

  // ---------------------------------------------------------------
  // JSONL reader
  // ---------------------------------------------------------------

  /**
   * Reads a JSONL file and returns an array of parsed records.
   * Blank lines and malformed JSON lines are silently skipped.
   */
  protected async readJsonlFile(filePath: string): Promise<Record<string, unknown>[]> {
    const content = await fse.readFile(filePath, 'utf-8');
    const records: Record<string, unknown>[] = [];

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        records.push(JSON.parse(trimmed) as Record<string, unknown>);
      } catch {
        // Skip malformed JSON lines silently
      }
    }

    return records;
  }

  // ---------------------------------------------------------------
  // Retry with exponential backoff
  // ---------------------------------------------------------------

  /**
   * Retries `fn` up to `maxRetries` times with exponential backoff.
   * Throws the last error if all retries are exhausted.
   */
  protected async withRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    baseDelay = 1000,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries - 1) {
          await this.delay(baseDelay * Math.pow(2, attempt));
        }
      }
    }

    throw lastError!;
  }

  // ---------------------------------------------------------------
  // Session writing
  // ---------------------------------------------------------------

  /**
   * Creates a new Autohand session directory with metadata and conversation data.
   * Returns the generated session ID, or `null` if the session was already imported
   * (deduplication by source + originalId).
   */
  protected async writeAutohandSession(opts: WriteSessionOptions): Promise<string | null> {
    // Dedup check: skip if already imported with same source + originalId
    if (await this.isAlreadyImported(opts.source, opts.originalId)) {
      return null;
    }

    const timestamp = Date.now();
    const uuid = crypto.randomUUID();
    const sessionId = `${uuid}-${timestamp}`;

    const sessionDir = path.join(AUTOHAND_PATHS.sessions, sessionId);
    await fse.ensureDir(sessionDir);

    // Build metadata
    const metadata: SessionMetadata = {
      sessionId,
      createdAt: opts.createdAt,
      lastActiveAt: opts.closedAt ?? opts.createdAt,
      closedAt: opts.closedAt,
      projectPath: opts.projectPath,
      projectName: opts.projectName,
      model: opts.model,
      messageCount: opts.messages.length,
      summary: opts.summary,
      status: opts.status ?? 'completed',
      importedFrom: {
        source: opts.source,
        originalId: opts.originalId,
        importedAt: new Date().toISOString(),
      },
    };

    // Write metadata.json
    await fse.writeJson(path.join(sessionDir, 'metadata.json'), metadata, { spaces: 2 });

    // Write conversation.jsonl
    const jsonl = opts.messages.map(msg => JSON.stringify(msg)).join('\n') + '\n';
    await fse.writeFile(path.join(sessionDir, 'conversation.jsonl'), jsonl, 'utf-8');

    // Update the session index
    await this.updateSessionIndex(metadata);

    return sessionId;
  }

  /**
   * Checks whether a session from `source` with `originalId` was already imported.
   * Uses the session index for O(n) lookup with `importedFrom` field.
   */
  protected async isAlreadyImported(source: string, originalId: string): Promise<boolean> {
    const indexPath = path.join(AUTOHAND_PATHS.sessions, 'index.json');

    if (!(await fse.pathExists(indexPath))) {
      return false;
    }

    try {
      const loaded = await fse.readJson(indexPath);
      if (!loaded || !Array.isArray(loaded.sessions)) return false;

      return loaded.sessions.some(
        (s: { importedFrom?: { source: string; originalId: string } }) =>
          s.importedFrom?.source === source && s.importedFrom?.originalId === originalId,
      );
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------
  // Session index management
  // ---------------------------------------------------------------

  /**
   * Adds a session entry to `~/.autohand/sessions/index.json`.
   * Creates the file if it does not exist.
   */
  protected async updateSessionIndex(metadata: SessionMetadata): Promise<void> {
    const indexPath = path.join(AUTOHAND_PATHS.sessions, 'index.json');

    let index: SessionIndex = { sessions: [], byProject: {} };

    if (await fse.pathExists(indexPath)) {
      try {
        const loaded = await fse.readJson(indexPath);
        // Validate structure before trusting it
        if (
          loaded &&
          typeof loaded === 'object' &&
          Array.isArray(loaded.sessions) &&
          loaded.byProject &&
          typeof loaded.byProject === 'object'
        ) {
          index = loaded as SessionIndex;
        }
        // Otherwise keep the fresh empty index (corrupted file recovery)
      } catch {
        // Corrupted/empty JSON file — reset to empty index
      }
    }

    // Append session entry (include importedFrom for future dedup checks)
    const entry: SessionIndex['sessions'][number] = {
      id: metadata.sessionId,
      projectPath: metadata.projectPath,
      createdAt: metadata.createdAt,
      summary: metadata.summary,
    };
    if (metadata.importedFrom) {
      entry.importedFrom = {
        source: metadata.importedFrom.source,
        originalId: metadata.importedFrom.originalId,
      };
    }
    index.sessions.push(entry);

    // Group by project
    if (!index.byProject[metadata.projectPath]) {
      index.byProject[metadata.projectPath] = [];
    }
    index.byProject[metadata.projectPath].push(metadata.sessionId);

    await fse.ensureDir(AUTOHAND_PATHS.sessions);
    await fse.writeJson(indexPath, index, { spaces: 2 });
  }

  // ---------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------

  /**
   * Safely read and parse a JSON file with pre-validation.
   * Returns the parsed data, or throws with a descriptive error message.
   * Handles empty files, corrupted JSON, and non-object content gracefully.
   */
  protected async safeReadJson<T = Record<string, unknown>>(filePath: string): Promise<T> {
    const content = await fse.readFile(filePath, 'utf-8') as string;
    if (!content.trim()) {
      throw new Error(`File is empty: ${path.basename(filePath)}`);
    }

    try {
      const parsed = JSON.parse(content);
      return parsed as T;
    } catch (err) {
      throw new Error(
        `Invalid JSON in ${path.basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Simple promise-based delay.
   */
  protected delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
