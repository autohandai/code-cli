/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  resolveAgentLaunchMode,
  resolvePostAuthLaunchMode,
  resolveProtocolLaunchMode,
} from '../../src/startup/modeRouter.js';

describe('CLI mode routing', () => {
  it('routes no-argument launches to the interactive agent', () => {
    expect(resolveProtocolLaunchMode({})).toBe('standard');
    expect(resolvePostAuthLaunchMode({
      argv: [],
      stdinIsTTY: true,
    })).toBe('standard');
    expect(resolveAgentLaunchMode({})).toBe('interactive');
  });

  it('routes prompt launches to command mode', () => {
    expect(resolveAgentLaunchMode({ prompt: 'review this' })).toBe('command');
  });

  it.each([
    ['rpc', 'rpc'],
    ['acp', 'acp'],
    ['interactive', 'standard'],
  ] as const)('routes --mode %s to %s', (mode, expected) => {
    expect(resolveProtocolLaunchMode({ mode })).toBe(expected);
  });

  it('keeps teammate routing ahead of auto-mode routing', () => {
    expect(resolvePostAuthLaunchMode({
      mode: 'teammate',
      autoMode: 'automate this',
      argv: ['--auto-mode'],
      stdinIsTTY: true,
    })).toBe('teammate');
  });

  it('preserves standalone, interactive, and unavailable auto-mode decisions', () => {
    expect(resolvePostAuthLaunchMode({
      autoMode: 'automate this',
      argv: ['--auto-mode'],
      stdinIsTTY: false,
    })).toBe('auto-standalone');
    expect(resolvePostAuthLaunchMode({
      argv: ['--auto-mode'],
      stdinIsTTY: true,
    })).toBe('auto-interactive');
    expect(resolvePostAuthLaunchMode({
      argv: ['--auto-mode'],
      stdinIsTTY: false,
    })).toBe('auto-unavailable');
  });

  it('preserves final agent-mode precedence', () => {
    expect(resolveAgentLaunchMode({
      fork: 'session-id',
      prompt: 'prompt',
      resumeSessionId: 'resume-id',
    })).toBe('fork');
    expect(resolveAgentLaunchMode({
      prompt: 'prompt',
      resumeSessionId: 'resume-id',
    })).toBe('command');
    expect(resolveAgentLaunchMode({ resumeSessionId: 'resume-id' })).toBe('resume');
  });
});
