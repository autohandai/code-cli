/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { StatusLine } from '../../../src/ui/ink/StatusLine.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';

function renderStatusLine(props: React.ComponentProps<typeof StatusLine>) {
  return render(
    <I18nProvider>
      <ThemeProvider>
        <StatusLine {...props} />
      </ThemeProvider>
    </I18nProvider>
  );
}

describe('StatusLine extensions', () => {
  it('uses the theme ANSI formatter for status segments and separators', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), 'src/ui/ink/StatusLine.tsx'),
      'utf8'
    );

    expect(source).toContain("theme.fg('muted', separator)");
    expect(source).toContain('theme.fg(getSegmentToken(segment.color), segment.text)');
  });

  it('keeps the rotating activity verb in the active status line', () => {
    const { lastFrame } = renderStatusLine({
      isWorking: true,
      status: 'Compiling...',
      elapsed: '5s',
      tokens: '120 tokens',
    });

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Compiling...');
    expect(frame).toContain('5s');
    expect(frame).toContain('120 tokens');
    expect(frame).toContain('esc to cancel');
  });

  it('appends custom status segments after default active-turn chrome', () => {
    const { lastFrame } = renderStatusLine({
      isWorking: true,
      status: 'Working',
      elapsed: '5s',
      tokens: '120 tokens',
      lineExtension: {
        segments: [{ id: 'mode', text: 'plan:on' }],
      },
    });

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Working');
    expect(frame).toContain('5s');
    expect(frame).toContain('120 tokens');
    expect(frame).toContain('plan:on');
  });

  it('can replace default status segments', () => {
    const { lastFrame } = renderStatusLine({
      isWorking: true,
      status: 'Working',
      lineExtension: {
        replaceDefault: true,
        segments: [{ id: 'custom', text: 'custom status' }],
      },
    });

    const frame = lastFrame() ?? '';
    expect(frame).toContain('custom status');
    expect(frame).not.toContain('Working');
  });
});
