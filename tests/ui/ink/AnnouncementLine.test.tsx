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

describe('AnnouncementLine', () => {
  it('renders announcement text with an intact dismissal hint', () => {
    const { lastFrame } = render(
      <AnnouncementLine
        text="◆ Voice dictation is here — Ctrl+V in the composer"
        hint="^X hide  /whatsnew"
        visible
        columns={80}
      />,
    );
    expect(lastFrame()).toContain('Voice dictation is here');
    expect(lastFrame()).toContain('^X hide  /whatsnew');
  });

  it('truncates only content to display width without splitting wide characters', () => {
    const { lastFrame } = render(
      <AnnouncementLine
        text={`◆ ${'界'.repeat(30)} 🎙️ details`}
        hint="^X hide  /whatsnew"
        visible
        columns={50}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(stringWidth(frame)).toBeLessThanOrEqual(50);
    expect(frame).toContain('…');
    expect(frame).toContain('^X hide  /whatsnew');
    expect(frame).not.toContain('\uFFFD');
  });

  it('renders no reserved row when hidden', () => {
    const { lastFrame } = render(
      <AnnouncementLine text="◆ Hidden" hint="^X hide" visible={false} columns={80} />,
    );
    expect(lastFrame()).toBe('');
  });

  it('drops the hint below 40 columns while keeping the headline', () => {
    const { lastFrame } = render(
      <AnnouncementLine
        text="◆ Voice dictation is here"
        hint="^X hide  /whatsnew"
        visible
        columns={39}
      />,
    );
    expect(lastFrame()).toContain('Voice dictation');
    expect(lastFrame()).not.toContain('^X hide');
  });
});
