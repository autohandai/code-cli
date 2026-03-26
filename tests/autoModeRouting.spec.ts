import { describe, expect, it } from 'vitest';

import { resolveAutoModeLaunchMode } from '../src/modes/autoModeRouting.js';

describe('resolveAutoModeLaunchMode', () => {
  it('uses standalone auto-mode when the flag includes an inline task prompt', () => {
    expect(resolveAutoModeLaunchMode({
      hasAutoModeFlag: true,
      autoModeTask: 'Fix all failing tests',
      prompt: 'ignored prompt',
      stdinIsTTY: true,
    })).toBe('standalone');
  });

  it('uses interactive auto-mode when --auto-mode is present without an inline task and -p is provided', () => {
    expect(resolveAutoModeLaunchMode({
      hasAutoModeFlag: true,
      autoModeTask: undefined,
      prompt: 'check status',
      stdinIsTTY: true,
    })).toBe('interactive');
  });

  it('uses interactive auto-mode when --auto-mode is present without an inline task in a tty session', () => {
    expect(resolveAutoModeLaunchMode({
      hasAutoModeFlag: true,
      autoModeTask: undefined,
      prompt: undefined,
      stdinIsTTY: true,
    })).toBe('interactive');
  });

  it('does not try to start interactive auto-mode without a tty', () => {
    expect(resolveAutoModeLaunchMode({
      hasAutoModeFlag: true,
      autoModeTask: undefined,
      prompt: 'check status',
      stdinIsTTY: false,
    })).toBe('unavailable');
  });

  it('returns disabled when --auto-mode was not requested', () => {
    expect(resolveAutoModeLaunchMode({
      hasAutoModeFlag: false,
      autoModeTask: undefined,
      prompt: 'check status',
      stdinIsTTY: true,
    })).toBe('disabled');
  });
});
