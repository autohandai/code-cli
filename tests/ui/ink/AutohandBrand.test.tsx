import React from 'react';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import stripAnsi from 'strip-ansi';
import { render } from 'ink-testing-library';
import { renderInkScreen } from '../../../src/testing/drivers/ink-driver.js';
import { AutohandBrand } from '../../../src/ui/ink/components/AutohandBrand.js';
import { Modal } from '../../../src/ui/ink/components/Modal.js';

const terminal = vi.hoisted(() => ({ output: undefined as unknown }));
vi.mock('ink', async (importOriginal) => ({
  ...await importOriginal<typeof import('ink')>(),
  useStdout: () => ({ stdout: terminal.output }),
}));

class TestTerminal extends EventEmitter {
  columns = 80;
  rows = 32;
  isTTY = true;
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 30));
let output: TestTerminal;
let screen: ReturnType<typeof render> | undefined;

beforeEach(() => {
  output = new TestTerminal();
  terminal.output = output;
  vi.stubEnv('FORCE_COLOR', '3');
  vi.stubEnv('NO_COLOR', undefined);
  vi.stubEnv('TERM', 'xterm-256color');
  vi.stubEnv('AUTOHAND_REDUCED_MOTION', undefined);
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});

afterEach(async () => {
  screen?.unmount();
  await settle();
  screen = undefined;
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('Autohand branding inside Ink', () => {
  it('renders the brand as the login header while navigation remains responsive', async () => {
    const selected = vi.fn();
    screen = renderInkScreen(<Modal
      title="Sign in to continue."
      header={<AutohandBrand version="v0.8.2" />}
      options={[{ label: 'Login', value: 'login' }, { label: 'Exit', value: 'exit' }]}
      onSelect={selected}
    />);
    await settle();
    expect(stripAnsi(screen.lastFrame() ?? '')).toContain('autohand');
    expect(stripAnsi(screen.lastFrame() ?? '')).toContain('v0.8.2');
    screen.stdin.write('\x1b[B');
    await settle();
    screen.stdin.write('\r');
    await settle();
    expect(selected).toHaveBeenCalledWith({ label: 'Exit', value: 'exit' });
  });

  it('moves the mark inside a stable layout and releases its interval and resize listener on unmount', async () => {
    const timerBaseline = vi.getTimerCount();
    const listenerBaseline = output.listenerCount('resize');
    screen = renderInkScreen(<AutohandBrand version="v0.8.2" />);
    await settle();
    const first = screen.lastFrame() ?? '';
    expect(vi.getTimerCount()).toBe(timerBaseline + 1);
    vi.advanceTimersByTime(800);
    await settle();
    const next = stripAnsi(screen.lastFrame() ?? '');
    expect(next).not.toBe(stripAnsi(first));
    expect(next.split('\n').length).toBe(stripAnsi(first).split('\n').length);
    expect(next.slice(next.indexOf('autohand'))).toBe(stripAnsi(first).slice(stripAnsi(first).indexOf('autohand')));
    screen.unmount();
    await settle();
    expect(vi.getTimerCount()).toBe(timerBaseline);
    expect(output.listenerCount('resize')).toBe(listenerBaseline);
  });

  it('keeps the default identity compact even in a large terminal', async () => {
    output.columns = 160;
    output.rows = 48;
    screen = renderInkScreen(<AutohandBrand version="v0.8.2" />);
    await settle();
    const lines = stripAnsi(screen.lastFrame() ?? '').split('\n');
    expect(lines.length).toBeLessThanOrEqual(15);
    expect(Math.max(...lines.map(line => line.length))).toBeLessThanOrEqual(48);
  });

  it('shrinks the mark on terminal resize with room for the login menu', async () => {
    screen = renderInkScreen(<AutohandBrand version="v0.8.2" reservedRows={8} />);
    await settle();
    output.columns = 28;
    output.rows = 16;
    output.emit('resize');
    await settle();
    const lines = stripAnsi(screen.lastFrame() ?? '').split('\n');
    expect(lines.every((line) => line.length <= 26)).toBe(true);
    expect(lines.length).toBeLessThanOrEqual(8);
    expect(lines.join('\n')).toContain('autohand');
  });

  it.each(['AUTOHAND_REDUCED_MOTION'] as const)('does not allocate animation timers with %s', async (setting) => {
    vi.stubEnv(setting, '1');
    const baseline = vi.getTimerCount();
    screen = renderInkScreen(<AutohandBrand />);
    await settle();
    expect(vi.getTimerCount()).toBe(baseline);
  });

  it('keeps visible frame motion with NO_COLOR and still releases its timer', async () => {
    vi.stubEnv('NO_COLOR', '1');
    const baseline = vi.getTimerCount();
    screen = renderInkScreen(<AutohandBrand />);
    await settle();
    const first = screen.lastFrame();
    vi.advanceTimersByTime(1_000);
    await settle();
    expect(screen.lastFrame()).not.toBe(first);
    expect(screen.lastFrame()).not.toMatch(/\x1b\[[\d;]+m/u);
    screen.unmount();
    await settle();
    expect(vi.getTimerCount()).toBe(baseline);
  });

  it('shows one identity and releases animation when there is no room for the mark', async () => {
    const baseline = vi.getTimerCount();
    screen = renderInkScreen(<AutohandBrand version="v0.8.2" reservedRows={7} />);
    await settle();
    output.columns = 32;
    output.rows = 12;
    output.emit('resize');
    await settle();
    const frame = stripAnsi(screen.lastFrame() ?? '');
    expect(frame.match(/autohand/g)).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(baseline);
    expect(frame.split('\n').length).toBeLessThanOrEqual(5);
  });

  it('respects the space left by a wrapping menu', async () => {
    screen = renderInkScreen(<AutohandBrand version="v0.8.2" availableRows={3} />);
    await settle();
    const lines = stripAnsi(screen.lastFrame() ?? '').split('\n');
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines.join('\n').match(/autohand/g)).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
