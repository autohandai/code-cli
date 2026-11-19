import { afterEach, describe, expect, it, vi } from 'vitest';
import { holdConsoleOutput } from '../../../src/ui/terminal/fullScreenConsole.js';

const METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;

describe('console output while a full-screen frame owns the terminal', () => {
  const originals = Object.fromEntries(METHODS.map(method => [method, console[method]]));
  afterEach(() => {
    for (const method of METHODS) console[method] = originals[method] as typeof console.log;
  });

  it('keeps every console method off the terminal and hands the text to the owner', () => {
    const terminal = Object.fromEntries(METHODS.map(method => [method, vi.fn()]));
    for (const method of METHODS) console[method] = terminal[method] as typeof console.log;
    const held: string[] = [];
    const release = holdConsoleOutput(text => held.push(text));

    // The blank spacer the interactive loop prints after each turn moved the whole frame down a row.
    console.log();
    console.log('Saved %s files', 3);
    console.info('info');
    console.warn('warn');
    console.error(new Error('boom').message);
    console.debug({ nested: true });

    for (const method of METHODS) expect(terminal[method]).not.toHaveBeenCalled();
    expect(held).toEqual(['', 'Saved 3 files', 'info', 'warn', 'boom', '{ nested: true }']);
    release();
  });

  it('gives the console back exactly as it was, once', () => {
    const before = METHODS.map(method => console[method]);
    const release = holdConsoleOutput(() => {});
    expect(METHODS.map(method => console[method])).not.toEqual(before);
    release();
    expect(METHODS.map(method => console[method])).toEqual(before);

    const replaced = vi.fn();
    console.log = replaced;
    release();
    expect(console.log).toBe(replaced);
  });

  it('does not undo a console replacement made after it took hold', () => {
    const release = holdConsoleOutput(() => {});
    const later = vi.fn();
    console.log = later;
    release();
    expect(console.log).toBe(later);
    expect(console.warn).toBe(originals.warn);
  });

  it('never throws into the caller when the owner fails', () => {
    const release = holdConsoleOutput(() => { throw new Error('owner failed'); });
    expect(() => console.log('still safe')).not.toThrow();
    release();
  });
});
