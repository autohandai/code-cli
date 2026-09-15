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

describe('Modal filtering', () => {
  const options = [
    { label: 'parser rewrite', value: 'a', header: 'Today' },
    { label: 'billing bug', value: 'b', header: 'Yesterday' },
    { label: 'parser tests', value: 'c' },
  ];

  it('filters rows by query and hides headings while filtering', async () => {
    const { stdin, lastFrame } = renderModal({
      title: 'Choose', options, filterable: true, onSelect: vi.fn(), onCancel: vi.fn(),
    });

    stdin.write('/');
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write('parser');
    await new Promise((resolve) => setTimeout(resolve, 20));

    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('parser rewrite');
    expect(frame).toContain('parser tests');
    expect(frame).not.toContain('billing bug');
    expect(frame).not.toContain('Today');
  });

  it('selects the highlighted match and reports the original option', async () => {
    const onSelect = vi.fn();
    const { stdin } = renderModal({ title: 'Choose', options, filterable: true, onSelect, onCancel: vi.fn() });

    stdin.write('/');
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write('billing');
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write('\r');

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ value: 'b' }));
  });

  it('restores the full list on escape without cancelling the modal', async () => {
    const onCancel = vi.fn();
    const { stdin, lastFrame } = renderModal({ title: 'Choose', options, filterable: true, onSelect: vi.fn(), onCancel });

    stdin.write('/');
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write('parser');
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write('\x1b');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(stripAnsi(lastFrame() ?? '')).toContain('billing bug');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('says so when nothing matches', async () => {
    const { stdin, lastFrame } = renderModal({ title: 'Choose', options, filterable: true, onSelect: vi.fn(), onCancel: vi.fn() });

    stdin.write('/');
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write('zzz');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(stripAnsi(lastFrame() ?? '')).toContain('No matches for "zzz"');
  });

  it('leaves number shortcuts working when no filter is active', async () => {
    const onSelect = vi.fn();
    const { stdin } = renderModal({ title: 'Choose', options, filterable: true, onSelect, onCancel: vi.fn() });

    stdin.write('2');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ value: 'b' }));
  });
});
