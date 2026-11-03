/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { getSyncService } from '../../src/sync/runtimeSyncService.js';
import { SyncService } from '../../src/sync/SyncService.js';
import { sync } from '../../src/commands/sync.js';
import type { SlashCommandContext } from '../../src/core/slashCommandTypes.js';

vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({ auth: { token: 'fixture-token', user: { id: 'fixture-user' } } }),
  saveConfig: vi.fn(),
}));
vi.mock('../../src/sync/runtimeSyncService.js', () => ({ getSyncService: vi.fn(() => null), setSyncService: vi.fn() }));

describe('sync screen input ownership', () => {
  it('releases stdin when terminal setup fails after taking ownership', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true, isRaw: false, setRawMode: vi.fn(), ref: vi.fn(), unref: vi.fn() });
    const stdin = vi.spyOn(process, 'stdin', 'get').mockReturnValue(input as unknown as NodeJS.ReadStream);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const encoding = vi.spyOn(input, 'setEncoding').mockImplementation(() => { throw new Error('Terminal closed'); });
    try {
      await expect(sync({ workspaceRoot: '/tmp/fixture' } as SlashCommandContext)).rejects.toThrow('Terminal closed');
      expect(input.ref).toHaveBeenCalledOnce();
      expect(input.unref).toHaveBeenCalledOnce();
      expect(input.listenerCount('keypress')).toBe(0);
    } finally {
      encoding.mockRestore(); write.mockRestore(); stdin.mockRestore(); input.destroy();
    }
  });
  it.each([null, false, true])('keeps stdin active from flow state %s and releases its listener on Escape', async initial => {
    const input = Object.assign(new PassThrough(), { isTTY: true, isRaw: false, setRawMode: vi.fn(), ref: vi.fn(), unref: vi.fn() });
    if (initial === false) input.pause();
    if (initial === true) input.resume();
    const stdin = vi.spyOn(process, 'stdin', 'get').mockReturnValue(input as unknown as NodeJS.ReadStream);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    let screen: Promise<string | null> | undefined;
    try {
      screen = sync({ workspaceRoot: '/tmp/fixture' } as SlashCommandContext);
      await vi.waitFor(() => expect(input.listenerCount('keypress')).toBe(1));
      expect(input.readableFlowing).toBe(true);
      expect(input.ref).toHaveBeenCalledOnce();
      input.emit('keypress', '', { name: 'escape' });
      await screen;
      expect(input.listenerCount('keypress')).toBe(0);
      expect(input.readableFlowing).toBe(initial === true);
      expect(input.setRawMode.mock.calls).toEqual([[true], [false]]);
      expect(input.unref).toHaveBeenCalledOnce();
    } finally {
      input.emit('keypress', '', { name: 'escape' });
      await screen;
      log.mockRestore(); write.mockRestore(); stdin.mockRestore(); input.destroy();
    }
  });
});


describe('/sync status', () => {
  it('prints the persisted failure and skipped-session count without opening an input modal', async () => {
    const service = new SyncService({ authToken: 'fixture', userId: 'fixture', config: { enabled: true, interval: 300000 } });
    vi.spyOn(service, 'getStatus').mockResolvedValue({ enabled: true, syncing: false, lastSync: '2026-11-02T23:00:00Z',
      fileCount: 4, totalSize: 100, lastError: '413 Payload too large', failingSince: '2026-11-02T23:00:00Z',
      skipped: { olderSessions: 5, oversizedFiles: 1, incompleteSessions: 0, budgetFiles: 0 } });
    vi.mocked(getSyncService).mockReturnValue(service);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const input = Object.assign(new PassThrough(), { isTTY: false });
    const stdin = vi.spyOn(process, 'stdin', 'get').mockReturnValue(input as unknown as NodeJS.ReadStream);
    try {
      await sync({ workspaceRoot: '/tmp/fixture' } as SlashCommandContext, ['status']);
      const output = log.mock.calls.flat().join('\n');
      expect(output).toContain('413 Payload too large');
      expect(output).toContain('Failing since 2026-11-02T23:00:00Z');
      expect(output).toContain('skipped 5 older sessions');
      expect(input.listenerCount('keypress')).toBe(0);
    } finally { vi.mocked(getSyncService).mockReturnValue(null); stdin.mockRestore(); log.mockRestore(); input.destroy(); }
  });
});
