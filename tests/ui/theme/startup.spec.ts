/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import stripAnsi from 'strip-ansi';
import { Theme, setTheme } from '../../../src/ui/theme/Theme.js';
import { COLOR_TOKENS, type ResolvedColors } from '../../../src/ui/theme/types.js';
import {
  formatStartupBanner,
  formatPeerSessionsLine,
  formatWelcomeStatusLine,
  formatWelcomeSuggestion,
  formatWelcomeHint,
} from '../../../src/ui/theme/startup.js';

function createColors(overrides: Partial<ResolvedColors> = {}): ResolvedColors {
  const colors = Object.fromEntries(COLOR_TOKENS.map((token) => [token, '#aaaaaa'])) as ResolvedColors;
  return { ...colors, ...overrides };
}

describe('startup theme formatting', () => {
  afterEach(() => {
    setTheme(null as unknown as Theme);
    vi.unstubAllEnvs();
  });

  it('keeps the startup mark monochrome with an inherited foreground', () => {
    const originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    vi.stubEnv('FORCE_COLOR', '3');
    vi.stubEnv('NO_COLOR', undefined);
    vi.stubEnv('TERM', 'xterm-256color');
    try {
      const art = ' .##.\n# @ #';
      const banner = formatStartupBanner(art);
      expect(banner).toBe(art);
      vi.stubEnv('NO_COLOR', '1');
      expect(formatStartupBanner(art)).toBe(art);
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true, writable: true });
    }
  });

  it('uses semantic theme colors for the welcome status line and command suggestions', () => {
    setTheme(new Theme(
      'startup-test',
      createColors({
        accent: '#123456',
        success: '#00aa44',
        muted: '#667788',
      }),
      'truecolor'
    ));

    expect(formatWelcomeStatusLine('model-x', true, '/repo')).toContain('\x1b[38;2;18;52;86mmodel-x\x1b[39m');
    expect(formatWelcomeStatusLine('model-x', true, '/repo')).toContain('\x1b[38;2;0;170;68m[CC: ON]\x1b[39m');

    const suggestion = formatWelcomeSuggestion('/theme', 'change the color theme');
    expect(suggestion).toContain('\x1b[38;2;18;52;86m/theme \x1b[39m');
    expect(suggestion).toContain('\x1b[38;2;102;119;136mchange the color theme\x1b[39m');
  });

  it('formats active peers for the TTY welcome block', () => {
    expect(formatPeerSessionsLine(1)).toContain('1 other session');
    expect(formatPeerSessionsLine(3)).toContain('3 other sessions');
  });

  it('gives the interactive welcome one concise task and command hint', () => {
    const hint = stripAnsi(formatWelcomeHint());
    expect(hint).toBe('Describe a task, or use /help to see commands.');
    expect(hint.split('\n')).toHaveLength(1);
  });
});
