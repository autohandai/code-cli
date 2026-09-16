import React from 'react';
import { EventEmitter } from 'node:events';
import { Console } from 'node:console';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { describe, expect, it, vi } from 'vitest';
import { Modal, showModal } from '../../../src/ui/ink/components/Modal.js';
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

  it('resets the cursor and scroll window on backspace so a grown list keeps a valid highlight', async () => {
    // Reproduction: filter to "bar" (2 matches), move the cursor to the
    // second match, then backspace to "ba" (3 matches). Without a cursor
    // reset the stale index 1 now points at a row that was not visible a
    // keystroke earlier ("foo baz"), and Enter would select the wrong row.
    const rowOptions = [
      { label: 'foo bar', value: 'v1' },
      { label: 'foo baz', value: 'v2' },
      { label: 'qux bar', value: 'v3' },
    ];
    const onSelect = vi.fn();
    const { stdin, lastFrame } = renderModal({
      title: 'Choose', options: rowOptions, filterable: true, onSelect, onCancel: vi.fn(),
    });

    stdin.write('/');
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write('bar');
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write('\x1b[B');
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write('\x7f');
    await new Promise((resolve) => setTimeout(resolve, 20));

    const lines = stripAnsi(lastFrame() ?? '').split('\n');
    const fooBarLine = lines.find((line) => line.includes('foo bar')) ?? '';
    const fooBazLine = lines.find((line) => line.includes('foo baz')) ?? '';
    expect(fooBarLine).toContain('▸');
    expect(fooBazLine).not.toContain('▸');

    stdin.write('\r');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ value: 'v1' }));
  });

  it('filters on searchText when present, ignoring label text outside it', async () => {
    // The picker bakes message count and age into the label itself, so
    // filtering on the label lets column text like "msgs" match every row.
    // searchText lets a caller scope matching to just the meaningful fields.
    const rowOptions = [
      { label: 'Newer project session   4 msgs   2m ago', value: 'a', searchText: 'recent work cli-3' },
      { label: 'Other project session   6 msgs   3d ago', value: 'b', searchText: 'other work elsewhere' },
    ];
    const onSelect = vi.fn();
    const { stdin } = renderModal({
      title: 'Choose', options: rowOptions, filterable: true, onSelect, onCancel: vi.fn(),
    });

    stdin.write('/');
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write('recent');
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write('\r');

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ value: 'a' }));
  });

  it('does not match column text once searchText scopes the query away from the label', async () => {
    const rowOptions = [
      { label: 'Newer project session   4 msgs   2m ago', value: 'a', searchText: 'recent work cli-3' },
      { label: 'Other project session   6 msgs   3d ago', value: 'b', searchText: 'other work elsewhere' },
    ];
    const { stdin, lastFrame } = renderModal({
      title: 'Choose', options: rowOptions, filterable: true, onSelect: vi.fn(), onCancel: vi.fn(),
    });

    stdin.write('/');
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write('msgs');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(stripAnsi(lastFrame() ?? '')).toContain('No matches for "msgs"');
  });

  it('falls back to filtering on label when searchText is absent, unchanged from before', async () => {
    const onSelect = vi.fn();
    const { stdin } = renderModal({ title: 'Choose', options, filterable: true, onSelect, onCancel: vi.fn() });

    stdin.write('/');
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write('billing');
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write('\r');

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ value: 'b' }));
  });

  it('returns the caller\'s original option object on select while filtering, not a stripped copy', async () => {
    // Regression: filtering used to map every option (to drop `header` so a
    // filtered view never shows stale headings), which meant a selected
    // option came back to onSelect as a different object with
    // `header: undefined` — silently changing the callback's contract.
    const original = { label: 'parser rewrite', value: 'a', header: 'Today' };
    const rowOptions = [original, { label: 'billing bug', value: 'b', header: 'Yesterday' }];
    const onSelect = vi.fn();
    const { stdin } = renderModal({
      title: 'Choose', options: rowOptions, filterable: true, onSelect, onCancel: vi.fn(),
    });

    stdin.write('/');
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write('parser');
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write('\r');

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toBe(original);
  });

  it('routes keystrokes to the custom input, not the filter, once "Other" is selected from a filtered list', async () => {
    const onSelect = vi.fn();
    const { stdin, lastFrame } = renderModal({
      title: 'Choose',
      options: [{ label: 'apple', value: 'a' }, { label: 'banana', value: 'b' }],
      allowCustomInput: true,
      filterable: true,
      onSelect,
      onCancel: vi.fn(),
    });

    stdin.write('/');
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write('other');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stripAnsi(lastFrame() ?? '')).toContain('Other');

    stdin.write('\r');
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write('hello');
    await new Promise((resolve) => setTimeout(resolve, 20));

    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('hello');
    expect(frame).not.toContain('/ otherhello');

    stdin.write('\r');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ label: 'hello', value: 'hello' }));
  });
});

// Fakes mirroring ink-testing-library's own Stdin/Stdout/Stderr (same Ink
// version, same event-driven contract), used below to drive the real,
// unmocked `showModal()` end to end without a real terminal attached.
class FakeStdin extends EventEmitter {
  isTTY = true;
  private data: string | null = null;
  setEncoding(): void { /* no-op */ }
  setRawMode(): void { /* no-op */ }
  resume(): void { /* no-op */ }
  pause(): void { /* no-op */ }
  ref(): void { /* no-op */ }
  unref(): void { /* no-op */ }
  // Ink's App component reads via the 'readable' + `.read()` contract
  // (matching a real Readable stream), not raw 'data' events — mirror
  // ink-testing-library's own fake exactly.
  write(data: string): void {
    this.data = data;
    this.emit('readable');
    this.emit('data', data);
  }
  read(): string | null {
    const { data } = this;
    this.data = null;
    return data;
  }
}

class FakeStdout extends EventEmitter {
  isTTY = true;
  columns = 100;
  rows = 40;
  write(): boolean {
    return true;
  }
}

class FakeStderr extends EventEmitter {
  write(): boolean {
    return true;
  }
}

describe('Modal filtering through showModal', () => {
  it('threads filterable from the public showModal() entry point to a working query', async () => {
    // Finding 1 regression: `filterable` must reach the Modal that showModal()
    // renders, not just be accepted on ShowModalOptions. Driving this through
    // showModal() itself (rather than <Modal> directly) is the same path the
    // session-resume picker calls.
    const originalStdin = Object.getOwnPropertyDescriptor(process, 'stdin')!;
    const originalStdout = Object.getOwnPropertyDescriptor(process, 'stdout')!;
    const originalStderr = Object.getOwnPropertyDescriptor(process, 'stderr')!;
    // Vitest replaces the global `console` with its own capture shim, which
    // (unlike Node's real console) has no `.Console` constructor. Ink's
    // default patchConsole:true option needs it to redirect log output while
    // a modal owns the terminal — restore just that constructor for the
    // duration of this real, unmocked render.
    const originalConsoleCtor = (console as unknown as { Console?: unknown }).Console;
    (console as unknown as { Console: unknown }).Console = Console;

    const stdin = new FakeStdin();
    const stdout = new FakeStdout();
    const stderr = new FakeStderr();
    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true });
    Object.defineProperty(process, 'stdout', { value: stdout, configurable: true });
    Object.defineProperty(process, 'stderr', { value: stderr, configurable: true });

    try {
      const options = [
        { label: 'parser rewrite', value: 'a' },
        { label: 'billing bug', value: 'b' },
        { label: 'parser tests', value: 'c' },
      ];

      const resultPromise = showModal({ title: 'Choose', options, filterable: true });

      await new Promise((resolve) => setTimeout(resolve, 20));
      stdin.write('/');
      await new Promise((resolve) => setTimeout(resolve, 20));
      stdin.write('billing');
      await new Promise((resolve) => setTimeout(resolve, 20));
      stdin.write('\r');

      const result = await resultPromise;
      expect(result).toEqual(expect.objectContaining({ value: 'b' }));
    } finally {
      Object.defineProperty(process, 'stdin', originalStdin);
      Object.defineProperty(process, 'stdout', originalStdout);
      Object.defineProperty(process, 'stderr', originalStderr);
      (console as unknown as { Console: unknown }).Console = originalConsoleCtor;
    }
  });
});
