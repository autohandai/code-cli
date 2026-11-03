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
import { SyncApiClient, SyncDownloadNotFoundError } from '../../src/sync/SyncApiClient.js';
import { computeHash } from '../../src/sync/encryption.js';
import type { SyncEvent, SyncFileEntry, SyncManifest } from '../../src/sync/types.js';
import * as atomicFiles from '../../src/utils/atomicFile.js';

let root: string;
let api: SyncApiClient;
function service(notify = vi.fn(), onEvent: (event: SyncEvent) => void = vi.fn()) {
  const sync = new SyncService({ authToken: 'fixture-token', userId: 'fixture-user', apiClient: api,
    config: { enabled: true, interval: 300000, sessionsBudgetMb: 300 / (1024 * 1024) }, onSyncFailure: notify, onEvent });
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
  const remoteManifest = (files: SyncFileEntry[]): SyncManifest => ({
    version: 1, userId: 'fixture-user', lastModified: '2026-11-03T00:00:00Z', checksum: 'remote', files,
  });
  const remoteFile = (filePath: string, size = 3): SyncFileEntry => ({
    path: filePath, hash: computeHash('cloud content'), size, modifiedAt: '2020-01-01T00:00:00Z', encrypted: false,
  });

  it('withholds an unavailable cloud session and its index while syncing independent files', async () => {
    await fs.outputJson(path.join(root, 'config.json'), { provider: 'openrouter' });
    const localIndex = { sessions: [], byProject: {} };
    await fs.outputJson(path.join(root, 'sessions/index.json'), localIndex);
    const retained = [
      remoteFile('sessions/missing/metadata.json'),
      remoteFile('sessions/missing/conversation.jsonl'),
      { ...remoteFile('sessions/index.json'), modifiedAt: '2099-01-01T00:00:00Z' },
    ];
    const healthy = remoteFile('skills/healthy/SKILL.md');
    vi.mocked(api.getRemoteManifest).mockResolvedValue(remoteManifest([...retained, healthy]));
    vi.mocked(api.initiateDownload).mockImplementation(async (_token, files) => ({
      downloadUrls: Object.fromEntries(files.map(file => [file, `https://sync.example.invalid/${file}`])),
    }));
    vi.mocked(api.downloadFile).mockImplementation(async url => {
      if (url.endsWith('conversation.jsonl')) throw new SyncDownloadNotFoundError();
      if (url.endsWith('index.json')) return Buffer.from(JSON.stringify({
        sessions: [{ id: 'missing', projectPath: '/project', createdAt: '2026-11-03T00:00:00Z' }],
        byProject: { '/project': ['missing'] },
      }));
      return Buffer.from(url.endsWith('metadata.json') ? '{"sessionId":"missing"}' : 'healthy');
    });
    const sync = service();
    const result = await sync.sync();
    expect(result.success, result.error).toBe(true);
    expect(result.downloaded).toBe(1);
    expect(result.remoteSkipped).toMatchObject({ incompleteSessions: 1, unavailableFiles: 1 });
    expect(await fs.pathExists(path.join(root, 'sessions/missing'))).toBe(false);
    expect(await fs.readJson(path.join(root, 'sessions/index.json'))).toEqual(localIndex);
    expect(await fs.readFile(path.join(root, healthy.path), 'utf8')).toBe('healthy');
    expect(vi.mocked(api.completeUpload).mock.calls[0][1].files).toEqual(expect.arrayContaining(retained));
    expect(vi.mocked(api.initiateUpload).mock.calls[0][2]).toEqual(['config.json']);
    expect((await sync.getHealth()).remoteSkipped).toMatchObject({ unavailableFiles: 1 });
  });

  it('blocks session and index uploads even when a local edit makes the index eligible after downloads', async () => {
    await fs.outputJson(path.join(root, 'config.json'), { provider: 'openrouter' });
    const metadata = '{"sessionId":"shared","summary":"local changes"}';
    await fs.outputFile(path.join(root, 'sessions/shared/metadata.json'), metadata);
    const index = JSON.stringify({ sessions: [], byProject: {} });
    await fs.outputFile(path.join(root, 'sessions/index.json'), index + ' '.repeat(350));
    const retained = [remoteFile('sessions/shared/metadata.json'), remoteFile('sessions/shared/conversation.jsonl'), remoteFile('sessions/index.json')];
    const healthy = remoteFile('skills/healthy/SKILL.md');
    vi.mocked(api.getRemoteManifest).mockResolvedValue(remoteManifest([...retained, healthy]));
    vi.mocked(api.initiateDownload).mockImplementation(async (_token, files) => ({
      downloadUrls: Object.fromEntries(files.map(file => [file, `https://sync.example.invalid/${file}`])),
    }));
    vi.mocked(api.downloadFile).mockImplementation(async url => {
      if (url.endsWith('conversation.jsonl')) throw new SyncDownloadNotFoundError();
      await fs.outputFile(path.join(root, 'sessions/index.json'), index);
      return Buffer.from('healthy');
    });
    const result = await service().sync();
    expect(result.success, result.error).toBe(true);
    expect(await fs.readFile(path.join(root, 'sessions/shared/metadata.json'), 'utf8')).toBe(metadata);
    expect(await fs.readFile(path.join(root, 'sessions/index.json'), 'utf8')).toBe(index);
    expect(vi.mocked(api.initiateUpload).mock.calls[0][2]).toEqual(['config.json']);
    expect(vi.mocked(api.completeUpload).mock.calls[0][1].files).toEqual(expect.arrayContaining(retained));
  });

  it.each([
    ['forceDownload', 'sessions/missing/conversation.jsonl', new SyncDownloadNotFoundError()],
    ['sync', 'skills/missing/SKILL.md', new SyncDownloadNotFoundError()],
    ['sync', 'sessions/missing/conversation.jsonl', new Error('Download failed: 403')],
    ['sync', 'sessions/missing/conversation.jsonl', new Error('Download failed: 500')],
  ] as const)('keeps %s strict for %s with %s', async (mode, filePath, error) => {
    vi.mocked(api.getRemoteManifest).mockResolvedValue(remoteManifest([remoteFile(filePath)]));
    vi.mocked(api.initiateDownload).mockResolvedValue({ downloadUrls: { [filePath]: 'https://sync.example.invalid/file' } });
    vi.mocked(api.downloadFile).mockRejectedValue(error);
    const result = await service()[mode]();
    expect(result.success).toBe(false);
    expect(result.error).toContain(error.message);
    expect(api.completeUpload).not.toHaveBeenCalled();
    expect(await fs.pathExists(path.join(root, filePath))).toBe(false);
  });

  it('does not apply staged session metadata when a later sibling fails with a server error', async () => {
    const files = [remoteFile('sessions/missing/metadata.json'), remoteFile('sessions/missing/conversation.jsonl')];
    vi.mocked(api.getRemoteManifest).mockResolvedValue(remoteManifest(files));
    vi.mocked(api.initiateDownload).mockImplementation(async (_token, paths) => ({
      downloadUrls: Object.fromEntries(paths.map(file => [file, `https://sync.example.invalid/${file}`])),
    }));
    vi.mocked(api.downloadFile).mockImplementation(async url => {
      if (url.endsWith('conversation.jsonl')) throw new Error('Download failed: 500');
      return Buffer.from('{"sessionId":"missing"}');
    });
    const events = vi.fn();
    const result = await service(vi.fn(), events).sync();
    expect(result.success).toBe(false);
    expect(result.downloaded).toBe(0);
    expect(await fs.pathExists(path.join(root, 'sessions/missing'))).toBe(false);
    expect(events).toHaveBeenCalledWith({ type: 'download_error', path: files[1].path, error: 'Download failed: 500' });
  });

  it('discards a staged session when the service stops during its last download', async () => {
    const files = [remoteFile('sessions/stopped/metadata.json'), remoteFile('sessions/stopped/conversation.jsonl')];
    vi.mocked(api.getRemoteManifest).mockResolvedValue(remoteManifest(files));
    vi.mocked(api.initiateDownload).mockImplementation(async (_token, paths) => ({
      downloadUrls: Object.fromEntries(paths.map(file => [file, `https://sync.example.invalid/${file}`])),
    }));
    const sync = service();
    vi.mocked(api.downloadFile).mockImplementation(async url => {
      if (url.endsWith('conversation.jsonl')) sync.stop();
      return Buffer.from('content');
    });
    const result = await sync.sync();
    expect(result.success).toBe(false);
    expect(result.downloaded).toBe(0);
    expect(await fs.pathExists(path.join(root, 'sessions/stopped'))).toBe(false);
    expect(api.completeUpload).not.toHaveBeenCalled();
    expect((await sync.getHealth()).lastSync).toBeNull();
  });

  it.each(['sync', 'forceUpload'] as const)('preserves cloud descriptors for locally omitted session groups during %s', async mode => {
    await fs.outputJson(path.join(root, 'config.json'), { provider: 'openrouter' });
    for (const [id, activity] of [['older', '2026-11-01T00:00:00Z'], ['newer', '2026-11-02T00:00:00Z']]) {
      await fs.outputJson(path.join(root, `sessions/${id}/metadata.json`), { sessionId: id, lastActiveAt: activity });
      await fs.outputFile(path.join(root, `sessions/${id}/messages.jsonl`), 'x'.repeat(150));
    }
    const retained = [remoteFile('sessions/older/messages.jsonl'), remoteFile('sessions/older/extra.txt')];
    vi.mocked(api.getRemoteManifest).mockResolvedValue(remoteManifest(retained));
    const result = await service()[mode]();
    expect(result.success, result.error).toBe(true);
    expect(api.getRemoteManifest).toHaveBeenCalledTimes(1);
    const finalized = vi.mocked(api.completeUpload).mock.calls[0][1];
    expect(finalized.files).toEqual(expect.arrayContaining(retained));
    expect(api.downloadFile).not.toHaveBeenCalled();
    expect(vi.mocked(api.initiateUpload).mock.calls[0][2]).not.toContain(retained[0].path);
    expect(vi.mocked(api.initiateUpload).mock.calls[0][2]).not.toContain(retained[1].path);
  });

  it.each(['sync', 'forceUpload'] as const)('retains remote-only history omitted by its budget during %s', async mode => {
    await fs.outputJson(path.join(root, 'config.json'), { provider: 'openrouter' });
    const retained = { ...remoteFile('sessions/cloud-only/messages.jsonl', 400), encrypted: true };
    vi.mocked(api.getRemoteManifest).mockResolvedValue(remoteManifest([retained]));
    const result = await service()[mode]();
    expect(result.success, result.error).toBe(true);
    expect(vi.mocked(api.completeUpload).mock.calls[0][1].files).toContainEqual(retained);
    expect(vi.mocked(api.initiateUpload).mock.calls[0][2]).toEqual(['config.json']);
    expect(api.downloadFile).not.toHaveBeenCalled();
  });

  it('keeps the actual remote descriptor when a newer cloud conflict cannot transfer within budget', async () => {
    await fs.outputJson(path.join(root, 'config.json'), { provider: 'openrouter' });
    await fs.outputFile(path.join(root, 'sessions/shared/messages.jsonl'), 'local');
    const retained = { ...remoteFile('sessions/shared/messages.jsonl', 400), modifiedAt: '2099-01-01T00:00:00Z' };
    vi.mocked(api.getRemoteManifest).mockResolvedValue(remoteManifest([retained]));
    const result = await service().sync();
    expect(result.success, result.error).toBe(true);
    expect(vi.mocked(api.completeUpload).mock.calls[0][1].files).toContainEqual(retained);
    expect(vi.mocked(api.initiateUpload).mock.calls[0][2]).toEqual(['config.json']);
    expect(await fs.readFile(path.join(root, retained.path), 'utf8')).toBe('local');
  });

  it.each(['sync', 'forceUpload'] as const)('preserves the cloud copy of an oversized local replacement during %s', async mode => {
    await fs.outputJson(path.join(root, 'config.json'), { provider: 'openrouter' });
    await fs.outputFile(path.join(root, 'skills/large/SKILL.md'), 'x'.repeat(2048));
    const retained = remoteFile('skills/large/SKILL.md');
    vi.mocked(api.getRemoteManifest).mockResolvedValue(remoteManifest([retained]));
    const result = await service()[mode]();
    expect(result.success, result.error).toBe(true);
    expect(vi.mocked(api.completeUpload).mock.calls[0][1].files).toContainEqual(retained);
    expect(vi.mocked(api.initiateUpload).mock.calls[0][2]).toEqual(['config.json']);
  });

  it.each(['sync', 'forceUpload'] as const)('fails closed before cloud writes when retained rows exceed the file limit during %s', async mode => {
    await fs.outputJson(path.join(root, 'config.json'), { provider: 'openrouter' });
    const lastSync = '2026-11-02T23:00:00.000Z';
    await fs.writeJson(path.join(root, '.sync-state.json'), { lastSync });
    vi.mocked(api.getRemoteManifest).mockResolvedValue(remoteManifest(Array.from({ length: 5000 }, (_, index) =>
      remoteFile(`sessions/old/file-${index}.jsonl`, 1))));
    const sync = service();
    const result = await sync[mode]();
    expect(result.success).toBe(false);
    expect(result.error).toContain('5000');
    expect(api.initiateUpload).not.toHaveBeenCalled();
    expect(api.completeUpload).not.toHaveBeenCalled();
    expect((await sync.getHealth()).lastSync).toBe(lastSync);
  });

  it.each(['sync', 'forceUpload'] as const)('fails closed before cloud writes when the retained manifest exceeds the byte limit during %s', async mode => {
    await fs.outputJson(path.join(root, 'config.json'), { provider: 'openrouter' });
    vi.spyOn(api, 'limits', 'get').mockReturnValue({ maxFileSize: 1024, maxTotalSize: 500 });
    vi.mocked(api.getRemoteManifest).mockResolvedValue(remoteManifest([remoteFile('sessions/old/messages.jsonl', 490)]));
    const result = await service()[mode]();
    expect(result.success).toBe(false);
    expect(result.error).toContain('500');
    expect(api.initiateUpload).not.toHaveBeenCalled();
    expect(api.completeUpload).not.toHaveBeenCalled();
  });

  it('requires the previous remote inventory before a forced upload can replace its manifest', async () => {
    await fs.outputJson(path.join(root, 'config.json'), { provider: 'openrouter' });
    vi.mocked(api.getRemoteManifest).mockRejectedValue(new Error('Remote inventory unavailable'));
    expect((await service().forceUpload()).error).toBe('Remote inventory unavailable');
    expect(api.initiateUpload).not.toHaveBeenCalled();
    expect(api.completeUpload).not.toHaveBeenCalled();
  });

  it('keeps intentional force-upload deletion of remote-only files that were not omitted by budgets', async () => {
    await fs.outputJson(path.join(root, 'config.json'), { provider: 'openrouter' });
    const removed = remoteFile('skills/removed/SKILL.md');
    vi.mocked(api.getRemoteManifest).mockResolvedValue(remoteManifest([removed]));
    expect((await service().forceUpload()).success).toBe(true);
    expect(vi.mocked(api.completeUpload).mock.calls[0][1].files).not.toContainEqual(removed);
  });

  it('finalizes a forced deletion even when no local files need uploading', async () => {
    vi.mocked(api.getRemoteManifest).mockResolvedValue(remoteManifest([remoteFile('skills/removed/SKILL.md')]));
    expect((await service().forceUpload()).success).toBe(true);
    expect(api.completeUpload).toHaveBeenCalledExactlyOnceWith('fixture-token', expect.objectContaining({ files: [] }), expect.any(AbortSignal));
    expect(api.uploadFile).not.toHaveBeenCalled();
  });

  it('uploads newly eligible local history after a smaller remote session changes budget selection', async () => {
    await fs.outputJson(path.join(root, 'config.json'), { provider: 'openrouter' });
    for (const [id, activity] of [['older', '2026-11-01T00:00:00Z'], ['newer', '2026-11-02T00:00:00Z']]) {
      await fs.outputJson(path.join(root, `sessions/${id}/metadata.json`), { sessionId: id, lastActiveAt: activity });
      await fs.outputFile(path.join(root, `sessions/${id}/messages.jsonl`), 'x'.repeat(150));
    }
    const olderPath = 'sessions/older/messages.jsonl';
    const withheldSibling = remoteFile('sessions/older/extra.txt', 1);
    const remoteNewer = { ...remoteFile('sessions/newer/messages.jsonl'), hash: computeHash('old'), modifiedAt: '2099-01-01T00:00:00Z' };
    vi.mocked(api.getRemoteManifest).mockResolvedValue(remoteManifest([remoteFile(olderPath), remoteNewer, withheldSibling]));
    vi.mocked(api.initiateDownload).mockResolvedValue({ downloadUrls: { [remoteNewer.path]: 'https://sync.example.invalid/newer' } });
    vi.mocked(api.downloadFile).mockResolvedValue(Buffer.from('old'));
    const result = await service().sync();
    expect(result.success, result.error).toBe(true);
    expect(vi.mocked(api.initiateUpload).mock.calls[0][2]).toEqual(expect.arrayContaining([
      olderPath, 'sessions/older/metadata.json',
    ]));
    expect(vi.mocked(api.completeUpload).mock.calls[0][1].files).toContainEqual(expect.objectContaining({
      path: olderPath, hash: computeHash('x'.repeat(150)), size: 150,
    }));
    expect(vi.mocked(api.completeUpload).mock.calls[0][1].files).toContainEqual(withheldSibling);
    expect(await fs.pathExists(path.join(root, withheldSibling.path))).toBe(false);
  });

  it('uses the actual uploaded descriptor when force upload replaces a newer budget-skipped remote version', async () => {
    const filePath = 'sessions/shared/messages.jsonl';
    await fs.outputFile(path.join(root, filePath), 'local');
    const remote = { ...remoteFile(filePath, 400), modifiedAt: '2099-01-01T00:00:00Z' };
    vi.mocked(api.getRemoteManifest).mockResolvedValue(remoteManifest([remote]));
    expect((await service().forceUpload()).success).toBe(true);
    expect(vi.mocked(api.completeUpload).mock.calls[0][1].files).toContainEqual(expect.objectContaining({
      path: filePath, hash: computeHash('local'), size: 5,
    }));
  });

  it.each(['forceUpload', 'forceDownload'] as const)('clears persisted and live failure after successful %s, including zero transfers', async mode => {
    const lastSync = '2020-01-01T00:00:00.000Z';
    await fs.writeJson(path.join(root, '.sync-state.json'), { lastSync, lastError: 'Prior failure', failingSince: lastSync });
    const sync = service();
    vi.mocked(api.getRemoteManifest).mockRejectedValueOnce(new Error('Current failure'));
    expect((await sync.sync()).success).toBe(false);
    vi.mocked(api.getRemoteManifest).mockResolvedValue(remoteManifest([]));
    expect((await sync[mode]()).success).toBe(true);
    const health = await sync.getHealth();
    expect(health.lastError).toBeUndefined();
    expect(health.failingSince).toBeUndefined();
    expect(Date.parse(health.lastSync!)).toBeGreaterThan(Date.parse(lastSync));
    const persisted = await fs.readJson(path.join(root, '.sync-state.json'));
    expect(persisted.lastError).toBeUndefined();
  });

  it('does not publish a forced manifest after shutdown while the remote inventory is pending', async () => {
    const previous = { lastSync: '2020-01-01T00:00:00.000Z', lastError: 'Prior failure' };
    await fs.writeJson(path.join(root, '.sync-state.json'), previous);
    await fs.outputJson(path.join(root, 'config.json'), { provider: 'openrouter' });
    const pending = Promise.withResolvers<SyncManifest | null>();
    vi.mocked(api.getRemoteManifest).mockReturnValue(pending.promise);
    const sync = service();
    const operation = sync.forceUpload();
    await vi.waitFor(() => expect(api.getRemoteManifest).toHaveBeenCalledOnce());
    sync.stop();
    pending.resolve(null);
    expect(await operation).toMatchObject({ success: false, error: expect.stringMatching(/stopped/i) });
    expect(api.initiateUpload).not.toHaveBeenCalled();
    expect(api.completeUpload).not.toHaveBeenCalled();
    expect(await fs.readJson(path.join(root, '.sync-state.json'))).toEqual(previous);
  });

  it.each(['forceUpload', 'forceDownload'] as const)('preserves previous health if %s is stopped before its atomic success commit', async mode => {
    const previous = { lastSync: '2020-01-01T00:00:00.000Z', lastError: 'Prior failure' };
    await fs.writeJson(path.join(root, '.sync-state.json'), previous);
    vi.mocked(api.getRemoteManifest).mockResolvedValue(remoteManifest([]));
    const sync = service();
    const write = atomicFiles.atomicWriteJson;
    const commit = vi.spyOn(atomicFiles, 'atomicWriteJson').mockImplementation(async (file, value, options) => {
      sync.stop();
      return write(file, value, options);
    });
    vi.useFakeTimers();
    const timers = vi.getTimerCount();
    try {
      expect(await sync[mode]()).toMatchObject({ success: false, error: expect.stringMatching(/stopped/i) });
      expect(commit).toHaveBeenCalledOnce();
      expect(await fs.readJson(path.join(root, '.sync-state.json'))).toEqual(previous);
      expect((await sync.getHealth()).lastError).toBe(previous.lastError);
      expect((await fs.readdir(root)).some(file => file.endsWith('.tmp'))).toBe(false);
      expect(vi.getTimerCount()).toBe(timers);
    } finally {
      vi.useRealTimers();
    }
  });

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
