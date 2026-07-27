/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { render } from 'ink-testing-library';
import stringWidth from 'string-width';
import { describe, expect, it } from 'vitest';
import { AnnouncementLine } from '../../../src/ui/ink/AnnouncementLine.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';

function renderLine(props: React.ComponentProps<typeof AnnouncementLine>) {
  return render(
    <ThemeProvider>
      <AnnouncementLine {...props} />
    </ThemeProvider>,
  );
}

describe('AnnouncementLine', () => {
  it('renders announcement text with an intact dismissal hint', () => {
    const { lastFrame } = renderLine({
      text: '◆ Voice dictation is here — Ctrl+V in the composer',
      hint: '^X hide  /whatsnew',
      visible: true,
      columns: 80,
    });
    expect(lastFrame()).toContain('Voice dictation is here');
    expect(lastFrame()).toContain('^X hide  /whatsnew');
  });

  it('colours the announcement and its hint through the theme', () => {
    // Every sibling in the bottom region is themed; an unthemed line renders in
    // the raw terminal colour and ignores the user's theme entirely.
    const { lastFrame } = renderLine({
      text: '◆ Voice dictation is here',
      hint: '^X hide  /whatsnew',
      visible: true,
      columns: 80,
    });
    const frame = lastFrame() ?? '';

    const escapes = frame.match(/\[[0-9;]*m/gu) ?? [];
    expect(escapes.length).toBeGreaterThan(0);
    expect(frame).toContain('Voice dictation is here');
    expect(frame).toContain('^X hide  /whatsnew');
  });

  it('is memoized so the bottom region can re-render on every spinner tick', () => {
    expect((AnnouncementLine as unknown as { $$typeof?: symbol }).$$typeof)
      .toBe(Symbol.for('react.memo'));
  });

  it('truncates only content to display width without splitting wide characters', () => {
    const { lastFrame } = renderLine({
      text: `◆ ${'界'.repeat(30)} 🎙️ details`,
      hint: '^X hide  /whatsnew',
      visible: true,
      columns: 50,
    });
    const frame = lastFrame() ?? '';
    expect(stringWidth(frame)).toBeLessThanOrEqual(50);
    expect(frame).toContain('…');
    expect(frame).toContain('^X hide  /whatsnew');
    expect(frame).not.toContain('\uFFFD');
  });

  it('renders no reserved row when hidden', () => {
    const { lastFrame } = renderLine({
      text: '◆ Hidden', hint: '^X hide', visible: false, columns: 80,
    });
    expect(lastFrame()).toBe('');
  });

  it('drops the hint below 40 columns while keeping the headline', () => {
    const { lastFrame } = renderLine({
      text: '◆ Voice dictation is here',
      hint: '^X hide  /whatsnew',
      visible: true,
      columns: 39,
    });
    expect(lastFrame()).toContain('Voice dictation');
    expect(lastFrame()).not.toContain('^X hide');
  });
});
