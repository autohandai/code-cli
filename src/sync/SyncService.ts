/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Settings Sync Service
 * Manages background synchronization of ~/.autohand/ to cloud storage
 */
import fs from 'fs-extra';
import path from 'node:path';
import { AUTOHAND_HOME } from '../constants.js';
import { SyncApiClient, getSyncApiClient } from './SyncApiClient.js';
import { encryptConfig, decryptConfig, computeHash } from './encryption.js';
import {
  resolveSafeSyncPath,
  validateSyncManifestPaths,
  validateSyncPath,
} from './pathSafety.js';
import { isSessionIndex } from '../session/SessionManager.js';
import {
  acquireFileLock,
  atomicRemoveFile,
  atomicWriteFile,
  atomicWriteJson,
  withFileLock,
} from '../utils/atomicFile.js';
import type {
  SyncConfig,
  SyncManifest,
  SyncFileEntry,
  SyncResult,
  SyncActions,
  SyncEvent,
} from './types.js';
import {
  SYNC_EXCLUDE_ALWAYS,
  SYNC_CONSENT_REQUIRED,
  SYNC_INCLUDE_DEFAULT,
} from './types.js';

const MANIFEST_VERSION = 1;
const SYNC_STATE_FILE = '.sync-state.json';
const SYNC_LOCK_FILE = '.sync-lock';
const SESSION_INDEX_SYNC_PATH = 'sessions/index.json';
const SESSION_INDEX_LOCK_PATH = 'sessions/index.json.lock';
const SESSION_INDEX_LOCK_OPTIONS = {
  staleMs: 5 * 60 * 1000,
  waitTimeoutMs: 10 * 1000,
  retryDelayMs: 10,
} as const;
const MAX_TOTAL_SIZE = 100 * 1024 * 1024; // 100MB default
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2500;

interface SyncOperationContext {
  generation: number;
  signal: AbortSignal;
}

class SyncOperationStoppedError extends Error {
  constructor() {
    super('Sync service stopped');
    this.name = 'AbortError';
  }
}

export interface SyncServiceOptions {
  /** Auth token for API calls */
  authToken: string;
  /** User ID from auth */
  userId: string;
  /** Sync configuration */
  config: SyncConfig;
  /** Optional custom API client */
  apiClient?: SyncApiClient;
  /** Event handler for logging/telemetry */
  onEvent?: (event: SyncEvent) => void;
  /** Callback when authentication fails (401 error) */
  onAuthFailure?: () => void;
}

interface SyncState {
  lastSync: string;
  lastManifestHash: string;
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripUnsyncedConfigFields(config: JsonObject): JsonObject {
  const rest = { ...config };
  delete rest.auth;
  return rest;
}

function mergeDownloadedConfig(downloaded: JsonObject, local: JsonObject | null): JsonObject {
  const sanitizedDownloaded = stripUnsyncedConfigFields(downloaded);
  if (local && Object.prototype.hasOwnProperty.call(local, 'auth')) {
    return {
      ...sanitizedDownloaded,
      auth: local.auth,
    };
  }
  return sanitizedDownloaded;
}

function isRemoteNewer(localFile: SyncFileEntry, remoteFile: SyncFileEntry): boolean {
  const localTime = Date.parse(localFile.modifiedAt);
  const remoteTime = Date.parse(remoteFile.modifiedAt);

  if (Number.isNaN(localTime) || Number.isNaN(remoteTime)) {
    return true;
  }

  return remoteTime > localTime;
}

export class SyncService {
  private readonly authToken: string;
  private readonly userId: string;
  private readonly config: SyncConfig;
  private readonly client: SyncApiClient;
  private readonly onEvent: (event: SyncEvent) => void;
  private readonly onAuthFailure: (() => void) | undefined;
  private readonly basePath: string;

  private timer: ReturnType<typeof setInterval> | null = null;
  private syncing = false;
  private started = false;
  private authFailed = false;
  private stopped = false;
  private generation = 0;
  private operationController: AbortController | null = null;
  private activeOperation: Promise<SyncResult> | null = null;
  private shutdownPromise: Promise<void> | null = null;

  constructor(options: SyncServiceOptions) {
    this.authToken = options.authToken;
    this.userId = options.userId;
    this.config = options.config;
    this.client = options.apiClient || getSyncApiClient();
    this.onEvent = options.onEvent || (() => {});
    this.onAuthFailure = options.onAuthFailure;
    this.basePath = AUTOHAND_HOME;
  }

  /**
   * Start the background sync timer
   */
  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;

    // Run initial sync with proper error handling
    this.sync().then(result => {
      if (!result.success && this.isAuthError(result.error)) {
        // Auth failure already handled in sync()
      }
    }).catch(() => {
      // Unexpected error - already logged
    });

    // Set up periodic sync
    this.timer = setInterval(() => {
      // Skip if auth has failed
      if (this.authFailed) return;
      this.sync().catch(() => {});
    }, this.config.interval);
    this.timer.unref?.();
  }

  /**
   * Stop the background sync timer
   */
  stop(): void {
    if (!this.stopped) {
      this.stopped = true;
      this.generation++;
      this.operationController?.abort(new SyncOperationStoppedError());
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.started = false;
  }

  shutdown(options: { timeoutMs?: number } = {}): Promise<void> {
    if (!this.shutdownPromise) {
      this.shutdownPromise = this.performShutdown(
        options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
      );
    }
    return this.shutdownPromise;
  }

  /**
   * Check if the service is running
   */
  get isRunning(): boolean {
    return this.started;
  }

  /**
   * Perform a sync operation
   */
  async sync(): Promise<SyncResult> {
    return this.runOperation((context) => this.performSync(context));
  }

  private runOperation(
    operation: (context: SyncOperationContext) => Promise<SyncResult>,
  ): Promise<SyncResult> {
    if (this.stopped) {
      return Promise.resolve(this.stoppedResult());
    }
    if (this.syncing) {
      return Promise.resolve({
        success: false,
        uploaded: 0,
        downloaded: 0,
        conflicts: 0,
        error: 'Sync already in progress',
      });
    }

    const controller = new AbortController();
    const context: SyncOperationContext = {
      generation: this.generation,
      signal: controller.signal,
    };
    this.operationController = controller;
    const activeOperation = this.withSyncLock(context, operation);
    this.activeOperation = activeOperation;
    const clearActiveOperation = (): void => {
      if (this.activeOperation === activeOperation) {
        this.activeOperation = null;
      }
      if (this.operationController === controller) {
        this.operationController = null;
      }
    };
    void activeOperation.then(clearActiveOperation, clearActiveOperation);
    return activeOperation;
  }

  private async withSyncLock(
    context: SyncOperationContext,
    operation: (context: SyncOperationContext) => Promise<SyncResult>,
  ): Promise<SyncResult> {

    this.syncing = true;
    let lock: Awaited<ReturnType<typeof acquireFileLock>> = null;
    try {
      const lockPath = path.join(this.basePath, SYNC_LOCK_FILE);
      lock = await acquireFileLock(lockPath, { staleMs: 5 * 60 * 1000 });
      if (!this.isOperationActive(context)) {
        return this.stoppedResult();
      }
      if (!lock) {
        return {
          success: false,
          uploaded: 0,
          downloaded: 0,
          conflicts: 0,
          error: 'Sync locked by another process',
        };
      }

      return await operation(context);
    } finally {
      try {
        await lock?.release();
      } finally {
        this.syncing = false;
      }
    }
  }

  private async performSync(context: SyncOperationContext): Promise<SyncResult> {
    const startTime = Date.now();
    let downloaded = 0;
    let uploaded = 0;
    let conflicts = 0;

    try {
      this.assertOperationActive(context);
      this.onEvent({ type: 'sync_started' });

      // 1. Build local manifest
      const enabledRoots = await this.getIncludePaths();
      this.assertOperationActive(context);
      const localManifest = await this.buildLocalManifest(enabledRoots);
      this.assertOperationActive(context);

      // 1.5. Check total size limit
      const totalSize = localManifest.files.reduce((sum, f) => sum + f.size, 0);
      if (totalSize > MAX_TOTAL_SIZE) {
        return {
          success: false,
          uploaded: 0,
          downloaded: 0,
          conflicts: 0,
          error: `Total sync size (${Math.round(totalSize / 1024 / 1024)}MB) exceeds limit (${Math.round(MAX_TOTAL_SIZE / 1024 / 1024)}MB)`,
        };
      }

      // 2. Get remote manifest
      const remoteManifest = await this.client.getRemoteManifest(
        this.authToken,
        context.signal,
      );
      this.assertOperationActive(context);
      if (remoteManifest) {
        await this.validateManifestDestinations(remoteManifest, enabledRoots);
        this.assertOperationActive(context);
      }

      // 3. Compare and determine actions
      const actions = this.compareManifests(localManifest, remoteManifest);
      const mutatesLocalState = actions.downloads.length > 0
        || actions.conflicts.length > 0
        || actions.localDeletes.length > 0;

      // 4. Cloud wins on conflict - download remote changes first
      if (actions.downloads.length > 0 || actions.conflicts.length > 0) {
        const toDownload = [...actions.downloads, ...actions.conflicts];
        const conflictPaths = new Set(actions.conflicts.map((file) => file.path));
        await this.downloadFiles(toDownload, enabledRoots, (file) => {
          downloaded++;
          if (conflictPaths.has(file.path)) {
            conflicts++;
          }
        }, true, conflictPaths, context);
        this.assertOperationActive(context);
      }

      await this.removeLocalFiles(actions.localDeletes, enabledRoots, context);
      this.assertOperationActive(context);

      const authoritativeManifest = mutatesLocalState
        ? await this.buildLocalManifest(enabledRoots)
        : localManifest;
      this.assertOperationActive(context);
      const authoritativeTotalSize = authoritativeManifest.files.reduce(
        (sum, file) => sum + file.size,
        0,
      );
      if (authoritativeTotalSize > MAX_TOTAL_SIZE) {
        throw new Error(
          `Total sync size (${Math.round(authoritativeTotalSize / 1024 / 1024)}MB) `
          + `exceeds limit (${Math.round(MAX_TOTAL_SIZE / 1024 / 1024)}MB)`,
        );
      }

      // 5. Upload local changes
      if (actions.uploads.length > 0) {
        await this.uploadFiles(actions.uploads, authoritativeManifest, enabledRoots, () => {
          uploaded++;
        }, true, context);
        this.assertOperationActive(context);
      }

      // 6. Save sync state
      const stateFile = path.join(this.basePath, SYNC_STATE_FILE);
      const state: SyncState = {
        lastSync: new Date().toISOString(),
        lastManifestHash: computeHash(JSON.stringify(authoritativeManifest)),
      };
      this.assertOperationActive(context);
      await atomicWriteJson(stateFile, state, {
        beforeCommit: () => this.assertOperationActive(context),
      });
      this.assertOperationActive(context);

      const result: SyncResult = {
        success: true,
        uploaded,
        downloaded,
        conflicts,
        duration: Date.now() - startTime,
      };

      this.emitOperationEvent(context, { type: 'sync_completed', result });
      return result;
    } catch (error) {
      if (this.isStoppedError(error) || !this.isOperationActive(context)) {
        return this.stoppedResult(downloaded, uploaded, conflicts);
      }
      const errorMessage = (error as Error).message;

      // Check for authentication errors (401)
      if (this.isAuthError(errorMessage)) {
        this.handleAuthFailure(errorMessage);
        return {
          success: false,
          uploaded,
          downloaded,
          conflicts,
          error: 'Authentication expired. Please run /login again.',
          duration: Date.now() - startTime,
        };
      }

      this.emitOperationEvent(context, { type: 'sync_failed', error: errorMessage });

      return {
        success: false,
        uploaded,
        downloaded,
        conflicts,
        error: errorMessage,
        duration: Date.now() - startTime,
      };
    }
  }

  private isOperationActive(context: SyncOperationContext): boolean {
    return !this.stopped
      && !context.signal.aborted
      && context.generation === this.generation;
  }

  private assertOperationActive(context: SyncOperationContext): void {
    if (!this.isOperationActive(context)) {
      throw new SyncOperationStoppedError();
    }
  }

  private isStoppedError(error: unknown): boolean {
    return error instanceof SyncOperationStoppedError
      || (error instanceof Error && error.name === 'AbortError' && this.stopped);
  }

  private stoppedResult(
    downloaded = 0,
    uploaded = 0,
    conflicts = 0,
  ): SyncResult {
    return {
      success: false,
      uploaded,
      downloaded,
      conflicts,
      error: 'Sync service stopped',
    };
  }

  private emitOperationEvent(context: SyncOperationContext, event: SyncEvent): void {
    if (!this.isOperationActive(context)) return;
    this.emitEventSafely(event);
  }

  private async performShutdown(timeoutMs: number): Promise<void> {
    this.stop();
    const activeOperation = this.activeOperation;
    if (!activeOperation) return;

    let deadline: ReturnType<typeof setTimeout> | null = null;
    const timedOut = new Promise<void>((resolve) => {
      deadline = setTimeout(resolve, timeoutMs);
      deadline.unref?.();
    });
    try {
      await Promise.race([
        activeOperation.then(() => undefined, () => undefined),
        timedOut,
      ]);
    } finally {
      if (deadline) clearTimeout(deadline);
    }
  }

  private emitEventSafely(event: SyncEvent): void {
    try {
      this.onEvent(event);
    } catch {
      // Event observers must not change sync outcomes.
    }
  }

  /**
   * Check if an error message indicates an authentication failure
   */
  private isAuthError(errorMessage?: string): boolean {
    if (!errorMessage) return false;
    return errorMessage.includes('401') ||
           errorMessage.toLowerCase().includes('unauthorized') ||
           errorMessage.toLowerCase().includes('authentication');
  }

  /**
   * Handle authentication failure - stop service and notify
   */
  private handleAuthFailure(errorMessage: string): void {
    if (this.authFailed) return; // Already handled

    this.authFailed = true;
    this.stop();
    this.emitEventSafely({ type: 'auth_failure', error: errorMessage });
    try {
      this.onAuthFailure?.();
    } catch {
      // Authentication observers must not replace the sync error.
    }
  }

  private async validateManifestDestinations(
    manifest: SyncManifest,
    enabledRoots: readonly string[],
  ): Promise<void> {
    validateSyncManifestPaths(manifest, enabledRoots);
    if (manifest.userId !== this.userId) {
      throw new Error('Invalid sync manifest: userId does not match the authenticated user');
    }
    const totalSize = manifest.files.reduce((sum, file) => sum + file.size, 0);
    if (manifest.files.some((file) => file.size > this.client.limits.maxFileSize)) {
      throw new Error('Invalid sync manifest: file exceeds the configured size limit');
    }
    if (totalSize > this.client.limits.maxTotalSize) {
      throw new Error('Invalid sync manifest: files exceed the configured aggregate size limit');
    }
    const excludePatterns = [...SYNC_EXCLUDE_ALWAYS, ...(this.config.exclude || [])];
    for (const file of manifest.files) {
      if (this.isExcluded(file.path, excludePatterns)) {
        throw new Error('Unsafe sync path: remote manifest contains an excluded path');
      }
      await resolveSafeSyncPath(this.basePath, file.path, enabledRoots);
    }
  }

  private requireTransferUrls(
    files: readonly SyncFileEntry[],
    urls: Record<string, string> | undefined,
    transferType: 'upload' | 'download',
  ): Map<string, string> {
    const requiredUrls = new Map<string, string>();
    for (const file of files) {
      const url = urls?.[file.path];
      if (typeof url !== 'string' || url.length === 0) {
        throw new Error(`Missing ${transferType} URL for requested sync path`);
      }
      requiredUrls.set(file.path, url);
    }
    return requiredUrls;
  }

  private async downloadFiles(
    files: readonly SyncFileEntry[],
    enabledRoots: readonly string[],
    onDownloaded: (file: SyncFileEntry) => void,
    emitEvents: boolean,
    conflictPaths: ReadonlySet<string> = new Set<string>(),
    context?: SyncOperationContext,
  ): Promise<void> {
    for (const file of files) {
      await resolveSafeSyncPath(this.basePath, file.path, enabledRoots);
      if (context) this.assertOperationActive(context);
    }

    if (context) this.assertOperationActive(context);
    const { downloadUrls } = await this.client.initiateDownload(
      this.authToken,
      files.map((file) => file.path),
      context?.signal,
    );
    if (context) this.assertOperationActive(context);
    const requiredUrls = this.requireTransferUrls(files, downloadUrls, 'download');

    for (const file of files) {
      try {
        if (context) this.assertOperationActive(context);
        const downloadUrl = requiredUrls.get(file.path);
        if (!downloadUrl) {
          throw new Error('Missing download URL for requested sync path');
        }
        await resolveSafeSyncPath(this.basePath, file.path, enabledRoots);
        if (context) this.assertOperationActive(context);
        const content = await this.client.downloadFile(
          downloadUrl,
          this.authToken,
          context?.signal,
        );
        if (context) this.assertOperationActive(context);
        let localPath = await resolveSafeSyncPath(this.basePath, file.path, enabledRoots);
        if (context) this.assertOperationActive(context);

        if (file.path === 'config.json') {
          const config = JSON.parse(content.toString('utf8')) as unknown;
          const localConfig = await fs.readJson(localPath).catch(() => null) as unknown;
          if (context) this.assertOperationActive(context);
          const decrypted = decryptConfig(
            isJsonObject(config) ? config : {},
            this.authToken,
          );
          const merged = mergeDownloadedConfig(
            decrypted,
            isJsonObject(localConfig) ? localConfig : null,
          );
          await fs.ensureDir(path.dirname(localPath));
          if (context) this.assertOperationActive(context);
          localPath = await resolveSafeSyncPath(this.basePath, file.path, enabledRoots);
          if (context) this.assertOperationActive(context);
          await atomicWriteJson(localPath, merged, {
            beforeCommit: context
              ? () => this.assertOperationActive(context)
              : undefined,
          });
        } else if (file.path === SESSION_INDEX_SYNC_PATH) {
          const parsedIndex = this.parseDownloadedSessionIndex(content);
          const lockPath = path.join(this.basePath, SESSION_INDEX_LOCK_PATH);
          await withFileLock(lockPath, async () => {
            if (context) this.assertOperationActive(context);
            localPath = await resolveSafeSyncPath(this.basePath, file.path, enabledRoots);
            if (context) this.assertOperationActive(context);
            await atomicWriteJson(localPath, parsedIndex, {
              beforeCommit: context
                ? () => this.assertOperationActive(context)
                : undefined,
            });
          }, SESSION_INDEX_LOCK_OPTIONS);
        } else {
          await fs.ensureDir(path.dirname(localPath));
          if (context) this.assertOperationActive(context);
          localPath = await resolveSafeSyncPath(this.basePath, file.path, enabledRoots);
          if (context) this.assertOperationActive(context);
          await atomicWriteFile(localPath, content, {
            beforeCommit: context
              ? () => this.assertOperationActive(context)
              : undefined,
          });
        }

        if (context) this.assertOperationActive(context);
        onDownloaded(file);
        if (emitEvents) {
          if (context) {
            this.emitOperationEvent(context, {
              type: 'file_downloaded',
              path: file.path,
              size: content.length,
            });
          } else {
            this.emitEventSafely({ type: 'file_downloaded', path: file.path, size: content.length });
          }
          if (conflictPaths.has(file.path)) {
            const event: SyncEvent = {
              type: 'conflict_resolved',
              path: file.path,
              strategy: 'cloud_wins',
            };
            if (context) this.emitOperationEvent(context, event);
            else this.emitEventSafely(event);
          }
        }
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (
          emitEvents
          && !this.isAuthError(errorMessage)
          && (!context || this.isOperationActive(context))
        ) {
          this.emitEventSafely({ type: 'download_error', path: file.path, error: errorMessage });
        }
        throw error;
      }
    }
  }

  private parseDownloadedSessionIndex(content: Buffer): unknown {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content.toString('utf8')) as unknown;
    } catch {
      throw new Error('Invalid downloaded session index: expected valid JSON');
    }
    if (!isSessionIndex(parsed)) {
      throw new Error('Invalid downloaded session index: unexpected structure');
    }
    const seenSessionIds = new Set<string>();
    for (const session of parsed.sessions) {
      if (
        !this.isSafeSessionIndexIdentifier(session.id)
        || seenSessionIds.has(session.id)
        || (
          session.branch !== undefined
          && !this.isSafeSessionIndexIdentifier(session.branch.sourceSessionId)
        )
      ) {
        throw new Error('Invalid downloaded session index: unsafe session identifier');
      }
      seenSessionIds.add(session.id);
    }
    for (const sessionIds of Object.values(parsed.byProject)) {
      if (sessionIds.some((sessionId) => !this.isSafeSessionIndexIdentifier(sessionId))) {
        throw new Error('Invalid downloaded session index: unsafe project session identifier');
      }
    }
    return parsed;
  }

  private isSafeSessionIndexIdentifier(identifier: string): boolean {
    if (identifier.includes('/')) {
      return false;
    }
    try {
      return validateSyncPath(identifier) === identifier;
    } catch {
      return false;
    }
  }

  private async uploadFiles(
    files: readonly SyncFileEntry[],
    manifest: SyncManifest,
    enabledRoots: readonly string[],
    onUploaded: (file: SyncFileEntry) => void,
    emitEvents: boolean,
    context?: SyncOperationContext,
  ): Promise<void> {
    for (const file of files) {
      await resolveSafeSyncPath(this.basePath, file.path, enabledRoots);
      if (context) this.assertOperationActive(context);
    }

    if (context) this.assertOperationActive(context);
    const { uploadUrls } = await this.client.initiateUpload(
      this.authToken,
      manifest,
      files.map((file) => file.path),
      context?.signal,
    );
    if (context) this.assertOperationActive(context);
    const requiredUrls = this.requireTransferUrls(files, uploadUrls, 'upload');

    for (const file of files) {
      try {
        if (context) this.assertOperationActive(context);
        const uploadUrl = requiredUrls.get(file.path);
        if (!uploadUrl) {
          throw new Error('Missing upload URL for requested sync path');
        }
        const localPath = await resolveSafeSyncPath(this.basePath, file.path, enabledRoots);
        if (context) this.assertOperationActive(context);
        let content: Buffer;

        if (file.path === 'config.json') {
          const config = await fs.readJson(localPath) as unknown;
          if (context) this.assertOperationActive(context);
          const syncedConfig = stripUnsyncedConfigFields(isJsonObject(config) ? config : {});
          const encrypted = encryptConfig(syncedConfig, this.authToken);
          content = Buffer.from(JSON.stringify(encrypted, null, 2), 'utf8');
        } else {
          content = await fs.readFile(localPath);
          if (context) this.assertOperationActive(context);
        }

        await this.client.uploadFile(uploadUrl, content, this.authToken, context?.signal);
        if (context) this.assertOperationActive(context);
        onUploaded(file);
        if (emitEvents) {
          const event: SyncEvent = {
            type: 'file_uploaded',
            path: file.path,
            size: content.length,
          };
          if (context) this.emitOperationEvent(context, event);
          else this.emitEventSafely(event);
        }
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (
          emitEvents
          && !this.isAuthError(errorMessage)
          && (!context || this.isOperationActive(context))
        ) {
          this.emitEventSafely({ type: 'upload_error', path: file.path, error: errorMessage });
        }
        throw error;
      }
    }

    if (context) this.assertOperationActive(context);
    const finalization = await this.client.completeUpload(
      this.authToken,
      manifest,
      context?.signal,
    );
    if (context) this.assertOperationActive(context);
    if (!finalization.success) {
      throw new Error(finalization.error || 'Upload finalization failed');
    }
  }

  private async removeLocalFiles(
    filePaths: readonly string[],
    enabledRoots: readonly string[],
    context?: SyncOperationContext,
  ): Promise<void> {
    for (const filePath of filePaths) {
      await resolveSafeSyncPath(this.basePath, filePath, enabledRoots);
      if (context) this.assertOperationActive(context);
    }
    for (const filePath of filePaths) {
      if (context) this.assertOperationActive(context);
      const localPath = await resolveSafeSyncPath(this.basePath, filePath, enabledRoots);
      if (context) this.assertOperationActive(context);
      await atomicRemoveFile(localPath, {
        beforeCommit: context
          ? () => this.assertOperationActive(context)
          : undefined,
      });
    }
  }

  /**
   * Build manifest from local ~/.autohand/ files
   */
  private async buildLocalManifest(enabledRoots?: readonly string[]): Promise<SyncManifest> {
    const files: SyncFileEntry[] = [];

    // Get list of files to sync
    const includePaths = enabledRoots || await this.getIncludePaths();

    for (const includedRoot of includePaths) {
      const relativePath = includedRoot.endsWith('/')
        ? includedRoot.slice(0, -1)
        : includedRoot;
      const fullPath = path.resolve(this.basePath, ...relativePath.split('/'));

      if (await fs.pathExists(fullPath)) {
        const stat = await fs.lstat(fullPath);

        if (stat.isSymbolicLink()) {
          continue;
        }

        if (stat.isFile() && !includedRoot.endsWith('/')) {
          const safeFullPath = await resolveSafeSyncPath(
            this.basePath,
            relativePath,
            includePaths,
          );
          const content = await this.readManifestContent(relativePath, safeFullPath);
          files.push({
            path: relativePath,
            hash: computeHash(content),
            size: content.length,
            modifiedAt: stat.mtime.toISOString(),
            encrypted: relativePath === 'config.json',
          });
        } else if (stat.isDirectory()) {
          // Recursively add files from directory
          const dirFiles = await this.getFilesInDirectory(relativePath, includePaths);
          files.push(...dirFiles);
        }
      }
    }

    const manifest: SyncManifest = {
      version: MANIFEST_VERSION,
      userId: this.userId,
      lastModified: new Date().toISOString(),
      files,
      checksum: '', // Will be set below
    };

    // Compute manifest checksum (excluding checksum field)
    manifest.checksum = computeHash(JSON.stringify({ ...manifest, checksum: '' }));
    validateSyncManifestPaths(manifest, includePaths);

    return manifest;
  }

  /**
   * Get list of paths to include in sync
   */
  private async getIncludePaths(): Promise<string[]> {
    const paths: string[] = [...SYNC_INCLUDE_DEFAULT];

    // Add consent-based paths if enabled
    if (this.config.includeTelemetry) {
      paths.push(SYNC_CONSENT_REQUIRED.telemetry);
    }
    if (this.config.includeFeedback) {
      paths.push(SYNC_CONSENT_REQUIRED.feedback);
    }

    // Filter out excluded paths
    const excludePatterns = [...SYNC_EXCLUDE_ALWAYS, ...(this.config.exclude || [])];

    return paths.filter((p) => !this.isExcluded(p, excludePatterns));
  }

  /**
   * Get all files in a directory recursively
   * Skips symlinks to prevent security issues and infinite loops
   */
  private async getFilesInDirectory(
    dirPath: string,
    enabledRoots: readonly string[],
  ): Promise<SyncFileEntry[]> {
    const files: SyncFileEntry[] = [];
    const fullDirPath = path.resolve(this.basePath, ...dirPath.split('/'));

    if (!(await fs.pathExists(fullDirPath))) {
      return files;
    }

    const entries = await fs.readdir(fullDirPath, { withFileTypes: true });
    const excludePatterns = [...SYNC_EXCLUDE_ALWAYS, ...(this.config.exclude || [])];

    for (const entry of entries) {
      const relativePath = validateSyncPath(path.posix.join(dirPath, entry.name));

      // Skip excluded files
      if (this.isExcluded(relativePath, excludePatterns)) {
        continue;
      }

      // Skip symlinks to prevent security issues and infinite loops
      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isFile()) {
        try {
          const safeFullPath = await resolveSafeSyncPath(
            this.basePath,
            relativePath,
            enabledRoots,
          );
          const stat = await fs.stat(safeFullPath);
          const content = await this.readManifestContent(relativePath, safeFullPath);

          files.push({
            path: relativePath,
            hash: computeHash(content),
            size: content.length,
            modifiedAt: stat.mtime.toISOString(),
          });
        } catch {
          // Skip files that can't be read (permissions, etc.)
          continue;
        }
      } else if (entry.isDirectory()) {
        // Recurse into subdirectory
        const subFiles = await this.getFilesInDirectory(relativePath, enabledRoots);
        files.push(...subFiles);
      }
    }

    return files;
  }

  private async readManifestContent(relativePath: string, fullPath: string): Promise<Buffer> {
    if (relativePath !== 'config.json') {
      return fs.readFile(fullPath);
    }

    const config = await fs.readJson(fullPath).catch(() => null) as unknown;
    const syncedConfig = stripUnsyncedConfigFields(isJsonObject(config) ? config : {});
    return Buffer.from(JSON.stringify(syncedConfig, null, 2), 'utf8');
  }

  /**
   * Check if a path matches any exclude pattern
   */
  private isExcluded(filePath: string, patterns: readonly string[]): boolean {
    for (const pattern of patterns) {
      // Simple glob matching (supports * wildcard)
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        if (regex.test(filePath) || regex.test(path.basename(filePath))) {
          return true;
        }
      } else if (filePath === pattern || filePath.startsWith(pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Compare local and remote manifests to determine sync actions
   */
  private compareManifests(local: SyncManifest, remote: SyncManifest | null): SyncActions {
    const actions: SyncActions = {
      uploads: [],
      downloads: [],
      conflicts: [],
      localDeletes: [],
      remoteDeletes: [],
    };

    if (!remote) {
      // No remote data - upload everything
      actions.uploads = [...local.files];
      return actions;
    }

    // Create maps for efficient lookup
    const localFiles = new Map(local.files.map((f) => [f.path, f]));
    const remoteFiles = new Map(remote.files.map((f) => [f.path, f]));

    // Check each local file
    for (const [filePath, localFile] of localFiles) {
      const remoteFile = remoteFiles.get(filePath);

      if (!remoteFile) {
        // File exists locally but not remotely - upload it
        actions.uploads.push(localFile);
      } else if (localFile.hash !== remoteFile.hash) {
        if (isRemoteNewer(localFile, remoteFile)) {
          actions.conflicts.push(remoteFile);
        } else {
          actions.uploads.push(localFile);
        }
      }
      // If hashes match, no action needed
    }

    // Check for files that exist remotely but not locally
    for (const [filePath, remoteFile] of remoteFiles) {
      if (!localFiles.has(filePath)) {
        // File exists remotely but not locally - download it
        actions.downloads.push(remoteFile);
      }
    }

    return actions;
  }

  /**
   * Force a full sync (re-download everything from cloud)
   */
  async forceDownload(): Promise<SyncResult> {
    return this.runOperation((context) => this.performForceDownload(context));
  }

  private async performForceDownload(context: SyncOperationContext): Promise<SyncResult> {
    const startTime = Date.now();
    try {
      const enabledRoots = await this.getIncludePaths();
      this.assertOperationActive(context);
      const remoteManifest = await this.client.getRemoteManifest(
        this.authToken,
        context.signal,
      );
      this.assertOperationActive(context);

      if (!remoteManifest) {
        return {
          success: false,
          uploaded: 0,
          downloaded: 0,
          conflicts: 0,
          error: 'No remote data to download',
        };
      }

      await this.validateManifestDestinations(remoteManifest, enabledRoots);
      this.assertOperationActive(context);
      return this.forceDownloadFiles(remoteManifest.files, enabledRoots, context);
    } catch (error) {
      if (this.isStoppedError(error) || !this.isOperationActive(context)) {
        return this.stoppedResult();
      }
      return {
        success: false,
        uploaded: 0,
        downloaded: 0,
        conflicts: 0,
        error: (error as Error).message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Force download a subset of cloud files by path.
   */
  async forceDownloadPaths(paths: string[]): Promise<SyncResult> {
    return this.runOperation((context) => this.performForceDownloadPaths(paths, context));
  }

  private async performForceDownloadPaths(
    paths: string[],
    context: SyncOperationContext,
  ): Promise<SyncResult> {
    const startTime = Date.now();
    try {
      const enabledRoots = await this.getIncludePaths();
      this.assertOperationActive(context);
      const remoteManifest = await this.client.getRemoteManifest(
        this.authToken,
        context.signal,
      );
      this.assertOperationActive(context);

      if (!remoteManifest) {
        return {
          success: false,
          uploaded: 0,
          downloaded: 0,
          conflicts: 0,
          error: 'No remote data to download',
        };
      }

      await this.validateManifestDestinations(remoteManifest, enabledRoots);
      this.assertOperationActive(context);
      for (const requestedPath of paths) {
        await resolveSafeSyncPath(this.basePath, requestedPath, enabledRoots);
        this.assertOperationActive(context);
      }

      const requestedPaths = new Set(paths);
      const files = remoteManifest.files.filter((file) => requestedPaths.has(file.path));
      return this.forceDownloadFiles(files, enabledRoots, context);
    } catch (error) {
      if (this.isStoppedError(error) || !this.isOperationActive(context)) {
        return this.stoppedResult();
      }
      return {
        success: false,
        uploaded: 0,
        downloaded: 0,
        conflicts: 0,
        error: (error as Error).message,
        duration: Date.now() - startTime,
      };
    }
  }

  private async forceDownloadFiles(
    files: SyncFileEntry[],
    enabledRoots: readonly string[],
    context: SyncOperationContext,
  ): Promise<SyncResult> {
    if (files.length === 0) {
      return {
        success: true,
        uploaded: 0,
        downloaded: 0,
        conflicts: 0,
      };
    }

    const actions: SyncActions = {
      uploads: [],
      downloads: files,
      conflicts: [],
      localDeletes: [],
      remoteDeletes: [],
    };

    return this.performSyncActions(actions, {
      version: MANIFEST_VERSION,
      userId: this.userId,
      lastModified: new Date().toISOString(),
      files,
      checksum: computeHash(JSON.stringify(files)),
    }, enabledRoots, context);
  }

  /**
   * Force a full upload (overwrite cloud with local)
   */
  async forceUpload(): Promise<SyncResult> {
    return this.runOperation((context) => this.performForceUpload(context));
  }

  private async performForceUpload(context: SyncOperationContext): Promise<SyncResult> {
    const startTime = Date.now();
    try {
      const enabledRoots = await this.getIncludePaths();
      this.assertOperationActive(context);
      const localManifest = await this.buildLocalManifest(enabledRoots);
      this.assertOperationActive(context);

      // Treat all local files as uploads
      const actions: SyncActions = {
        uploads: localManifest.files,
        downloads: [],
        conflicts: [],
        localDeletes: [],
        remoteDeletes: [],
      };

      return this.performSyncActions(actions, localManifest, enabledRoots, context);
    } catch (error) {
      if (this.isStoppedError(error) || !this.isOperationActive(context)) {
        return this.stoppedResult();
      }
      return {
        success: false,
        uploaded: 0,
        downloaded: 0,
        conflicts: 0,
        error: (error as Error).message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Helper to perform sync actions
   */
  private async performSyncActions(
    actions: SyncActions,
    manifest: SyncManifest,
    enabledRoots: readonly string[],
    context?: SyncOperationContext,
  ): Promise<SyncResult> {
    const startTime = Date.now();
    let uploaded = 0;
    let downloaded = 0;
    let conflicts = 0;

    try {
      if (context) this.assertOperationActive(context);
      validateSyncManifestPaths(manifest, enabledRoots);

      // Downloads
      const toDownload = [...actions.downloads, ...actions.conflicts];
      if (toDownload.length > 0) {
        const conflictPaths = new Set(actions.conflicts.map((file) => file.path));
        await this.downloadFiles(toDownload, enabledRoots, (file) => {
          downloaded++;
          if (conflictPaths.has(file.path)) {
            conflicts++;
          }
        }, false, conflictPaths, context);
        if (context) this.assertOperationActive(context);
      }

      await this.removeLocalFiles(actions.localDeletes, enabledRoots, context);
      if (context) this.assertOperationActive(context);

      // Uploads
      if (actions.uploads.length > 0) {
        await this.uploadFiles(actions.uploads, manifest, enabledRoots, () => {
          uploaded++;
        }, false, context);
        if (context) this.assertOperationActive(context);
      }

      return {
        success: true,
        uploaded,
        downloaded,
        conflicts,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      if (
        context
        && (this.isStoppedError(error) || !this.isOperationActive(context))
      ) {
        return this.stoppedResult(downloaded, uploaded, conflicts);
      }
      return {
        success: false,
        uploaded,
        downloaded,
        conflicts,
        error: (error as Error).message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Get current sync status
   */
  async getStatus(): Promise<{
    enabled: boolean;
    lastSync: string | null;
    syncing: boolean;
    fileCount: number;
    totalSize: number;
  }> {
    const stateFile = path.join(this.basePath, SYNC_STATE_FILE);
    let lastSync: string | null = null;

    if (await fs.pathExists(stateFile)) {
      const state: SyncState = await fs.readJson(stateFile).catch(() => ({}));
      lastSync = state.lastSync || null;
    }

    const manifest = await this.buildLocalManifest();
    const totalSize = manifest.files.reduce((sum, f) => sum + f.size, 0);

    return {
      enabled: this.config.enabled,
      lastSync,
      syncing: this.syncing,
      fileCount: manifest.files.length,
      totalSize,
    };
  }
}

// Factory function
export function createSyncService(options: SyncServiceOptions): SyncService {
  return new SyncService(options);
}
