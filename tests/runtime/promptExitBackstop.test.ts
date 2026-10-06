/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { armPromptExitBackstop, PROMPT_EXIT_GRACE_MS } from '../../src/runtime/promptExitBackstop.js';

describe('armPromptExitBackstop', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exits after the grace period when something still holds the event loop', () => {
    vi.useFakeTimers();
    const exit = vi.fn();

    armPromptExitBackstop(PROMPT_EXIT_GRACE_MS, exit);
    vi.advanceTimersByTime(PROMPT_EXIT_GRACE_MS - 1);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(exit).toHaveBeenCalledOnce();
  });

  it('does not itself keep the process alive', () => {
    const timer = armPromptExitBackstop(60_000, () => {});

    expect(timer.hasRef()).toBe(false);
    clearTimeout(timer);
  });
});
