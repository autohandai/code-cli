/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { sync } from '../../src/commands/sync.js';
import type { SlashCommandContext } from '../../src/core/slashCommandTypes.js';

vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({ auth: { token: 'fixture-token', user: { id: 'fixture-user' } } }),
  saveConfig: vi.fn(),
}));
vi.mock('../../src/sync/runtimeSyncService.js', () => ({ getSyncService: () => null, setSyncService: vi.fn() }));

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
