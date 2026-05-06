/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Theme, setTheme } from '../../../src/ui/theme/Theme.js';
import { COLOR_TOKENS, type ResolvedColors } from '../../../src/ui/theme/types.js';
import {
  formatStartupBanner,
  formatWelcomeStatusLine,
  formatWelcomeSuggestion,
} from '../../../src/ui/theme/startup.js';

function createColors(overrides: Partial<ResolvedColors> = {}): ResolvedColors {
  const colors = Object.fromEntries(COLOR_TOKENS.map((token) => [token, '#aaaaaa'])) as ResolvedColors;
  return { ...colors, ...overrides };
}

describe('startup theme formatting', () => {
  afterEach(() => {
    setTheme(null as unknown as Theme);
  });

  it('uses theme accent colors for the startup banner', () => {
    setTheme(new Theme('startup-test', createColors({ accent: '#123456', borderAccent: '#abcdef' }), 'truecolor'));

    const banner = formatStartupBanner('one\ntwo');

    expect(banner).toContain('\x1b[38;2;18;52;86mone\x1b[39m');
    expect(banner).toContain('\x1b[38;2;171;205;239mtwo\x1b[39m');
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
});
