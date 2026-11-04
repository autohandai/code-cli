import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncService } from '../../src/sync/SyncService.js';
import { DEFAULT_SYNC_CONFIG } from '../../src/sync/types.js';
import { scheduleBackgroundSync, setBackgroundSyncEnabled, setSyncService } from '../../src/sync/runtimeSyncService.js';

afterEach(() => { setSyncService(null); vi.useRealTimers(); vi.restoreAllMocks(); });
describe('opt-in background sync', () => {
  it('applies an explicit choice made before startup has registered the service', () => {
    vi.useFakeTimers();
    const service = new SyncService({ authToken: 'fixture', userId: 'fixture', config: { ...DEFAULT_SYNC_CONFIG } });
    vi.spyOn(service, 'sync').mockResolvedValue({ success: true, uploaded: 0, downloaded: 0, conflicts: 0 });
    try {
      setBackgroundSyncEnabled(true); setSyncService(service);
      expect(service.isRunning).toBe(true);
      setBackgroundSyncEnabled(false);
      expect(service.isRunning).toBe(false);
    } finally { service.stop(); }
  });

  it('makes no sync request over ten minutes with the fresh-install defaults', async () => {
    vi.useFakeTimers();
    const service = new SyncService({ authToken: 'fixture', userId: 'fixture', config: { ...DEFAULT_SYNC_CONFIG } });
    const sync = vi.spyOn(service, 'sync').mockResolvedValue({ success: true, uploaded: 0, downloaded: 0, conflicts: 0 });
    try {
      service.start();
      await vi.advanceTimersByTimeAsync(600_000);
      expect(service.isRunning).toBe(false);
      expect(sync).not.toHaveBeenCalled();
    } finally { service.stop(); }
  });
  it('disables a running timer and queued sync immediately, and can opt back in', async () => {
    vi.useFakeTimers();
    const service = new SyncService({ authToken: 'fixture', userId: 'fixture', config: { ...DEFAULT_SYNC_CONFIG, enabled: true } });
    const sync = vi.spyOn(service, 'sync').mockResolvedValue({ success: true, uploaded: 0, downloaded: 0, conflicts: 0 });
    try {
      service.start(); setSyncService(service); scheduleBackgroundSync();
      service.setEnabled(false);
      expect(service.isRunning).toBe(false);
      await vi.advanceTimersByTimeAsync(600_000);
      expect(sync).toHaveBeenCalledTimes(1);
      service.setEnabled(true);
      expect(service.isRunning).toBe(true);
      expect(sync).toHaveBeenCalledTimes(2);
      service.stop(); service.setEnabled(true);
      expect(service.isRunning).toBe(false);
    } finally { service.stop(); }
  });
});
