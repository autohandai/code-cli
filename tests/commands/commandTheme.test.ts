/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Theme, setTheme } from '../../src/ui/theme/Theme.js';
import { COLOR_TOKENS, type ResolvedColors } from '../../src/ui/theme/types.js';

function createColors(overrides: Partial<ResolvedColors> = {}): ResolvedColors {
  const colors = Object.fromEntries(COLOR_TOKENS.map((token) => [token, '#aaaaaa'])) as ResolvedColors;
  return { ...colors, ...overrides };
}

describe('command theme formatting', () => {
  afterEach(() => {
    setTheme(null as unknown as Theme);
  });

  it('uses semantic theme tokens for command output helpers', async () => {
    const { createCommandTheme } = await import('../../src/commands/commandTheme.js');
    setTheme(new Theme(
      'command-test',
      createColors({
        accent: '#123456',
        muted: '#667788',
        success: '#00aa44',
        warning: '#f4b95f',
        error: '#e65a4f',
        text: '#f8f8f2',
        userMessageText: '#010203',
      }),
      'truecolor'
    ));

    const theme = createCommandTheme();

    expect(theme.accent('accent')).toContain('\x1b[38;2;18;52;86maccent\x1b[39m');
    expect(theme.muted('muted')).toContain('\x1b[38;2;102;119;136mmuted\x1b[39m');
    expect(theme.success('success')).toContain('\x1b[38;2;0;170;68msuccess\x1b[39m');
    expect(theme.warning('warning')).toContain('\x1b[38;2;244;185;95mwarning\x1b[39m');
    expect(theme.error('error')).toContain('\x1b[38;2;230;90;79merror\x1b[39m');
    expect(theme.selectedTab('Status')).toContain('\x1b[38;2;1;2;3m\x1b[48;2;18;52;86m Status \x1b[0m');
  });

  it('keeps about, sync, and status command colors behind the theme helper', () => {
    for (const file of ['about.ts', 'sync.ts', 'status.ts']) {
      const source = readFileSync(path.resolve(process.cwd(), 'src/commands', file), 'utf8');
      expect(source).toContain('createCommandTheme');
      expect(source).not.toMatch(/chalk\.(cyan|gray|green|yellow|red|white|bgWhite)/);
    }
  });
});
