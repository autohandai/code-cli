import { describe, expect, it, vi } from 'vitest';
import { acquireAlternateScreen, shouldUseFullScreen } from '../../../src/ui/terminal/alternateScreen.js';

describe('alternate screen ownership', () => {
  it('keeps nested modals on the same screen and releases the exit handler', () => {
    const write = vi.fn((_text: string) => true);
    const output = { write };
    const before = process.listenerCount('exit');
    const releaseMain = acquireAlternateScreen(output);
    const releaseModal = acquireAlternateScreen(output);
    expect(write.mock.calls.filter(([value]) => String(value).includes('?1049h'))).toHaveLength(1);
    releaseModal();
    expect(write.mock.calls.some(([value]) => String(value).includes('?1049l'))).toBe(false);
    releaseMain(); releaseMain();
    expect(write.mock.calls.filter(([value]) => String(value).includes('?1049l'))).toHaveLength(1);
    expect(process.listenerCount('exit')).toBe(before);
  });

  it('disables terminal auto-wrap while it owns the screen and restores it before leaving', () => {
    const writes: string[] = [];
    const output = { write: (text: string) => { writes.push(text); return true; } };
    const release = acquireAlternateScreen(output);
    const entered = writes.join('');
    expect(entered.indexOf('\x1b[?1049h')).toBeLessThan(entered.indexOf('\x1b[?7l'));
    writes.length = 0;
    release();
    const left = writes.join('');
    expect(left).toContain('\x1b[?7h');
    expect(left.indexOf('\x1b[?7h')).toBeLessThan(left.indexOf('\x1b[?1049l'));
  });

  it('defaults to full screen on interactive streams and honors opt-out', () => {
    expect(shouldUseFullScreen(undefined, true, true, 'xterm')).toBe(true);
    expect(shouldUseFullScreen(false, true, true, 'xterm')).toBe(false);
    expect(shouldUseFullScreen(true, true, true, 'xterm')).toBe(true);
    expect(shouldUseFullScreen(true, false, true, 'xterm')).toBe(false);
    expect(shouldUseFullScreen(true, true, false, 'xterm')).toBe(false);
    expect(shouldUseFullScreen(true, true, true, 'dumb')).toBe(false);
  });
});
