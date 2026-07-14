/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import { promises as nodeFs } from 'node:fs';
import path from 'path';
import os from 'os';
import { SyncService, createSyncService } from '../../src/sync/SyncService.js';
import { SyncApiClient } from '../../src/sync/SyncApiClient.js';
import { computeHash, encrypt, isEncrypted } from '../../src/sync/encryption.js';
import type { SyncEvent, SyncManifest } from '../../src/sync/types.js';
import { acquireFileLock } from '../../src/utils/atomicFile.js';

// Mock the constants module
vi.mock('../../src/constants.js', () => ({
  AUTOHAND_HOME: '/tmp/autohand-test',
}));

describe('SyncService', () => {
  let tempDir: string;
  let mockApiClient: SyncApiClient;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    tempDir = path.join(os.tmpdir(), `sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.ensureDir(tempDir);

    // Create mock API client
    mockApiClient = {
      getRemoteManifest: vi.fn(),
      initiateUpload: vi.fn(),
      uploadFile: vi.fn(),
      completeUpload: vi.fn(),
      initiateDownload: vi.fn(),
      downloadFile: vi.fn(),
      deleteSyncData: vi.fn(),
      healthCheck: vi.fn(),
      limits: { maxFileSize: 10 * 1024 * 1024, maxTotalSize: 100 * 1024 * 1024 },
    } as unknown as SyncApiClient;
  });

  afterEach(async () => {
    // Cleanup temp directory
    try {
      await fs.remove(tempDir);
    } catch {
      // Ignore cleanup errors
    }
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('createSyncService', () => {
    it('creates a sync service with required options', () => {
      const service = createSyncService({
        authToken: 'test-token',
        userId: 'test-user',
        config: {
          enabled: true,
          interval: 300000,
        },
        apiClient: mockApiClient,
      });

      expect(service).toBeInstanceOf(SyncService);
      expect(service.isRunning).toBe(false);
    });
  });

  describe('start/stop', () => {
    it('starts the sync service', () => {
      const service = createSyncService({
        authToken: 'test-token',
        userId: 'test-user',
        config: {
          enabled: true,
          interval: 60000, // 1 minute for testing
        },
        apiClient: mockApiClient,
      });

      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      service.start();
      expect(service.isRunning).toBe(true);

      service.stop();
      expect(service.isRunning).toBe(false);
    });

    it('does not start twice', () => {
      const service = createSyncService({
        authToken: 'test-token',
        userId: 'test-user',
        config: {
          enabled: true,
          interval: 60000,
        },
        apiClient: mockApiClient,
      });

      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      service.start();
      service.start(); // Second call should be ignored
      expect(service.isRunning).toBe(true);

      service.stop();
    });

    it('makes stop terminal and suppresses late initial-sync state and events', async () => {
      await fs.writeJson(path.join(tempDir, 'config.json'), { provider: 'openrouter' });
      const previousState = {
        lastSync: '2026-01-01T00:00:00.000Z',
        lastManifestHash: 'previous-manifest',
      };
      await fs.writeJson(path.join(tempDir, '.sync-state.json'), previousState);
      let resolveManifest: ((manifest: SyncManifest | null) => void) | undefined;
      const manifestPending = new Promise<SyncManifest | null>((resolve) => {
        resolveManifest = resolve;
      });
      const events: SyncEvent[] = [];
      const service = createSyncService({
        authToken: 'test-token',
        userId: 'test-user',
        config: {
          enabled: true,
          interval: 60000,
        },
        apiClient: mockApiClient,
        onEvent: (event) => events.push(event),
      });
      (service as unknown as { basePath: string }).basePath = tempDir;
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>)
        .mockImplementation((_token: string, signal?: AbortSignal) => {
          expect(signal).toBeInstanceOf(AbortSignal);
          return manifestPending;
        });

      service.start();
      await vi.waitFor(() => {
        expect(mockApiClient.getRemoteManifest).toHaveBeenCalledOnce();
      });

      const timer = (service as unknown as { timer: NodeJS.Timeout }).timer;
      expect(timer.hasRef()).toBe(false);

      service.stop();
      const signal = (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>)
        .mock.calls[0]?.[1] as AbortSignal;
      expect(signal.aborted).toBe(true);
      resolveManifest?.(null);
      await service.shutdown({ timeoutMs: 100 });

      expect(service.isRunning).toBe(false);
      expect(await fs.readJson(path.join(tempDir, '.sync-state.json'))).toEqual(previousState);
      expect(mockApiClient.initiateUpload).not.toHaveBeenCalled();
      expect(events.map((event) => event.type)).toEqual(['sync_started']);

      service.start();
      expect(service.isRunning).toBe(false);
      expect(mockApiClient.getRemoteManifest).toHaveBeenCalledOnce();
      await expect(service.sync()).resolves.toMatchObject({
        success: false,
        error: expect.stringMatching(/stopped/i),
      });
    });

    it.each([
      {
        label: 'config',
        remotePath: 'config.json',
        content: Buffer.from(JSON.stringify({ provider: 'anthropic' })),
        initialContent: JSON.stringify({ provider: 'openrouter' }),
      },
      {
        label: 'general file',
        remotePath: 'memory/late.json',
        content: Buffer.from('{"late":true}'),
        initialContent: null,
      },
      {
        label: 'session index',
        remotePath: 'sessions/index.json',
        content: Buffer.from(JSON.stringify({ sessions: [], byProject: {} })),
        initialContent: null,
      },
    ])('does not commit a staged $label download after stop', async ({
      remotePath,
      content,
      initialContent,
    }) => {
      const targetPath = path.join(tempDir, ...remotePath.split('/'));
      if (initialContent !== null) {
        await fs.ensureDir(path.dirname(targetPath));
        await fs.writeFile(targetPath, initialContent);
      }
      const previousState = {
        lastSync: '2026-01-01T00:00:00.000Z',
        lastManifestHash: 'previous-manifest',
      };
      await fs.writeJson(path.join(tempDir, '.sync-state.json'), previousState);

      let reachedStagedWrite!: () => void;
      const stagedWrite = new Promise<void>((resolve) => {
        reachedStagedWrite = resolve;
      });
      let releaseStagedWrite!: () => void;
      const stagedWriteRelease = new Promise<void>((resolve) => {
        releaseStagedWrite = resolve;
      });
      const originalOpen = nodeFs.open.bind(nodeFs);
      let heldTemporaryWrite = false;
      vi.spyOn(nodeFs, 'open').mockImplementation(async (filePath, flags, mode) => {
        const handle = await originalOpen(filePath, flags, mode);
        if (!heldTemporaryWrite && String(filePath).endsWith('.tmp')) {
          heldTemporaryWrite = true;
          const sync = handle.sync.bind(handle);
          handle.sync = async () => {
            reachedStagedWrite();
            await stagedWriteRelease;
            await sync();
          };
        }
        return handle;
      });

      const events: SyncEvent[] = [];
      const service = createSyncService({
        authToken: 'test-token',
        userId: 'test-user',
        config: { enabled: true, interval: 60000 },
        apiClient: mockApiClient,
        onEvent: (event) => events.push(event),
      });
      (service as unknown as { basePath: string }).basePath = tempDir;
      const remoteManifest: SyncManifest = {
        version: 1,
        userId: 'test-user',
        lastModified: '2099-01-01T00:00:00.000Z',
        files: [{
          path: remotePath,
          hash: computeHash(content),
          size: content.length,
          modifiedAt: '2099-01-01T00:00:00.000Z',
        }],
        checksum: 'remote-checksum',
      };
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(remoteManifest);
      (mockApiClient.initiateDownload as ReturnType<typeof vi.fn>).mockResolvedValue({
        downloadUrls: { [remotePath]: 'https://storage.example/late' },
      });
      (mockApiClient.downloadFile as ReturnType<typeof vi.fn>).mockResolvedValue(content);

      const operation = service.sync();
      await stagedWrite;
      service.stop();
      releaseStagedWrite();
      const result = await operation;

      expect(result).toMatchObject({ success: false, error: expect.stringMatching(/stopped/i) });
      if (initialContent === null) {
        expect(await fs.pathExists(targetPath)).toBe(false);
      } else {
        expect(await fs.readFile(targetPath, 'utf8')).toBe(initialContent);
      }
      expect(await fs.readJson(path.join(tempDir, '.sync-state.json'))).toEqual(previousState);
      expect(events.map((event) => event.type)).toEqual(['sync_started']);
      expect((await fs.readdir(path.dirname(targetPath)))
        .filter((entry) => entry.endsWith('.tmp') || entry.endsWith('.tombstone')))
        .toEqual([]);
    });
  });

  describe('sync', () => {
    it('uploads files when no remote data exists', async () => {
      // Create test files
      await fs.ensureDir(path.join(tempDir, 'agents'));
      await fs.writeJson(path.join(tempDir, 'config.json'), {
        provider: 'openrouter',
        openrouter: { apiKey: 'sk-test-key' },
      });
      await fs.writeFile(path.join(tempDir, 'agents', 'test.json'), '{}');

      const service = new SyncService({
        authToken: 'test-token',
        userId: 'test-user',
        config: {
          enabled: true,
          interval: 300000,
        },
        apiClient: mockApiClient,
      });

      // Override basePath for testing
      (service as any).basePath = tempDir;

      // Mock API responses
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockApiClient.initiateUpload as ReturnType<typeof vi.fn>).mockResolvedValue({
        uploadUrls: {
          'config.json': 'https://example.com/upload/config.json',
          'agents/test.json': 'https://example.com/upload/agents/test.json',
        },
      });
      (mockApiClient.uploadFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (mockApiClient.completeUpload as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        uploaded: 2,
        downloaded: 0,
        conflicts: 0,
      });

      const result = await service.sync();

      expect(result.success).toBe(true);
      expect(mockApiClient.initiateUpload).toHaveBeenCalled();
      expect(mockApiClient.uploadFile).toHaveBeenCalledWith(
        'https://example.com/upload/config.json',
        expect.any(Buffer),
        'test-token',
        expect.any(AbortSignal),
      );
    });

    it('builds config manifest hashes without local auth fields', async () => {
      await fs.writeJson(path.join(tempDir, 'config.json'), {
        auth: {
          token: 'local-token',
          user: { id: 'user-1', email: 'local@example.com' },
        },
        provider: 'openrouter',
      });

      const service = new SyncService({
        authToken: 'test-token',
        userId: 'test-user',
        config: {
          enabled: true,
          interval: 300000,
        },
        apiClient: mockApiClient,
      });

      (service as any).basePath = tempDir;

      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockApiClient.initiateUpload as ReturnType<typeof vi.fn>).mockResolvedValue({
        uploadUrls: {
          'config.json': 'https://example.com/upload/config.json',
        },
      });
      (mockApiClient.uploadFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (mockApiClient.completeUpload as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        uploaded: 1,
        downloaded: 0,
        conflicts: 0,
      });

      await service.sync();

      const manifest = (mockApiClient.initiateUpload as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as SyncManifest;
      const configEntry = manifest.files.find((file) => file.path === 'config.json');
      expect(configEntry?.hash).toBe(computeHash(Buffer.from(JSON.stringify({ provider: 'openrouter' }, null, 2), 'utf8')));
    });

    it('downloads files when remote has newer data', async () => {
      await fs.ensureDir(tempDir);

      const remoteManifest: SyncManifest = {
        version: 1,
        userId: 'test-user',
        lastModified: new Date().toISOString(),
        files: [
          {
            path: 'config.json',
            hash: 'remote-hash',
            size: 100,
            modifiedAt: new Date().toISOString(),
            encrypted: true,
          },
        ],
        checksum: 'test-checksum',
      };

      const service = new SyncService({
        authToken: 'test-token',
        userId: 'test-user',
        config: {
          enabled: true,
          interval: 300000,
        },
        apiClient: mockApiClient,
      });

      (service as any).basePath = tempDir;

      // Mock API responses
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(remoteManifest);
      (mockApiClient.initiateDownload as ReturnType<typeof vi.fn>).mockResolvedValue({
        downloadUrls: {
          'config.json': 'https://example.com/download/config.json',
        },
      });
      (mockApiClient.downloadFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        Buffer.from(JSON.stringify({ provider: 'openrouter' }))
      );

      const result = await service.sync();

      expect(result.success).toBe(true);
      expect(result.downloaded).toBe(1);
      expect(mockApiClient.initiateDownload).toHaveBeenCalled();
      expect(mockApiClient.downloadFile).toHaveBeenCalledWith(
        'https://example.com/download/config.json',
        'test-token',
        expect.any(AbortSignal),
      );
    });

    it('preserves local auth and never writes synced auth from config downloads', async () => {
      await fs.writeJson(path.join(tempDir, 'config.json'), {
        auth: {
          token: 'fresh-local-token',
          user: { id: 'user-1', email: 'local@example.com' },
        },
        provider: 'openrouter',
      });

      const remoteManifest: SyncManifest = {
        version: 1,
        userId: 'test-user',
        lastModified: new Date().toISOString(),
        files: [
          {
            path: 'config.json',
            hash: 'remote-hash',
            size: 100,
            modifiedAt: new Date(Date.now() + 1000).toISOString(),
            encrypted: true,
          },
        ],
        checksum: 'test-checksum',
      };

      const service = new SyncService({
        authToken: 'test-token',
        userId: 'test-user',
        config: {
          enabled: true,
          interval: 300000,
        },
        apiClient: mockApiClient,
      });

      (service as any).basePath = tempDir;

      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(remoteManifest);
      (mockApiClient.initiateDownload as ReturnType<typeof vi.fn>).mockResolvedValue({
        downloadUrls: {
          'config.json': 'https://example.com/download/config.json',
        },
      });
      (mockApiClient.downloadFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        Buffer.from(JSON.stringify({
          auth: {
            token: encrypt('stale-remote-token', 'old-token-value'),
            user: { id: 'user-1', email: 'remote@example.com' },
          },
          provider: 'ollama',
        }))
      );

      const result = await service.sync();
      const config = await fs.readJson(path.join(tempDir, 'config.json'));

      expect(result.success).toBe(true);
      expect(config.provider).toBe('ollama');
      expect(config.auth.token).toBe('fresh-local-token');
      expect(config.auth.user.email).toBe('local@example.com');
      expect(isEncrypted(config.auth.token)).toBe(false);
    });

    it('uploads locally newer config conflicts instead of letting stale cloud config win', async () => {
      const localModifiedAt = new Date('2026-06-12T12:00:00.000Z');
      const remoteModifiedAt = new Date('2026-06-12T11:00:00.000Z');
      const configPath = path.join(tempDir, 'config.json');
      await fs.writeJson(configPath, {
        provider: 'openrouter',
        auth: {
          token: 'fresh-local-token',
          user: { id: 'user-1', email: 'local@example.com' },
        },
      });
      await fs.utimes(configPath, localModifiedAt, localModifiedAt);

      const remoteManifest: SyncManifest = {
        version: 1,
        userId: 'test-user',
        lastModified: remoteModifiedAt.toISOString(),
        files: [
          {
            path: 'config.json',
            hash: 'remote-hash',
            size: 100,
            modifiedAt: remoteModifiedAt.toISOString(),
            encrypted: true,
          },
        ],
        checksum: 'test-checksum',
      };

      const service = new SyncService({
        authToken: 'test-token',
        userId: 'test-user',
        config: {
          enabled: true,
          interval: 300000,
        },
        apiClient: mockApiClient,
      });

      (service as any).basePath = tempDir;

      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(remoteManifest);
      (mockApiClient.initiateUpload as ReturnType<typeof vi.fn>).mockResolvedValue({
        uploadUrls: {
          'config.json': 'https://example.com/upload/config.json',
        },
      });
      (mockApiClient.uploadFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (mockApiClient.completeUpload as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        uploaded: 1,
        downloaded: 0,
        conflicts: 0,
      });

      const result = await service.sync();

      expect(result.success).toBe(true);
      expect(result.uploaded).toBe(1);
      expect(result.downloaded).toBe(0);
      expect(mockApiClient.initiateDownload).not.toHaveBeenCalled();
      const uploadedContent = (mockApiClient.uploadFile as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Buffer;
      const uploadedConfig = JSON.parse(uploadedContent.toString('utf8')) as Record<string, unknown>;
      expect(uploadedConfig.auth).toBeUndefined();
    });

    it('finalizes mixed uploads with a rebuilt manifest that includes cloud-wins downloads', async () => {
      const localConfigModifiedAt = new Date('2026-06-12T12:00:00.000Z');
      const localMemoryModifiedAt = new Date('2026-06-12T11:00:00.000Z');
      const configPath = path.join(tempDir, 'config.json');
      const memoryPath = path.join(tempDir, 'memory', 'preference.json');
      const downloadedMemory = Buffer.from(JSON.stringify({ preference: 'remote-current' }));
      await fs.writeJson(configPath, { provider: 'openrouter' });
      await fs.outputFile(memoryPath, JSON.stringify({ preference: 'local-stale' }));
      await fs.utimes(configPath, localConfigModifiedAt, localConfigModifiedAt);
      await fs.utimes(memoryPath, localMemoryModifiedAt, localMemoryModifiedAt);

      const remoteManifest: SyncManifest = {
        version: 1,
        userId: 'test-user',
        lastModified: '2026-06-12T13:00:00.000Z',
        files: [
          {
            path: 'config.json',
            hash: 'remote-stale-config-hash',
            size: 2,
            modifiedAt: '2026-06-12T10:00:00.000Z',
            encrypted: true,
          },
          {
            path: 'memory/preference.json',
            hash: computeHash(downloadedMemory),
            size: downloadedMemory.length,
            modifiedAt: '2026-06-12T13:00:00.000Z',
          },
        ],
        checksum: 'remote-checksum',
      };
      const service = new SyncService({
        authToken: 'test-token',
        userId: 'test-user',
        config: { enabled: true, interval: 300000 },
        apiClient: mockApiClient,
      });
      (service as unknown as { basePath: string }).basePath = tempDir;
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(remoteManifest);
      (mockApiClient.initiateDownload as ReturnType<typeof vi.fn>).mockResolvedValue({
        downloadUrls: { 'memory/preference.json': 'https://storage.example/memory' },
      });
      (mockApiClient.downloadFile as ReturnType<typeof vi.fn>).mockResolvedValue(downloadedMemory);
      (mockApiClient.initiateUpload as ReturnType<typeof vi.fn>).mockResolvedValue({
        uploadUrls: { 'config.json': 'https://storage.example/config' },
      });
      (mockApiClient.uploadFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (mockApiClient.completeUpload as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        uploaded: 1,
        downloaded: 0,
        conflicts: 0,
      });

      const result = await service.sync();

      expect(result).toMatchObject({
        success: true,
        uploaded: 1,
        downloaded: 1,
        conflicts: 1,
      });
      expect(mockApiClient.initiateUpload).toHaveBeenCalledWith(
        'test-token',
        expect.any(Object),
        ['config.json'],
        expect.any(AbortSignal),
      );
      const finalizedManifest = (
        mockApiClient.completeUpload as ReturnType<typeof vi.fn>
      ).mock.calls[0]?.[1] as SyncManifest;
      expect(finalizedManifest.files).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: 'memory/preference.json',
          hash: computeHash(downloadedMemory),
          size: downloadedMemory.length,
        }),
      ]));
      expect(finalizedManifest.files.find((file) => file.path === 'memory/preference.json')?.hash)
        .not.toBe(computeHash(Buffer.from(JSON.stringify({ preference: 'local-stale' }))));
      expect(
        (mockApiClient.initiateUpload as ReturnType<typeof vi.fn>).mock.calls[0]?.[1],
      ).toEqual(finalizedManifest);
    });

    it('force downloads only requested memory paths', async () => {
      await fs.ensureDir(tempDir);

      const remoteManifest: SyncManifest = {
        version: 1,
        userId: 'test-user',
        lastModified: new Date().toISOString(),
        files: [
          {
            path: 'memory/preference.json',
            hash: 'memory-hash',
            size: 42,
            modifiedAt: new Date().toISOString(),
          },
          {
            path: 'config.json',
            hash: 'config-hash',
            size: 100,
            modifiedAt: new Date().toISOString(),
            encrypted: true,
          },
        ],
        checksum: 'test-checksum',
      };

      const service = new SyncService({
        authToken: 'test-token',
        userId: 'test-user',
        config: {
          enabled: true,
          interval: 300000,
        },
        apiClient: mockApiClient,
      });

      (service as any).basePath = tempDir;

      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(remoteManifest);
      (mockApiClient.initiateDownload as ReturnType<typeof vi.fn>).mockResolvedValue({
        downloadUrls: {
          'memory/preference.json': 'https://example.com/download/memory/preference.json',
        },
      });
      (mockApiClient.downloadFile as ReturnType<typeof vi.fn>).mockResolvedValue(
        Buffer.from(JSON.stringify({ id: 'preference', content: 'Prefer concise output' }))
      );

      const result = await service.forceDownloadPaths(['memory/preference.json']);

      expect(result.success).toBe(true);
      expect(result.downloaded).toBe(1);
      expect(mockApiClient.initiateDownload).toHaveBeenCalledWith(
        'test-token',
        ['memory/preference.json'],
        expect.any(AbortSignal),
      );
      expect(await fs.pathExists(path.join(tempDir, 'config.json'))).toBe(false);
      expect(await fs.pathExists(path.join(tempDir, 'memory', 'preference.json'))).toBe(true);
    });

    it('returns error if already syncing', async () => {
      const service = new SyncService({
        authToken: 'test-token',
        userId: 'test-user',
        config: {
          enabled: true,
          interval: 300000,
        },
        apiClient: mockApiClient,
      });

      (service as any).basePath = tempDir;

      // Set syncing flag
      (service as any).syncing = true;

      const result = await service.sync();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Sync already in progress');
    });
  });

  describe('events', () => {
    it('emits sync events', async () => {
      await fs.ensureDir(tempDir);
      await fs.writeJson(path.join(tempDir, 'config.json'), { provider: 'openrouter' });

      const events: any[] = [];
      const onEvent = (event: any) => events.push(event);

      const service = new SyncService({
        authToken: 'test-token',
        userId: 'test-user',
        config: {
          enabled: true,
          interval: 300000,
        },
        apiClient: mockApiClient,
        onEvent,
      });

      (service as any).basePath = tempDir;

      // Mock API responses
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockApiClient.initiateUpload as ReturnType<typeof vi.fn>).mockResolvedValue({
        uploadUrls: { 'config.json': 'https://example.com/upload/config.json' },
      });
      (mockApiClient.uploadFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (mockApiClient.completeUpload as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        uploaded: 1,
        downloaded: 0,
        conflicts: 0,
      });

      await service.sync();

      expect(events.some((e) => e.type === 'sync_started')).toBe(true);
      expect(events.some((e) => e.type === 'sync_completed')).toBe(true);
    });

    it('emits sync_failed on error', async () => {
      const events: any[] = [];
      const onEvent = (event: any) => events.push(event);

      const service = new SyncService({
        authToken: 'test-token',
        userId: 'test-user',
        config: {
          enabled: true,
          interval: 300000,
        },
        apiClient: mockApiClient,
        onEvent,
      });

      (service as any).basePath = tempDir;

      // Mock API to throw error
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error')
      );

      const result = await service.sync();

      expect(result.success).toBe(false);
      expect(events.some((e) => e.type === 'sync_failed')).toBe(true);
    });

    it('does not let a file observer interrupt upload finalization', async () => {
      await fs.writeJson(path.join(tempDir, 'config.json'), { provider: 'openrouter' });
      const service = new SyncService({
        authToken: 'test-token',
        userId: 'test-user',
        config: { enabled: true, interval: 300000 },
        apiClient: mockApiClient,
        onEvent: (event) => {
          if (event.type === 'file_uploaded') {
            throw new Error('file observer failed');
          }
        },
      });
      (service as unknown as { basePath: string }).basePath = tempDir;
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockApiClient.initiateUpload as ReturnType<typeof vi.fn>).mockResolvedValue({
        uploadUrls: { 'config.json': 'https://example.com/upload/config.json' },
      });
      (mockApiClient.uploadFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (mockApiClient.completeUpload as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        uploaded: 1,
        downloaded: 0,
        conflicts: 0,
      });

      await expect(service.sync()).resolves.toMatchObject({ success: true, uploaded: 1 });
      expect(mockApiClient.completeUpload).toHaveBeenCalledTimes(1);
      expect(await fs.pathExists(path.join(tempDir, '.sync-state.json'))).toBe(true);
    });

    it('keeps an authentication failure truthful when its observers throw', async () => {
      const service = new SyncService({
        authToken: 'test-token',
        userId: 'test-user',
        config: { enabled: true, interval: 300000 },
        apiClient: mockApiClient,
        onEvent: (event) => {
          if (event.type === 'auth_failure') {
            throw new Error('auth event observer failed');
          }
        },
        onAuthFailure: () => {
          throw new Error('auth callback failed');
        },
      });
      (service as unknown as { basePath: string }).basePath = tempDir;
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new Error('401 Unauthorized'));

      await expect(service.sync()).resolves.toMatchObject({
        success: false,
        error: 'Authentication expired. Please run /login again.',
      });
    });
  });

  describe('cross-process lock and state persistence', () => {
    function makeService(events: SyncEvent[] = []): SyncService {
      const service = new SyncService({
        authToken: 'test-token',
        userId: 'test-user',
        config: { enabled: true, interval: 300000 },
        apiClient: mockApiClient,
        onEvent: (event) => events.push(event),
      });
      (service as unknown as { basePath: string }).basePath = tempDir;
      return service;
    }

    it('allows only one service to win a simultaneous lock acquisition race', async () => {
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const services = Array.from({ length: 8 }, () => makeService());

      const results = await Promise.all(services.map((service) => service.sync()));

      expect(results.filter((result) => result.success)).toHaveLength(1);
      expect(results.filter((result) => result.error === 'Sync locked by another process')).toHaveLength(7);
      expect(mockApiClient.getRemoteManifest).toHaveBeenCalledTimes(1);
    });

    it.each(['forceDownload', 'forceDownloadPaths', 'forceUpload'] as const)(
      'prevents %s from racing a normal sync that owns the cross-process lock',
      async (operation) => {
        let unblockRemote!: () => void;
        let signalRemoteStarted!: () => void;
        const remoteStarted = new Promise<void>((resolve) => {
          signalRemoteStarted = resolve;
        });
        const remoteBlocked = new Promise<void>((resolve) => {
          unblockRemote = resolve;
        });
        (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>)
          .mockImplementationOnce(async () => {
            signalRemoteStarted();
            await remoteBlocked;
            return null;
          })
          .mockResolvedValue(null);
        const holder = makeService().sync();
        await remoteStarted;
        const contender = makeService();

        let result;
        try {
          result = operation === 'forceDownload'
            ? await contender.forceDownload()
            : operation === 'forceDownloadPaths'
              ? await contender.forceDownloadPaths(['memory/entry.json'])
              : await contender.forceUpload();
        } finally {
          unblockRemote();
          await holder;
        }

        expect(result).toMatchObject({
          success: false,
          error: 'Sync locked by another process',
        });
        expect(mockApiClient.getRemoteManifest).toHaveBeenCalledTimes(1);
      },
    );

    it('releases its lock and in-process guard when the sync-started observer throws', async () => {
      let shouldThrow = true;
      const service = new SyncService({
        authToken: 'test-token',
        userId: 'test-user',
        config: { enabled: true, interval: 300000 },
        apiClient: mockApiClient,
        onEvent: (event) => {
          if (event.type === 'sync_started' && shouldThrow) {
            shouldThrow = false;
            throw new Error('sync observer failed');
          }
        },
      });
      (service as unknown as { basePath: string }).basePath = tempDir;
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(service.sync()).resolves.toMatchObject({
        success: false,
        error: 'sync observer failed',
      });
      expect(await fs.pathExists(path.join(tempDir, '.sync-lock'))).toBe(false);

      await expect(service.sync()).resolves.toMatchObject({ success: true });
    });

    it('does not remove a replacement lock when the stale owner finishes', async () => {
      let unblockRemote!: () => void;
      let signalRemoteStarted!: () => void;
      const remoteStarted = new Promise<void>((resolve) => {
        signalRemoteStarted = resolve;
      });
      const remoteBlocked = new Promise<void>((resolve) => {
        unblockRemote = resolve;
      });
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        signalRemoteStarted();
        await remoteBlocked;
        return null;
      });

      const syncPromise = makeService().sync();
      await remoteStarted;
      const lockPath = path.join(tempDir, '.sync-lock');
      await fs.remove(lockPath);
      const replacement = {
        version: 1,
        ownerId: 'replacement-owner',
        pid: process.pid,
        createdAt: Date.now(),
      };
      await fs.writeJson(lockPath, replacement);

      unblockRemote();
      await syncPromise;

      expect(await fs.readJson(lockPath)).toEqual(replacement);
    });

    it('preserves the last committed sync state when atomic replacement fails', async () => {
      const statePath = path.join(tempDir, '.sync-state.json');
      const previousState = {
        lastSync: '2026-01-01T00:00:00.000Z',
        lastManifestHash: 'previous-hash',
      };
      await fs.writeJson(statePath, previousState);
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const events: SyncEvent[] = [];
      const originalRename = nodeFs.rename.bind(nodeFs);
      const rename = vi.spyOn(nodeFs, 'rename').mockImplementation(async (source, destination) => {
        if (destination === statePath) {
          throw Object.assign(new Error('sync state commit failed'), { code: 'EIO' });
        }
        return originalRename(source, destination);
      });

      try {
        const result = await makeService(events).sync();

        expect(result.success).toBe(false);
        expect(result.error).toContain('sync state commit failed');
        expect(await fs.readJson(statePath)).toEqual(previousState);
        expect(events.some((event) => event.type === 'sync_completed')).toBe(false);
      } finally {
        rename.mockRestore();
      }
    });

    it('keeps a committed success truthful when the completion observer throws', async () => {
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const service = new SyncService({
        authToken: 'test-token',
        userId: 'test-user',
        config: { enabled: true, interval: 300000 },
        apiClient: mockApiClient,
        onEvent: (event) => {
          if (event.type === 'sync_completed') {
            throw new Error('completion observer failed');
          }
        },
      });
      (service as unknown as { basePath: string }).basePath = tempDir;

      await expect(service.sync()).resolves.toMatchObject({ success: true });
      expect(await fs.pathExists(path.join(tempDir, '.sync-state.json'))).toBe(true);
      expect(await fs.pathExists(path.join(tempDir, '.sync-lock'))).toBe(false);
    });

    it('returns the original failure when the failure observer throws', async () => {
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new Error('remote manifest failed'));
      const service = new SyncService({
        authToken: 'test-token',
        userId: 'test-user',
        config: { enabled: true, interval: 300000 },
        apiClient: mockApiClient,
        onEvent: (event) => {
          if (event.type === 'sync_failed') {
            throw new Error('failure observer failed');
          }
        },
      });
      (service as unknown as { basePath: string }).basePath = tempDir;

      await expect(service.sync()).resolves.toMatchObject({
        success: false,
        error: 'remote manifest failed',
      });
      expect(await fs.pathExists(path.join(tempDir, '.sync-lock'))).toBe(false);
    });
  });

  describe('remote trust boundary', () => {
    function makeManifest(paths: string[]): SyncManifest {
      return {
        version: 1,
        userId: 'test-user',
        lastModified: new Date().toISOString(),
        files: paths.map((filePath) => ({
          path: filePath,
          hash: `remote-${filePath}`,
          size: 8,
          modifiedAt: new Date(Date.now() + 1000).toISOString(),
        })),
        checksum: 'remote-checksum',
      };
    }

    function makeService(events: SyncEvent[] = []): SyncService {
      const service = new SyncService({
        authToken: 'test-token',
        userId: 'test-user',
        config: { enabled: true, interval: 300000 },
        apiClient: mockApiClient,
        onEvent: (event) => events.push(event),
      });
      (service as unknown as { basePath: string }).basePath = tempDir;
      return service;
    }

    it('validates the whole remote manifest before requesting URLs or mutating outside the root', async () => {
      const outsideFile = `${tempDir}-outside-sentinel.json`;
      const outsideName = path.basename(outsideFile);
      const unsafePaths = [
        `../${outsideName}`,
        `memory/../../${outsideName}`,
        outsideFile,
        'C:/outside.json',
        'C:\\outside.json',
        '\\\\server\\share\\outside.json',
        'memory\\outside.json',
        `memory/${String.fromCharCode(0)}outside.json`,
        '',
        '.',
        'memory/./entry.json',
        'memory//entry.json',
        'not-enabled/entry.json',
        '.sync-state.json',
        'sessions/index.json.lock/attacker.owner',
        'sessions/.index.json.crashed.tmp',
      ];

      try {
        for (const unsafePath of unsafePaths) {
          vi.clearAllMocks();
          await fs.writeFile(outsideFile, 'sentinel');
          const events: SyncEvent[] = [];
          const service = makeService(events);
          (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(
            makeManifest(['memory/safe.json', unsafePath]),
          );
          (mockApiClient.initiateDownload as ReturnType<typeof vi.fn>).mockResolvedValue({
            downloadUrls: {
              'memory/safe.json': 'https://storage.example/safe',
              [unsafePath]: 'https://storage.example/unsafe',
            },
          });
          (mockApiClient.downloadFile as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from('attacker'));

          const result = await service.sync();

          expect(result.success, `path ${JSON.stringify(unsafePath)}`).toBe(false);
          expect(mockApiClient.initiateDownload).not.toHaveBeenCalled();
          expect(mockApiClient.downloadFile).not.toHaveBeenCalled();
          expect(await fs.readFile(outsideFile, 'utf8')).toBe('sentinel');
          expect(await fs.pathExists(path.join(tempDir, '.sync-state.json'))).toBe(false);
          expect(events.some((event) => event.type === 'sync_completed')).toBe(false);
        }
      } finally {
        await fs.remove(outsideFile);
      }
    });

    it.each([
      ['null entry', [null]],
      ['non-string hash', [{ path: 'memory/entry.json', hash: 42, size: 8, modifiedAt: new Date().toISOString() }]],
      ['negative size', [{ path: 'memory/entry.json', hash: 'hash', size: -1, modifiedAt: new Date().toISOString() }]],
      ['non-string modified time', [{ path: 'memory/entry.json', hash: 'hash', size: 8, modifiedAt: null }]],
    ])('rejects a malformed remote manifest before side effects: %s', async (_label, files) => {
      const malformedManifest = {
        ...makeManifest([]),
        files,
      } as unknown as SyncManifest;
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>)
        .mockResolvedValue(malformedManifest);

      const result = await makeService().sync();

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/invalid sync manifest/i);
      expect(mockApiClient.initiateDownload).not.toHaveBeenCalled();
      expect(mockApiClient.initiateUpload).not.toHaveBeenCalled();
      expect(await fs.pathExists(path.join(tempDir, '.sync-state.json'))).toBe(false);
    });

    it.each([
      ['unsupported version', { version: 2 }],
      ['different user', { userId: 'another-user' }],
    ])('rejects a remote manifest with %s', async (_label, override) => {
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...makeManifest(['memory/entry.json']),
        ...override,
      });

      const result = await makeService().sync();

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/invalid sync manifest/i);
      expect(mockApiClient.initiateDownload).not.toHaveBeenCalled();
    });

    it.each([
      ['per-file limit', { maxFileSize: 7, maxTotalSize: 100 }, ['memory/entry.json']],
      ['aggregate limit', { maxFileSize: 100, maxTotalSize: 15 }, [
        'memory/first.json',
        'memory/second.json',
      ]],
    ])('rejects a remote manifest over the configured %s before transfer', async (
      _label,
      limits,
      paths,
    ) => {
      Object.assign(mockApiClient, { limits });
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>)
        .mockResolvedValue(makeManifest(paths));

      const result = await makeService().sync();

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/invalid sync manifest/i);
      expect(mockApiClient.initiateDownload).not.toHaveBeenCalled();
      expect(mockApiClient.downloadFile).not.toHaveBeenCalled();
    });

    it('rejects a remote write through an escaping symlink ancestor', async () => {
      const outsideDir = `${tempDir}-outside-dir`;
      await fs.ensureDir(outsideDir);
      await fs.symlink(
        outsideDir,
        path.join(tempDir, 'memory'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      try {
        const service = makeService();
        (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(
          makeManifest(['memory/escape.json']),
        );
        (mockApiClient.initiateDownload as ReturnType<typeof vi.fn>).mockResolvedValue({
          downloadUrls: { 'memory/escape.json': 'https://storage.example/escape' },
        });
        (mockApiClient.downloadFile as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from('attacker'));

        const result = await service.sync();

        expect(result.success).toBe(false);
        expect(mockApiClient.initiateDownload).not.toHaveBeenCalled();
        expect(await fs.pathExists(path.join(outsideDir, 'escape.json'))).toBe(false);
      } finally {
        await fs.remove(outsideDir);
      }
    });

    it('revalidates a download sink when an ancestor becomes an escaping symlink', async () => {
      const outsideDir = `${tempDir}-download-race-outside`;
      await fs.ensureDir(outsideDir);

      try {
        const events: SyncEvent[] = [];
        const service = makeService(events);
        (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(
          makeManifest(['memory/escape.json']),
        );
        (mockApiClient.initiateDownload as ReturnType<typeof vi.fn>).mockImplementation(async () => {
          await fs.symlink(
            outsideDir,
            path.join(tempDir, 'memory'),
            process.platform === 'win32' ? 'junction' : 'dir',
          );
          return { downloadUrls: { 'memory/escape.json': 'https://storage.example/escape' } };
        });
        (mockApiClient.downloadFile as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from('attacker'));

        const result = await service.sync();

        expect(result.success).toBe(false);
        expect(await fs.pathExists(path.join(outsideDir, 'escape.json'))).toBe(false);
        expect(events.some((event) => event.type === 'sync_completed')).toBe(false);
      } finally {
        await fs.remove(outsideDir);
      }
    });

    it('revalidates an upload read when an ancestor becomes an escaping symlink', async () => {
      const outsideDir = `${tempDir}-upload-race-outside`;
      await fs.ensureDir(path.join(tempDir, 'memory'));
      await fs.writeFile(path.join(tempDir, 'memory', 'local.json'), 'local');
      await fs.ensureDir(outsideDir);
      await fs.writeFile(path.join(outsideDir, 'local.json'), 'outside-secret');

      try {
        const events: SyncEvent[] = [];
        const service = makeService(events);
        (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        (mockApiClient.initiateUpload as ReturnType<typeof vi.fn>).mockImplementation(async () => {
          await fs.remove(path.join(tempDir, 'memory'));
          await fs.symlink(
            outsideDir,
            path.join(tempDir, 'memory'),
            process.platform === 'win32' ? 'junction' : 'dir',
          );
          return { uploadUrls: { 'memory/local.json': 'https://storage.example/upload' } };
        });

        const result = await service.sync();

        expect(result.success).toBe(false);
        expect(mockApiClient.uploadFile).not.toHaveBeenCalled();
        expect(mockApiClient.completeUpload).not.toHaveBeenCalled();
        expect(events.some((event) => event.type === 'sync_completed')).toBe(false);
      } finally {
        await fs.remove(outsideDir);
      }
    });

    it('rejects unsafe local-delete actions at the filesystem sink', async () => {
      const outsideFile = `${tempDir}-delete-sentinel.json`;
      await fs.writeFile(outsideFile, 'sentinel');
      const service = makeService();
      const internalService = service as unknown as {
        performSyncActions: (
          actions: {
            uploads: never[];
            downloads: never[];
            conflicts: never[];
            localDeletes: string[];
            remoteDeletes: never[];
          },
          manifest: SyncManifest,
          enabledRoots: readonly string[],
        ) => Promise<{ success: boolean }>;
      };

      try {
        const result = await internalService.performSyncActions(
          {
            uploads: [],
            downloads: [],
            conflicts: [],
            localDeletes: [`../${path.basename(outsideFile)}`],
            remoteDeletes: [],
          },
          makeManifest([]),
          ['config.json', 'memory/'],
        );

        expect(result.success).toBe(false);
        expect(await fs.readFile(outsideFile, 'utf8')).toBe('sentinel');
      } finally {
        await fs.remove(outsideFile);
      }
    });

    it('validates and atomically replaces a downloaded session index under its shared lock', async () => {
      const sessionsDir = path.join(tempDir, 'sessions');
      const indexPath = path.join(sessionsDir, 'index.json');
      const indexLockPath = path.join(sessionsDir, 'index.json.lock');
      const previousIndex = {
        sessions: [{
          id: 'local-session',
          projectPath: '/workspace/local',
          createdAt: '2026-01-01T00:00:00.000Z',
        }],
        byProject: { '/workspace/local': ['local-session'] },
      };
      const remoteIndex = {
        sessions: [{
          id: 'remote-session',
          projectPath: '/workspace/remote',
          createdAt: '2026-02-01T00:00:00.000Z',
        }],
        byProject: { '/workspace/remote': ['remote-session'] },
      };
      await fs.ensureDir(sessionsDir);
      await fs.writeJson(indexPath, previousIndex);
      const lease = await acquireFileLock(indexLockPath);
      expect(lease).not.toBeNull();

      try {
        (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue({
          ...makeManifest(['sessions/index.json']),
          files: [{
            path: 'sessions/index.json',
            hash: 'remote-index-hash',
            size: Buffer.byteLength(JSON.stringify(remoteIndex)),
            modifiedAt: '2099-02-01T00:00:00.000Z',
          }],
        });
        (mockApiClient.initiateDownload as ReturnType<typeof vi.fn>).mockResolvedValue({
          downloadUrls: { 'sessions/index.json': 'https://storage.example/session-index' },
        });
        (mockApiClient.downloadFile as ReturnType<typeof vi.fn>)
          .mockResolvedValue(Buffer.from(JSON.stringify(remoteIndex)));

        let settled = false;
        const syncPromise = makeService().sync().then((result) => {
          settled = true;
          return result;
        });
        await vi.waitFor(() => {
          expect(mockApiClient.downloadFile).toHaveBeenCalledTimes(1);
        });
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(settled).toBe(false);
        expect(await fs.readJson(indexPath)).toEqual(previousIndex);

        await lease?.release();
        const result = await syncPromise;
        expect(result.success).toBe(true);
        expect(await fs.readJson(indexPath)).toEqual(remoteIndex);
      } finally {
        await lease?.release();
      }
    });

    it('rejects a malformed downloaded session index without replacing the committed index', async () => {
      const sessionsDir = path.join(tempDir, 'sessions');
      const indexPath = path.join(sessionsDir, 'index.json');
      const previousIndex = {
        sessions: [{
          id: 'local-session',
          projectPath: '/workspace/local',
          createdAt: '2026-01-01T00:00:00.000Z',
        }],
        byProject: { '/workspace/local': ['local-session'] },
      };
      await fs.ensureDir(sessionsDir);
      await fs.writeJson(indexPath, previousIndex);
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...makeManifest(['sessions/index.json']),
        files: [{
          path: 'sessions/index.json',
          hash: 'malformed-index-hash',
          size: 32,
          modifiedAt: '2099-02-01T00:00:00.000Z',
        }],
      });
      (mockApiClient.initiateDownload as ReturnType<typeof vi.fn>).mockResolvedValue({
        downloadUrls: { 'sessions/index.json': 'https://storage.example/session-index' },
      });
      (mockApiClient.downloadFile as ReturnType<typeof vi.fn>)
        .mockResolvedValue(Buffer.from('{"sessions":[],"byProject":[]}'));

      const result = await makeService().sync();

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/session index/i);
      expect(await fs.readJson(indexPath)).toEqual(previousIndex);
      expect(await fs.pathExists(path.join(tempDir, '.sync-state.json'))).toBe(false);
    });

    it.each([
      '../outside',
      'nested/outside',
      'nested\\outside',
      'CON',
      'session:alternate-stream',
      'session.',
      'session ',
    ])(
      'rejects an unsafe downloaded session identifier without replacing the committed index: %j',
      async (unsafeSessionId) => {
        const sessionsDir = path.join(tempDir, 'sessions');
        const indexPath = path.join(sessionsDir, 'index.json');
        const previousIndex = {
          sessions: [{
            id: 'local-session',
            projectPath: '/workspace/local',
            createdAt: '2026-01-01T00:00:00.000Z',
          }],
          byProject: { '/workspace/local': ['local-session'] },
        };
        const unsafeIndex = {
          sessions: [{
            id: unsafeSessionId,
            projectPath: '/workspace/remote',
            createdAt: '2026-02-01T00:00:00.000Z',
          }],
          byProject: { '/workspace/remote': [unsafeSessionId] },
        };
        await fs.ensureDir(sessionsDir);
        await fs.writeJson(indexPath, previousIndex);
        (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue({
          ...makeManifest(['sessions/index.json']),
          files: [{
            path: 'sessions/index.json',
            hash: 'unsafe-index-hash',
            size: Buffer.byteLength(JSON.stringify(unsafeIndex)),
            modifiedAt: '2099-02-01T00:00:00.000Z',
          }],
        });
        (mockApiClient.initiateDownload as ReturnType<typeof vi.fn>).mockResolvedValue({
          downloadUrls: { 'sessions/index.json': 'https://storage.example/session-index' },
        });
        (mockApiClient.downloadFile as ReturnType<typeof vi.fn>)
          .mockResolvedValue(Buffer.from(JSON.stringify(unsafeIndex)));

        const result = await makeService().sync();

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/session index/i);
        expect(await fs.readJson(indexPath)).toEqual(previousIndex);
        expect(await fs.pathExists(path.join(tempDir, '.sync-state.json'))).toBe(false);
      },
    );

    it('fails a download when any requested URL is missing without saving success state', async () => {
      const events: SyncEvent[] = [];
      const service = makeService(events);
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeManifest(['memory/missing.json']),
      );
      (mockApiClient.initiateDownload as ReturnType<typeof vi.fn>).mockResolvedValue({ downloadUrls: {} });

      const result = await service.sync();

      expect(result.success).toBe(false);
      expect(result.downloaded).toBe(0);
      expect(mockApiClient.downloadFile).not.toHaveBeenCalled();
      expect(await fs.pathExists(path.join(tempDir, '.sync-state.json'))).toBe(false);
      expect(events.some((event) => event.type === 'sync_completed')).toBe(false);
    });

    it('reports accurate counters and no success state after a partial download failure', async () => {
      const events: SyncEvent[] = [];
      const service = makeService(events);
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeManifest(['memory/first.json', 'memory/second.json']),
      );
      (mockApiClient.initiateDownload as ReturnType<typeof vi.fn>).mockResolvedValue({
        downloadUrls: {
          'memory/first.json': 'https://storage.example/first',
          'memory/second.json': 'https://storage.example/second',
        },
      });
      (mockApiClient.downloadFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(Buffer.from('first'))
        .mockRejectedValueOnce(new Error('second download failed'));

      const result = await service.sync();

      expect(result.success).toBe(false);
      expect(result.downloaded).toBe(1);
      expect(result.error).toContain('second download failed');
      expect(await fs.pathExists(path.join(tempDir, '.sync-state.json'))).toBe(false);
      expect(events.some((event) => event.type === 'sync_completed')).toBe(false);
    });

    it('fails before upload when any requested URL is missing', async () => {
      await fs.writeJson(path.join(tempDir, 'config.json'), { provider: 'openrouter' });
      const events: SyncEvent[] = [];
      const service = makeService(events);
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockApiClient.initiateUpload as ReturnType<typeof vi.fn>).mockResolvedValue({ uploadUrls: {} });

      const result = await service.sync();

      expect(result.success).toBe(false);
      expect(mockApiClient.uploadFile).not.toHaveBeenCalled();
      expect(mockApiClient.completeUpload).not.toHaveBeenCalled();
      expect(await fs.pathExists(path.join(tempDir, '.sync-state.json'))).toBe(false);
      expect(events.some((event) => event.type === 'sync_completed')).toBe(false);
    });

    it('does not finalize a manifest after a partial upload failure', async () => {
      await fs.ensureDir(path.join(tempDir, 'agents'));
      await fs.writeJson(path.join(tempDir, 'config.json'), { provider: 'openrouter' });
      await fs.writeFile(path.join(tempDir, 'agents', 'second.json'), '{}');
      const events: SyncEvent[] = [];
      const service = makeService(events);
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockApiClient.initiateUpload as ReturnType<typeof vi.fn>).mockResolvedValue({
        uploadUrls: {
          'config.json': 'https://storage.example/config',
          'agents/second.json': 'https://storage.example/second',
        },
      });
      (mockApiClient.uploadFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('second upload failed'));

      const result = await service.sync();

      expect(result.success).toBe(false);
      expect(result.uploaded).toBe(1);
      expect(result.error).toContain('second upload failed');
      expect(mockApiClient.completeUpload).not.toHaveBeenCalled();
      expect(await fs.pathExists(path.join(tempDir, '.sync-state.json'))).toBe(false);
      expect(events.some((event) => event.type === 'sync_completed')).toBe(false);
    });

    it.each([
      ['a false result', { success: false, uploaded: 0, downloaded: 0, conflicts: 0, error: 'server rejected finalization' }],
      ['an exception', new Error('finalization unavailable')],
    ])('treats upload finalization %s as terminal failure', async (_label, finalization) => {
      await fs.writeJson(path.join(tempDir, 'config.json'), { provider: 'openrouter' });
      const events: SyncEvent[] = [];
      const service = makeService(events);
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockApiClient.initiateUpload as ReturnType<typeof vi.fn>).mockResolvedValue({
        uploadUrls: { 'config.json': 'https://storage.example/config' },
      });
      (mockApiClient.uploadFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      if (finalization instanceof Error) {
        (mockApiClient.completeUpload as ReturnType<typeof vi.fn>).mockRejectedValue(finalization);
      } else {
        (mockApiClient.completeUpload as ReturnType<typeof vi.fn>).mockResolvedValue(finalization);
      }

      const result = await service.sync();

      expect(result.success).toBe(false);
      expect(result.uploaded).toBe(1);
      expect(await fs.pathExists(path.join(tempDir, '.sync-state.json'))).toBe(false);
      expect(events.some((event) => event.type === 'sync_completed')).toBe(false);
    });

    it('validates the complete force-download manifest, including unrequested entries', async () => {
      const service = makeService();
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeManifest(['memory/requested.json', '../outside.json']),
      );

      const result = await service.forceDownloadPaths(['memory/requested.json']);

      expect(result.success).toBe(false);
      expect(mockApiClient.initiateDownload).not.toHaveBeenCalled();
    });

    it('fails force transfers on missing URLs and failed finalization', async () => {
      const service = makeService();
      (mockApiClient.getRemoteManifest as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeManifest(['memory/missing.json']),
      );
      (mockApiClient.initiateDownload as ReturnType<typeof vi.fn>).mockResolvedValue({ downloadUrls: {} });

      const downloadResult = await service.forceDownload();
      expect(downloadResult.success).toBe(false);

      vi.clearAllMocks();
      await fs.writeJson(path.join(tempDir, 'config.json'), { provider: 'openrouter' });
      (mockApiClient.initiateUpload as ReturnType<typeof vi.fn>).mockResolvedValue({
        uploadUrls: { 'config.json': 'https://storage.example/config' },
      });
      (mockApiClient.uploadFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      (mockApiClient.completeUpload as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        uploaded: 0,
        downloaded: 0,
        conflicts: 0,
        error: 'force finalization failed',
      });

      const uploadResult = await service.forceUpload();
      expect(uploadResult.success).toBe(false);
      expect(uploadResult.uploaded).toBe(1);
    });
  });

  describe('getStatus', () => {
    it('returns current sync status', async () => {
      await fs.ensureDir(tempDir);
      await fs.writeJson(path.join(tempDir, 'config.json'), { provider: 'openrouter' });

      const service = new SyncService({
        authToken: 'test-token',
        userId: 'test-user',
        config: {
          enabled: true,
          interval: 300000,
        },
        apiClient: mockApiClient,
      });

      (service as any).basePath = tempDir;

      const status = await service.getStatus();

      expect(status.enabled).toBe(true);
      expect(status.syncing).toBe(false);
      expect(status.fileCount).toBeGreaterThan(0);
    });
  });
});

describe('SyncService - File filtering', () => {
  let tempDir: string;
  let mockApiClient: SyncApiClient;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `sync-filter-test-${Date.now()}`);
    await fs.ensureDir(tempDir);

    mockApiClient = {
      getRemoteManifest: vi.fn().mockResolvedValue(null),
      initiateUpload: vi.fn().mockResolvedValue({ uploadUrls: {} }),
      uploadFile: vi.fn().mockResolvedValue(undefined),
      completeUpload: vi.fn().mockResolvedValue({ success: true }),
      initiateDownload: vi.fn().mockResolvedValue({ downloadUrls: {} }),
      downloadFile: vi.fn().mockResolvedValue(Buffer.from('{}')),
      deleteSyncData: vi.fn(),
      healthCheck: vi.fn(),
      limits: { maxFileSize: 10 * 1024 * 1024, maxTotalSize: 100 * 1024 * 1024 },
    } as unknown as SyncApiClient;
  });

  afterEach(async () => {
    await fs.remove(tempDir).catch(() => {});
    vi.clearAllMocks();
  });

  it('excludes device-id file', async () => {
    await fs.writeFile(path.join(tempDir, 'device-id'), 'test-device');
    await fs.writeJson(path.join(tempDir, 'config.json'), { provider: 'openrouter' });

    const service = new SyncService({
      authToken: 'test-token',
      userId: 'test-user',
      config: { enabled: true, interval: 300000 },
      apiClient: mockApiClient,
    });

    (service as any).basePath = tempDir;

    const status = await service.getStatus();

    // device-id should be excluded
    expect(status.fileCount).toBe(1); // Only config.json
  });

  it('excludes error.log file', async () => {
    await fs.writeFile(path.join(tempDir, 'error.log'), 'test error');
    await fs.writeJson(path.join(tempDir, 'config.json'), { provider: 'openrouter' });

    const service = new SyncService({
      authToken: 'test-token',
      userId: 'test-user',
      config: { enabled: true, interval: 300000 },
      apiClient: mockApiClient,
    });

    (service as any).basePath = tempDir;

    const status = await service.getStatus();

    // error.log should be excluded
    expect(status.fileCount).toBe(1); // Only config.json
  });

  it('excludes session index lock and atomic temporary files', async () => {
    const sessionsDir = path.join(tempDir, 'sessions');
    await fs.ensureDir(sessionsDir);
    await fs.writeJson(path.join(sessionsDir, 'index.json'), { sessions: [], byProject: {} });
    await fs.writeFile(path.join(sessionsDir, 'index.json.lock'), 'lock-owner');
    await fs.writeFile(path.join(sessionsDir, 'index.json.lock.reaper'), 'reaper-owner');
    await fs.writeFile(path.join(sessionsDir, '.index.json.crashed.tmp'), '{"sessions":');
    await fs.writeFile(path.join(sessionsDir, '.memory.json.crashed.tmp'), '{"memory":');
    await fs.writeFile(path.join(sessionsDir, '.memory.json.crashed.tombstone'), '{}');

    const service = new SyncService({
      authToken: 'test-token',
      userId: 'test-user',
      config: { enabled: true, interval: 300000 },
      apiClient: mockApiClient,
    });
    (service as unknown as { basePath: string }).basePath = tempDir;

    const status = await service.getStatus();

    expect(status.fileCount).toBe(1);
  });

  it('includes telemetry when consent is given', async () => {
    await fs.ensureDir(path.join(tempDir, 'telemetry'));
    await fs.writeJson(path.join(tempDir, 'telemetry', 'queue.json'), { events: [] });
    await fs.writeJson(path.join(tempDir, 'config.json'), { provider: 'openrouter' });

    const service = new SyncService({
      authToken: 'test-token',
      userId: 'test-user',
      config: {
        enabled: true,
        interval: 300000,
        includeTelemetry: true,
      },
      apiClient: mockApiClient,
    });

    (service as any).basePath = tempDir;

    const status = await service.getStatus();

    // telemetry should be included
    expect(status.fileCount).toBe(2); // config.json + telemetry/queue.json
  });

  it('excludes telemetry by default', async () => {
    await fs.ensureDir(path.join(tempDir, 'telemetry'));
    await fs.writeJson(path.join(tempDir, 'telemetry', 'queue.json'), { events: [] });
    await fs.writeJson(path.join(tempDir, 'config.json'), { provider: 'openrouter' });

    const service = new SyncService({
      authToken: 'test-token',
      userId: 'test-user',
      config: {
        enabled: true,
        interval: 300000,
        includeTelemetry: false,
      },
      apiClient: mockApiClient,
    });

    (service as any).basePath = tempDir;

    const status = await service.getStatus();

    // telemetry should be excluded
    expect(status.fileCount).toBe(1); // Only config.json
  });
});
