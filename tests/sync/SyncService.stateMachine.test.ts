/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fse from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { SYNC_SERVICE_LIFECYCLE, SyncService } from '../../src/sync/SyncService.js';
import type { SyncApiClient } from '../../src/sync/SyncApiClient.js';
import type { SyncManifest } from '../../src/sync/types.js';
import {
  InvalidTransitionError,
  StateMachine,
  reachableStates,
  terminalStates,
} from '../../src/utils/stateMachine.js';
import { randomEventWalk } from '../helpers/stateMachineProperties.js';

vi.mock('../../src/constants.js', () => ({
  AUTOHAND_HOME: '/tmp/autohand-sync-state-machine-test',
  AUTOHAND_FILES: {
    configJson: '/tmp/autohand-sync-state-machine-test/config.json',
    configToml: '/tmp/autohand-sync-state-machine-test/config.toml',
    configYaml: '/tmp/autohand-sync-state-machine-test/config.yaml',
    configYml: '/tmp/autohand-sync-state-machine-test/config.yml',
  },
}));

describe('SYNC_SERVICE_LIFECYCLE', () => {
  it('allows idle <-> running and ends in stopped or authFailed', () => {
    const machine = new StateMachine(SYNC_SERVICE_LIFECYCLE);
    expect(machine.state).toBe('idle');
    expect(machine.can('pause')).toBe(false);
    expect(machine.send('start')).toBe('running');
    expect(machine.can('start')).toBe(false);
    expect(machine.send('pause')).toBe('idle');
    expect(machine.send('start')).toBe('running');
    expect(machine.send('authFail')).toBe('authFailed');
    expect(() => machine.send('start')).toThrow(InvalidTransitionError);
    expect(() => machine.send('stop')).toThrow(InvalidTransitionError);

    const stopped = new StateMachine(SYNC_SERVICE_LIFECYCLE);
    expect(stopped.send('stop')).toBe('stopped');
    expect(stopped.can('start')).toBe(false);
    expect(stopped.can('authFail')).toBe(false);

    expect(terminalStates(SYNC_SERVICE_LIFECYCLE).sort()).toEqual(['authFailed', 'stopped']);
    expect(reachableStates(SYNC_SERVICE_LIFECYCLE)).toEqual(new Set(['idle', 'running', 'stopped', 'authFailed']));
  });

  it('accepts exactly the declared edges under random event sequences', () => {
    randomEventWalk(SYNC_SERVICE_LIFECYCLE, ['start', 'pause', 'stop', 'authFail'], { seeds: 50, steps: 30 });
  });
});

describe('SyncService lifecycle', () => {
  let tempDir: string;
  let apiClient: SyncApiClient;

  beforeEach(async () => {
    tempDir = await fse.mkdtemp(path.join(os.tmpdir(), 'sync-lifecycle-'));
    apiClient = {
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
    vi.useRealTimers();
    vi.restoreAllMocks();
    await fse.remove(tempDir);
  });

  function createService(onAuthFailure?: () => void): SyncService {
    const service = new SyncService({
      authToken: 'test-token',
      userId: 'test-user',
      config: { enabled: true, interval: 60_000 },
      apiClient,
      onAuthFailure,
    });
    (service as unknown as { basePath: string }).basePath = tempDir;
    vi.spyOn(service as unknown as { syncCodingAgentControlPlane: () => Promise<void> }, 'syncCodingAgentControlPlane')
      .mockResolvedValue(undefined);
    return service;
  }

  it('ends the lifecycle on an authentication failure and ignores later opt-ins', async () => {
    const onAuthFailure = vi.fn();
    const service = createService(onAuthFailure);
    vi.mocked(apiClient.getRemoteManifest).mockRejectedValue(new Error('401 Unauthorized'));

    await expect(service.sync()).resolves.toMatchObject({ error: 'Authentication expired. Please run /login again.' });
    expect(onAuthFailure).toHaveBeenCalledOnce();

    service.start();
    service.setEnabled(true);
    expect(service.isRunning).toBe(false);
    expect((service as unknown as { timer: unknown }).timer).toBeNull();
    await expect(service.sync()).resolves.toMatchObject({ success: false, error: 'Sync service stopped' });
    expect(apiClient.getRemoteManifest).toHaveBeenCalledOnce();
    expect(onAuthFailure).toHaveBeenCalledOnce();
  });

  it('records an opt-in made after stop without restarting the service', async () => {
    const service = createService();
    const sync = vi.spyOn(service, 'sync');
    service.setEnabled(false);
    service.stop();

    service.setEnabled(true);

    expect(service.isRunning).toBe(false);
    expect(sync).not.toHaveBeenCalled();
    expect((service as unknown as { timer: unknown }).timer).toBeNull();
    await expect(service.getStatus()).resolves.toMatchObject({ enabled: true, syncing: false });
  });

  it('reports syncing exactly while an operation is in flight and rejects overlapping ones', async () => {
    const service = createService();
    const manifest = Promise.withResolvers<SyncManifest | null>();
    vi.mocked(apiClient.getRemoteManifest).mockReturnValueOnce(manifest.promise);

    const first = service.sync();
    await vi.waitFor(() => expect(apiClient.getRemoteManifest).toHaveBeenCalledOnce());

    await expect(service.getStatus()).resolves.toMatchObject({ syncing: true });
    await expect(service.sync()).resolves.toMatchObject({ success: false, error: 'Sync already in progress' });

    manifest.resolve(null);
    await first;
    await expect(service.getStatus()).resolves.toMatchObject({ syncing: false });
  });

  it('defers the opt-in sync until a paused operation settles, then runs it once', async () => {
    const service = createService();
    const manifest = Promise.withResolvers<SyncManifest | null>();
    vi.mocked(apiClient.getRemoteManifest)
      .mockReturnValueOnce(manifest.promise)
      .mockResolvedValue(null);

    const first = service.sync();
    await vi.waitFor(() => expect(apiClient.getRemoteManifest).toHaveBeenCalledOnce());
    service.setEnabled(false);
    service.setEnabled(true);
    expect(service.isRunning).toBe(true);
    expect(apiClient.getRemoteManifest).toHaveBeenCalledOnce();

    manifest.resolve(null);
    await expect(first).resolves.toMatchObject({ error: 'Sync service stopped' });
    await vi.waitFor(() => expect(apiClient.getRemoteManifest).toHaveBeenCalledTimes(2));
    await service.shutdown({ timeoutMs: 100 });
    expect(service.isRunning).toBe(false);
    expect(apiClient.getRemoteManifest).toHaveBeenCalledTimes(2);
  });
});
