/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'tuistory';
import { launchTuistorySession, waitForTerminalScreen } from '../../src/testing/drivers/tuistory-driver.js';

const terminal = vi.hoisted(() => ({
  waitForData: vi.fn<() => Promise<void>>(),
  waitIdle: vi.fn<() => Promise<void>>(),
  close: vi.fn<() => void>(),
}));

vi.mock('tuistory', () => ({
  Session: vi.fn(function () { return terminal; }),
}));

beforeEach(() => {
  terminal.waitForData.mockReset().mockResolvedValue(undefined);
  terminal.waitIdle.mockReset().mockResolvedValue(undefined);
  terminal.close.mockReset();
});

const completed = 'Completed in 0m 4s · 10 tokens  Tip: Review the diff';
const isCompleted = (screen: string): boolean => screen.startsWith('Completed in ');

afterEach(() => {
  vi.useRealTimers();
});

describe('launchTuistorySession', () => {
  it.each(['waitForData', 'waitIdle'] as const)('closes the unregistered terminal when %s rejects', async (phase) => {
    const error = new Error('Terminal startup timed out');
    terminal[phase].mockRejectedValue(error);

    await expect(launchTuistorySession({ command: 'node', args: [], waitForDataTimeout: 100 }))
      .rejects.toBe(error);
    expect(terminal.close).toHaveBeenCalledTimes(1);
  });

  it('transfers a ready terminal to its caller without closing it', async () => {
    const session = await launchTuistorySession({ command: 'node', args: [], waitForDataTimeout: 100 });

    expect(session).toBe(terminal);
    expect(terminal.waitForData).toHaveBeenCalledWith({ timeout: 100 });
    expect(terminal.waitIdle).toHaveBeenCalledTimes(1);
    expect(terminal.close).not.toHaveBeenCalled();
  });

  it('honors callers that deliberately skip startup waiting', async () => {
    await launchTuistorySession({ command: 'node', args: [], waitForData: false });

    expect(terminal.waitForData).not.toHaveBeenCalled();
    expect(terminal.waitIdle).not.toHaveBeenCalled();
    expect(terminal.close).not.toHaveBeenCalled();
  });
});

describe('waitForTerminalScreen', () => {
  it('rechecks the returned frame after Tuistory settles an intervening redraw', async () => {
    const text = vi.fn<Session['text']>()
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce(completed);

    const screen = await waitForTerminalScreen({ text }, { timeout: 100, waitFor: isCompleted });

    expect(screen).toBe(completed);
    expect(text).toHaveBeenCalledTimes(2);
  });

  it('returns a matching frame without another terminal read', async () => {
    const text = vi.fn<Session['text']>().mockResolvedValue(completed);

    await expect(waitForTerminalScreen({ text }, { timeout: 100, waitFor: isCompleted }))
      .resolves.toBe(completed);
    expect(text).toHaveBeenCalledTimes(1);
  });

  it('shares one deadline across redraws and reports the last unmatched screen', async () => {
    vi.useFakeTimers();
    const text = vi.fn<Session['text']>()
      .mockImplementationOnce(async () => {
        vi.advanceTimersByTime(60);
        return 'first redraw';
      })
      .mockImplementationOnce(async () => {
        vi.advanceTimersByTime(40);
        return 'last redraw';
      });

    await expect(waitForTerminalScreen({ text }, { timeout: 100, waitFor: isCompleted }))
      .rejects.toThrow('last redraw');
    expect(text.mock.calls.map(([options]) => options?.timeout)).toEqual([100, 40]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves process-exit errors instead of retrying a dead terminal', async () => {
    const error = new Error('PTY process exited');
    const text = vi.fn<Session['text']>().mockRejectedValue(error);

    await expect(waitForTerminalScreen({ text }, { timeout: 100, waitFor: isCompleted }))
      .rejects.toBe(error);
    expect(text).toHaveBeenCalledTimes(1);
  });
});
