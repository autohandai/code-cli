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
const MAX_TOTAL_SIZE = 100 * 1024 * 1024; // 100MB default

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
    if (this.started) return;
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
  }

  /**
   * Stop the background sync timer
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.started = false;
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
    // Prevent concurrent syncs
    if (this.syncing) {
      return {
        success: false,
        uploaded: 0,
        downloaded: 0,
        conflicts: 0,
        error: 'Sync already in progress',
      };
    }

    // Check for lock file
    const lockPath = path.join(this.basePath, SYNC_LOCK_FILE);
    if (await fs.pathExists(lockPath)) {
      const lockContent = await fs.readFile(lockPath, 'utf8').catch(() => '');
      const lockAge = Date.now() - parseInt(lockContent, 10);
      // If lock is older than 5 minutes, remove it (stale lock)
      if (lockAge < 5 * 60 * 1000) {
        return {
          success: false,
          uploaded: 0,
          downloaded: 0,
          conflicts: 0,
          error: 'Sync locked by another process',
        };
      }
      await fs.remove(lockPath);
    }

    this.syncing = true;
    const startTime = Date.now();

    // Create lock file
    await fs.writeFile(lockPath, Date.now().toString());

    this.onEvent({ type: 'sync_started' });

    try {
      // 1. Build local manifest
      const localManifest = await this.buildLocalManifest();

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
      const remoteManifest = await this.client.getRemoteManifest(this.authToken);

      // 3. Compare and determine actions
      const actions = this.compareManifests(localManifest, remoteManifest);

      let downloaded = 0;
      let uploaded = 0;
      let conflicts = 0;

      // 4. Cloud wins on conflict - download remote changes first
      if (actions.downloads.length > 0 || actions.conflicts.length > 0) {
        const toDownload = [...actions.downloads, ...actions.conflicts];
        conflicts = actions.conflicts.length;

        // Get download URLs
        const { downloadUrls } = await this.client.initiateDownload(
          this.authToken,
          toDownload.map((f) => f.path)
        );

        // Download each file
        for (const file of toDownload) {
          const url = downloadUrls[file.path];
          if (!url) continue;

          try {
            const content = await this.client.downloadFile(url);
            const localPath = path.join(this.basePath, file.path);

            // Handle config.json specially - decrypt API keys
            if (file.path === 'config.json') {
              const config = JSON.parse(content.toString('utf8'));
              const decrypted = decryptConfig(config, this.authToken);
              await fs.ensureDir(path.dirname(localPath));
              await fs.writeJson(localPath, decrypted, { spaces: 2 });
            } else {
              await fs.ensureDir(path.dirname(localPath));
              await fs.writeFile(localPath, content);
            }

            downloaded++;
            this.onEvent({ type: 'file_downloaded', path: file.path, size: content.length });

            if (actions.conflicts.includes(file)) {
              this.onEvent({ type: 'conflict_resolved', path: file.path, strategy: 'cloud_wins' });
            }
          } catch (error) {
            const errorMsg = (error as Error).message;
            // Auth error - stop trying, will be handled by caller
            if (this.isAuthError(errorMsg)) {
              throw error;
            }
            // Only emit event for non-auth errors (avoid console spam)
            this.onEvent({ type: 'download_error', path: file.path, error: errorMsg });
          }
        }

        // Handle local deletes (files removed from remote)
        for (const filePath of actions.localDeletes) {
          const localPath = path.join(this.basePath, filePath);
          await fs.remove(localPath).catch(() => {});
        }
      }

      // 5. Upload local changes
      if (actions.uploads.length > 0) {
        // Get upload URLs
        const { uploadUrls } = await this.client.initiateUpload(
          this.authToken,
          localManifest,
          actions.uploads.map((f) => f.path)
        );

        // Upload each file
        for (const file of actions.uploads) {
          const url = uploadUrls[file.path];
          if (!url) continue;

          try {
            const localPath = path.join(this.basePath, file.path);
            let content: Buffer;

            // Handle config.json specially - encrypt API keys
            if (file.path === 'config.json') {
              const config = await fs.readJson(localPath);
              const encrypted = encryptConfig(config, this.authToken);
              content = Buffer.from(JSON.stringify(encrypted, null, 2), 'utf8');
            } else {
              content = await fs.readFile(localPath);
            }

            await this.client.uploadFile(url, content);
            uploaded++;
            this.onEvent({ type: 'file_uploaded', path: file.path, size: content.length });
          } catch (error) {
            const errorMsg = (error as Error).message;
            // Auth error - stop trying, will be handled by caller
            if (this.isAuthError(errorMsg)) {
              throw error;
            }
            // Only emit event for non-auth errors (avoid console spam)
            this.onEvent({ type: 'upload_error', path: file.path, error: errorMsg });
          }
        }

        // Complete the upload
        await this.client.completeUpload(this.authToken, localManifest);
      }

      // 6. Save sync state
      const stateFile = path.join(this.basePath, SYNC_STATE_FILE);
      const state: SyncState = {
        lastSync: new Date().toISOString(),
        lastManifestHash: computeHash(JSON.stringify(localManifest)),
      };
      await fs.writeJson(stateFile, state, { spaces: 2 });

      const result: SyncResult = {
        success: true,
        uploaded,
        downloaded,
        conflicts,
        duration: Date.now() - startTime,
      };

      this.onEvent({ type: 'sync_completed', result });
      return result;
    } catch (error) {
      const errorMessage = (error as Error).message;

      // Check for authentication errors (401)
      if (this.isAuthError(errorMessage)) {
        this.handleAuthFailure(errorMessage);
        return {
          success: false,
          uploaded: 0,
          downloaded: 0,
          conflicts: 0,
          error: 'Authentication expired. Please run /login again.',
          duration: Date.now() - startTime,
        };
      }

      this.onEvent({ type: 'sync_failed', error: errorMessage });

      return {
        success: false,
        uploaded: 0,
        downloaded: 0,
        conflicts: 0,
        error: errorMessage,
        duration: Date.now() - startTime,
      };
    } finally {
      this.syncing = false;
      // Remove lock file
      await fs.remove(lockPath).catch(() => {});
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
    this.onEvent({ type: 'auth_failure', error: errorMessage });
    this.onAuthFailure?.();
  }

  /**
   * Build manifest from local ~/.autohand/ files
   */
  private async buildLocalManifest(): Promise<SyncManifest> {
    const files: SyncFileEntry[] = [];

    // Get list of files to sync
    const includePaths = await this.getIncludePaths();

    for (const relativePath of includePaths) {
      const fullPath = path.join(this.basePath, relativePath);

      if (await fs.pathExists(fullPath)) {
        const stat = await fs.stat(fullPath);

        if (stat.isFile()) {
          const content = await fs.readFile(fullPath);
          files.push({
            path: relativePath,
            hash: computeHash(content),
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
            encrypted: relativePath === 'config.json',
          });
        } else if (stat.isDirectory()) {
          // Recursively add files from directory
          const dirFiles = await this.getFilesInDirectory(relativePath);
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
  private async getFilesInDirectory(dirPath: string): Promise<SyncFileEntry[]> {
    const files: SyncFileEntry[] = [];
    const fullDirPath = path.join(this.basePath, dirPath);

    if (!(await fs.pathExists(fullDirPath))) {
      return files;
    }

    const entries = await fs.readdir(fullDirPath, { withFileTypes: true });
    const excludePatterns = [...SYNC_EXCLUDE_ALWAYS, ...(this.config.exclude || [])];

    for (const entry of entries) {
      const relativePath = path.join(dirPath, entry.name);
      const fullPath = path.join(this.basePath, relativePath);

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
          const stat = await fs.stat(fullPath);
          const content = await fs.readFile(fullPath);

          files.push({
            path: relativePath,
            hash: computeHash(content),
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          });
        } catch {
          // Skip files that can't be read (permissions, etc.)
          continue;
        }
      } else if (entry.isDirectory()) {
        // Recurse into subdirectory
        const subFiles = await this.getFilesInDirectory(relativePath);
        files.push(...subFiles);
      }
    }

    return files;
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
        // File exists in both but different - conflict (cloud wins)
        actions.conflicts.push(remoteFile);
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
    const remoteManifest = await this.client.getRemoteManifest(this.authToken);

    if (!remoteManifest) {
      return {
        success: false,
        uploaded: 0,
        downloaded: 0,
        conflicts: 0,
        error: 'No remote data to download',
      };
    }

    // Treat all remote files as downloads
    const actions: SyncActions = {
      uploads: [],
      downloads: remoteManifest.files,
      conflicts: [],
      localDeletes: [],
      remoteDeletes: [],
    };

    // Perform sync with these actions
    return this.performSyncActions(actions, remoteManifest);
  }

  /**
   * Force a full upload (overwrite cloud with local)
   */
  async forceUpload(): Promise<SyncResult> {
    const localManifest = await this.buildLocalManifest();

    // Treat all local files as uploads
    const actions: SyncActions = {
      uploads: localManifest.files,
      downloads: [],
      conflicts: [],
      localDeletes: [],
      remoteDeletes: [],
    };

    return this.performSyncActions(actions, localManifest);
  }

  /**
   * Helper to perform sync actions
   */
  private async performSyncActions(actions: SyncActions, manifest: SyncManifest): Promise<SyncResult> {
    const startTime = Date.now();
    let uploaded = 0;
    let downloaded = 0;

    try {
      // Downloads
      if (actions.downloads.length > 0) {
        const { downloadUrls } = await this.client.initiateDownload(
          this.authToken,
          actions.downloads.map((f) => f.path)
        );

        for (const file of actions.downloads) {
          const url = downloadUrls[file.path];
          if (!url) continue;

          try {
            const content = await this.client.downloadFile(url);
            const localPath = path.join(this.basePath, file.path);

            if (file.path === 'config.json') {
              const config = JSON.parse(content.toString('utf8'));
              const decrypted = decryptConfig(config, this.authToken);
              await fs.ensureDir(path.dirname(localPath));
              await fs.writeJson(localPath, decrypted, { spaces: 2 });
            } else {
              await fs.ensureDir(path.dirname(localPath));
              await fs.writeFile(localPath, content);
            }
            downloaded++;
          } catch {
            // Continue with other files
          }
        }
      }

      // Uploads
      if (actions.uploads.length > 0) {
        const { uploadUrls } = await this.client.initiateUpload(
          this.authToken,
          manifest,
          actions.uploads.map((f) => f.path)
        );

        for (const file of actions.uploads) {
          const url = uploadUrls[file.path];
          if (!url) continue;

          try {
            const localPath = path.join(this.basePath, file.path);
            let content: Buffer;

            if (file.path === 'config.json') {
              const config = await fs.readJson(localPath);
              const encrypted = encryptConfig(config, this.authToken);
              content = Buffer.from(JSON.stringify(encrypted, null, 2), 'utf8');
            } else {
              content = await fs.readFile(localPath);
            }

            await this.client.uploadFile(url, content);
            uploaded++;
          } catch {
            // Continue with other files
          }
        }

        await this.client.completeUpload(this.authToken, manifest);
      }

      return {
        success: true,
        uploaded,
        downloaded,
        conflicts: 0,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        uploaded,
        downloaded,
        conflicts: 0,
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
