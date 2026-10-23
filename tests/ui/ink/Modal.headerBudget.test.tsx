/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Text } from 'ink';
import stripAnsi from 'strip-ansi';
import { renderInkScreen } from '../../../src/testing/drivers/ink-driver.js';
import { Modal } from '../../../src/ui/ink/components/Modal.js';

const terminal = vi.hoisted(() => ({ output: undefined as unknown }));
vi.mock('ink', async (importOriginal) => ({
  ...await importOriginal<typeof import('ink')>(),
  useStdout: () => ({ stdout: terminal.output }),
}));

class TestTerminal extends EventEmitter {
  columns = 80;
  rows = 24;
  isTTY = true;
}

const hint = '↑↓ Navigate · ↵ Select · 1-9 Shortcut · ESC Cancel';
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 30));
let output: TestTerminal;
let screen: ReturnType<typeof renderInkScreen> | undefined;

beforeEach(() => {
  output = new TestTerminal();
  terminal.output = output;
});

afterEach(async () => {
  screen?.unmount();
  await settle();
  screen = undefined;
});

describe('responsive modal header budget', () => {
  it.each([
    { columns: 26, rows: 16, upgrade: false, expectedRows: 7 },
    { columns: 26, rows: 17, upgrade: true, expectedRows: 6 },
    { columns: 80, rows: 24, upgrade: false, expectedRows: 17 },
  ])('reserves wrapped menu and help rows at $columns×$rows', async ({ columns, rows, upgrade, expectedRows }) => {
    output.columns = columns;
    output.rows = rows;
    const header = vi.fn(({ availableRows }: { availableRows: number }) => <Text>Header budget: {availableRows}</Text>);
    screen = renderInkScreen(<Modal
      title={upgrade ? 'New version available!' : 'Sign in to continue.'}
      header={header}
      hint={hint}
      options={[
        { label: 'Login', value: 'login' },
        ...(upgrade ? [{ label: 'Upgrade (v0.9.0 available)', value: 'upgrade' }] : []),
        { label: 'Exit', value: 'exit' },
      ]}
      onSelect={vi.fn()}
    />);
    await settle();

    expect(header).toHaveBeenLastCalledWith({ availableRows: expectedRows });
    expect(stripAnsi(screen.lastFrame() ?? '')).toContain(`Header budget: ${expectedRows}`);
  });

  it('recomputes the header budget on resize and releases the resize listener', async () => {
    const listenerBaseline = output.listenerCount('resize');
    const header = vi.fn(({ availableRows }: { availableRows: number }) => <Text>{availableRows}</Text>);
    screen = renderInkScreen(<Modal
      title="Sign in to continue."
      header={header}
      hint={hint}
      options={[{ label: 'Login', value: 'login' }, { label: 'Exit', value: 'exit' }]}
      onSelect={vi.fn()}
    />);
    await settle();
    output.columns = 26;
    output.rows = 16;
    output.emit('resize');
    await settle();

    expect(header).toHaveBeenLastCalledWith({ availableRows: 7 });
    screen.unmount();
    await settle();
    expect(output.listenerCount('resize')).toBe(listenerBaseline);
  });

  it('keeps existing React headers intact', async () => {
    screen = renderInkScreen(<Modal
      title="Choose"
      header={<Text>Existing header</Text>}
      options={[{ label: 'Continue', value: 'continue' }]}
      onSelect={vi.fn()}
    />);
    await settle();

    expect(stripAnsi(screen.lastFrame() ?? '')).toContain('Existing header');
  });
});
