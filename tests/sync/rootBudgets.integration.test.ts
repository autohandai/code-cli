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
  const sync = new SyncService({ authToken: 'fixture-token', userId: 'fixture-user', apiClient: api,
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
  vi.spyOn(api, 'initiateDownload').mockResolvedValue({ success: true, downloadUrls: {} });
  vi.spyOn(api, 'downloadFile').mockResolvedValue(Buffer.from(''));
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

  it('accounts for encrypted config transfer size before deciding whether it fits', async () => {
    await fs.outputJson(path.join(root, 'config.json'), { customApiKey: 'x'.repeat(800) });
    await fs.outputFile(path.join(root, 'skills/small/SKILL.md'), 'Review.');
    const result = await service().sync();
    expect(result.success, result.error).toBe(true);
    expect(result.skipped?.oversizedFiles).toBe(1);
    expect(vi.mocked(api.initiateUpload).mock.calls[0][2]).toEqual(['skills/small/SKILL.md']);
  });

  it('keeps the error visible when its health record cannot be written', async () => {
    await fs.ensureDir(path.join(root, '.sync-state.json'));
    await fs.outputFile(path.join(root, 'skills/large/SKILL.md'), 'x'.repeat(2048));
    vi.mocked(api.getRemoteManifest).mockRejectedValue(new Error('413 Payload too large'));
    const sync = service();
    expect((await sync.sync()).error).toBe('413 Payload too large');
    expect((await sync.getHealth()).lastError).toBe('413 Payload too large');
    expect((await sync.getStatus()).lastError).toBe('413 Payload too large');
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

  it('never replaces an oversized retained local file with an older allowed-size cloud copy', async () => {
    const local = 'new local memory'.repeat(100);
    await fs.outputFile(path.join(root, 'skills/large/SKILL.md'), local);
    vi.mocked(api.getRemoteManifest).mockResolvedValue({ version: 1, userId: 'fixture-user', lastModified: '2020-01-01T00:00:00Z', checksum: 'remote',
      files: [{ path: 'skills/large/SKILL.md', hash: 'old', size: 3, modifiedAt: '2020-01-01T00:00:00Z' }] });
    vi.mocked(api.initiateDownload).mockResolvedValue({ success: true, downloadUrls: { 'skills/large/SKILL.md': 'https://sync.example.invalid/old' } });
    vi.mocked(api.downloadFile).mockResolvedValue(Buffer.from('old'));
    const result = await service().sync();
    expect(result.success).toBe(true);
    expect(await fs.readFile(path.join(root, 'skills/large/SKILL.md'), 'utf8')).toBe(local);
    expect(api.downloadFile).not.toHaveBeenCalled();
  });

  it('protects every file in a budget-skipped local session from older cloud history', async () => {
    for (const [id, activity] of [['older','2026-11-01T00:00:00Z'], ['newer','2026-11-02T00:00:00Z']]) {
      await fs.outputJson(path.join(root, `sessions/${id}/metadata.json`), { sessionId: id, lastActiveAt: activity });
      await fs.outputFile(path.join(root, `sessions/${id}/messages.jsonl`), 'x'.repeat(150));
    }
    const olderPath = 'sessions/older/messages.jsonl';
    vi.mocked(api.getRemoteManifest).mockResolvedValue({ version: 1, userId: 'fixture-user', lastModified: '2020-01-01T00:00:00Z', checksum: 'remote',
      files: [{ path: olderPath, hash: 'old', size: 3, modifiedAt: '2020-01-01T00:00:00Z' }, { path: 'sessions/older/extra.txt', hash: 'old-extra', size: 3, modifiedAt: '2020-01-01T00:00:00Z' }] });
    vi.mocked(api.initiateDownload).mockResolvedValue({ success: true, downloadUrls: { [olderPath]: 'https://sync.example.invalid/old', 'sessions/older/extra.txt': 'https://sync.example.invalid/extra' } });
    vi.mocked(api.downloadFile).mockResolvedValue(Buffer.from('old'));
    const result = await service().sync();
    expect(result.success).toBe(true);
    expect(await fs.readFile(path.join(root, olderPath), 'utf8')).toBe('x'.repeat(150));
    expect(await fs.pathExists(path.join(root, 'sessions/older/extra.txt'))).toBe(false);
    expect(api.downloadFile).not.toHaveBeenCalled();
  });

  it('retains the original success and failure timestamps across repeated control-plane failures', async () => {
    const lastSync = '2026-11-02T23:00:00.000Z';
    await fs.writeJson(path.join(root, '.sync-state.json'), { lastSync, lastManifestHash: 'prior' });
    const notify = vi.fn(); const sync = service(notify);
    vi.mocked(sync as unknown as { syncCodingAgentControlPlane(): Promise<string> }).syncCodingAgentControlPlane.mockResolvedValue('Console unavailable');
    expect((await sync.sync()).success).toBe(false);
    const first = await sync.getHealth();
    expect((await sync.sync()).success).toBe(false);
    expect(await sync.getHealth()).toMatchObject({ lastSync, failingSince: first.failingSince, lastError: 'Console unavailable' });
    expect(first.failingSince).toBe(lastSync);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it.each(['download', 'upload'] as const)('reports omissions from a forced %s, including zero-transfer results', async mode => {
    if (mode === 'download') {
      vi.mocked(api.getRemoteManifest).mockResolvedValue({ version: 1, userId: 'fixture-user', lastModified: '2020-01-01T00:00:00Z', checksum: 'remote', files: [{ path: 'skills/large/SKILL.md', hash: 'old', size: 2048, modifiedAt: '2020-01-01T00:00:00Z' }] });
    } else await fs.outputFile(path.join(root, 'skills/large/SKILL.md'), 'x'.repeat(2048));
    const sync = service(); const result = await (mode === 'download' ? sync.forceDownload() : sync.forceUpload());
    expect(result.success).toBe(true);
    expect((mode === 'download' ? result.remoteSkipped : result.skipped)?.oversizedFiles).toBe(1);
  });

  it('returns persisted failure health even when inventory scanning keeps failing', async () => {
    await fs.ensureDir(path.join(root, 'skills'));
    vi.spyOn(fs, 'readdir').mockRejectedValue(new Error('EACCES fixture'));
    const sync = service();
    expect((await sync.sync()).error).toBe('EACCES fixture');
    expect((await sync.getStatus()).lastError).toBe('EACCES fixture');
    expect(fs.readdir).toHaveBeenCalledTimes(1);
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
