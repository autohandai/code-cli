/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { SyncService } from '../../src/sync/SyncService.js';
import { SyncApiClient } from '../../src/sync/SyncApiClient.js';

let root: string;
let api: SyncApiClient;
function service(notify = vi.fn()) {
  const sync = new SyncService({ authToken: 'fixture', userId: 'fixture-user', apiClient: api,
    config: { enabled: true, interval: 300000, sessionsBudgetMb: 300 / (1024 * 1024) }, onSyncFailure: notify });
  Object.defineProperty(sync, 'basePath', { value: root });
  vi.spyOn(sync as unknown as { syncCodingAgentControlPlane(): Promise<undefined> }, 'syncCodingAgentControlPlane').mockResolvedValue(undefined);
  return sync;
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-root-budget-'));
  api = new SyncApiClient({ baseUrl: 'https://sync.example.invalid', maxFileSize: 1024 });
  vi.spyOn(api, 'getRemoteManifest').mockResolvedValue(null);
  vi.spyOn(api, 'initiateUpload').mockImplementation(async (_token, _manifest, files) => ({ success: true,
    uploadUrls: Object.fromEntries(files.map(file => [file, `https://sync.example.invalid/${file}`])) }));
  vi.spyOn(api, 'uploadFile').mockResolvedValue(undefined);
  vi.spyOn(api, 'completeUpload').mockResolvedValue({ success: true, uploaded: 0, downloaded: 0, conflicts: 0 });
});
afterEach(async () => { vi.restoreAllMocks(); await fs.remove(root); });

describe('settings sync budget and health integration', () => {
  it('uploads config, skills and memory with the newest session, retaining skipped history on disk', async () => {
    await fs.outputJson(path.join(root, 'config.json'), { provider: 'openrouter' });
    await fs.outputFile(path.join(root, 'skills/review/SKILL.md'), 'Review tests.');
    await fs.outputFile(path.join(root, 'memory/convention.md'), 'Prefer pnpm.');
    for (const [id, activity] of [['older','2026-11-01T00:00:00Z'], ['newer','2026-11-02T00:00:00Z']]) {
      await fs.outputJson(path.join(root, `sessions/${id}/metadata.json`), { sessionId: id, lastActiveAt: activity });
      await fs.outputFile(path.join(root, `sessions/${id}/messages.jsonl`), 'x'.repeat(150));
    }
    const sync = service();
    const result = await sync.sync();
    expect(result.success).toBe(true);
    const manifest = vi.mocked(api.initiateUpload).mock.calls[0][1];
    const paths = manifest.files.map(file => file.path);
    expect(paths).toEqual(expect.arrayContaining(['config.json','skills/review/SKILL.md','memory/convention.md','sessions/newer/metadata.json','sessions/newer/messages.jsonl']));
    expect(paths.some(file => file.startsWith('sessions/older/'))).toBe(false);
    expect(result.skipped?.olderSessions).toBe(1);
    expect(await fs.pathExists(path.join(root, 'sessions/older/messages.jsonl'))).toBe(true);
    expect((await sync.getStatus()).skipped?.olderSessions).toBe(1);
    expect((await sync.getStatus()).lastSync).not.toBeNull();
  });

  it('skips a single oversized artifact without reading it or blocking config upload', async () => {
    await fs.outputJson(path.join(root, 'config.json'), { provider: 'openrouter' });
    await fs.outputFile(path.join(root, 'skills/huge/SKILL.md'), 'x'.repeat(2048));
    const read = vi.spyOn(fs, 'readFile');
    const result = await service().sync();
    expect(result.success).toBe(true);
    expect(result.skipped?.oversizedFiles).toBe(1);
    expect(vi.mocked(api.initiateUpload).mock.calls[0][2]).toEqual(['config.json']);
    expect(read.mock.calls.some(([file]) => String(file).endsWith('huge/SKILL.md'))).toBe(false);
  });

  it('notifies once for repeated failures, preserves the last success, and clears health on recovery', async () => {
    const lastSync = '2026-11-02T23:00:00.000Z';
    await fs.writeJson(path.join(root, '.sync-state.json'), { lastSync, lastManifestHash: 'prior' });
    vi.mocked(api.getRemoteManifest).mockRejectedValue(new Error('413 Payload too large'));
    const notify = vi.fn(); const sync = service(notify);
    expect((await sync.sync()).success).toBe(false);
    expect((await sync.sync()).success).toBe(false);
    expect(notify).toHaveBeenCalledExactlyOnceWith('413 Payload too large');
    expect(await sync.getHealth()).toMatchObject({ lastSync, lastError: '413 Payload too large', failingSince: lastSync });
    vi.mocked(api.getRemoteManifest).mockResolvedValue(null);
    expect((await sync.sync()).success).toBe(true);
    expect((await sync.getHealth()).lastError).toBeUndefined();
  });

  it('does not let a malformed old health record hide the original failure', async () => {
    await fs.writeJson(path.join(root, '.sync-state.json'), null);
    vi.mocked(api.getRemoteManifest).mockRejectedValue(new Error('413 Payload too large'));
    const notify = vi.fn(); const sync = service(notify);
    expect((await sync.sync()).error).toBe('413 Payload too large');
    expect(notify).toHaveBeenCalledExactlyOnceWith('413 Payload too large');
    expect((await sync.getHealth()).lastError).toBe('413 Payload too large');
  });

  it('records an authentication failure before stopping, with only one pause notification', async () => {
    vi.mocked(api.getRemoteManifest).mockRejectedValue(new Error('401 Unauthorized'));
    const notify = vi.fn(); const sync = service(notify);
    expect((await sync.sync()).success).toBe(false);
    expect(notify).toHaveBeenCalledExactlyOnceWith('401 Unauthorized');
    expect((await sync.getHealth()).lastError).toBe('401 Unauthorized');
    expect(sync.isRunning).toBe(false);
  });
});
