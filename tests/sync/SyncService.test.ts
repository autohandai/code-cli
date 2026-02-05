/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { SyncService, createSyncService } from '../../src/sync/SyncService.js';
import { SyncApiClient } from '../../src/sync/SyncApiClient.js';
import type { SyncManifest } from '../../src/sync/types.js';

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
