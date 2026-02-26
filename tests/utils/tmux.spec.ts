/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildTmuxLaunchCommand,
  createTmuxSessionName,
  isTmuxEnabled,
  stripTmuxArgs,
} from '../../src/utils/tmux.js';

describe('tmux utils', () => {
  it('detects when tmux is enabled', () => {
    expect(isTmuxEnabled(true)).toBe(true);
    expect(isTmuxEnabled(false)).toBe(false);
    expect(isTmuxEnabled(undefined)).toBe(false);
  });

  it('strips --tmux from argv', () => {
    expect(stripTmuxArgs(['autohand', '--tmux', '--worktree'])).toEqual([
      'autohand',
      '--worktree',
    ]);
  });

  it('strips repeated --tmux args', () => {
    expect(stripTmuxArgs(['autohand', '--tmux', '--prompt', 'x', '--tmux'])).toEqual([
      'autohand',
      '--prompt',
      'x',
    ]);
  });

  it('builds a shell-safe launch command', () => {
    const cmd = buildTmuxLaunchCommand([
      'node',
      'dist/index.js',
      '--tmux',
      '--prompt',
      "fix user's test",
    ]);

    expect(cmd).toContain('AUTOHAND_TMUX_LAUNCHED=1');
    expect(cmd).toContain('node dist/index.js');
    expect(cmd).not.toContain('--tmux');
    expect(cmd).toContain("'fix user'\"'\"'s test'");
  });

  it('creates a stable tmux session name format', () => {
    const name = createTmuxSessionName();
    expect(name).toMatch(/^autohand-[a-z0-9]+-[a-f0-9]{4}$/);
  });

  it('supports custom tmux session name prefixes', () => {
    const name = createTmuxSessionName('mycli');
    expect(name).toMatch(/^mycli-[a-z0-9]+-[a-f0-9]{4}$/);
  });

  it('quotes empty and special args safely', () => {
    const cmd = buildTmuxLaunchCommand([
      'autohand',
      '--tmux',
      '--prompt',
      '',
      'needs spaces',
      '$HOME',
    ]);

    expect(cmd).toContain("''");
    expect(cmd).toContain("'needs spaces'");
    expect(cmd).toContain("'$HOME'");
  });
});
