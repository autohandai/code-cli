import React from 'react';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from '../../../src/ui/ink/components/Modal.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';

function renderModal(props: React.ComponentProps<typeof Modal>) {
  return render(<ThemeProvider><Modal {...props} /></ThemeProvider>);
}

describe('Modal row numbers', () => {
  it('right-aligns numbers so columns survive two-digit rows', () => {
    const options = Array.from({ length: 12 }, (_, index) => ({
      label: `option ${index}`, value: `v${index}`,
    }));
    const { lastFrame } = renderModal({
      title: 'Choose', options, onSelect: vi.fn(), onCancel: vi.fn(), maxVisible: 12,
    });

    const lines = stripAnsi(lastFrame() ?? '').split('\n');
    const ninth = lines.find((line) => line.includes('option 8')) ?? '';
    const tenth = lines.find((line) => line.includes('option 9')) ?? '';
    expect(ninth.indexOf('option 8')).toBe(tenth.indexOf('option 9'));
  });
});
