/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { MessageTargetDropdown } from '../../../src/ui/ink/MessageTargetDropdown.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';

const suggestions = [
  { alias: ':reviewer', label: 'reviewer', detail: 'reviewer · Review the diff', kind: 'run' as const, messageable: true },
  { alias: ':peer-abcdef12', label: 'Session abcdef12', detail: 'peer session · cli · moa', kind: 'peer' as const, messageable: false, reason: 'cannot receive messages yet' },
];

describe('MessageTargetDropdown', () => {
  it('renders aliases with availability markers and the selected pointer', () => {
    const { lastFrame } = render(
      <ThemeProvider>
        <MessageTargetDropdown suggestions={suggestions} activeIndex={1} visible />
      </ThemeProvider>,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain(':reviewer ●');
    expect(frame).toContain('▸ :peer-abcdef12 ○');
    expect(frame).toContain('peer session');
    expect(frame).toContain('Tab to accept');
  });

  it('renders nothing when hidden or empty', () => {
    const hidden = render(<ThemeProvider><MessageTargetDropdown suggestions={suggestions} activeIndex={0} visible={false} /></ThemeProvider>);
    expect((hidden.lastFrame() ?? '').trim()).toBe('');
    const empty = render(<ThemeProvider><MessageTargetDropdown suggestions={[]} activeIndex={0} visible /></ThemeProvider>);
    expect((empty.lastFrame() ?? '').trim()).toBe('');
  });
});
