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

  it('defaults to full screen on interactive streams and honors opt-out', () => {
    expect(shouldUseFullScreen(undefined, true, true, 'xterm')).toBe(true);
    expect(shouldUseFullScreen(false, true, true, 'xterm')).toBe(false);
    expect(shouldUseFullScreen(true, true, true, 'xterm')).toBe(true);
    expect(shouldUseFullScreen(true, false, true, 'xterm')).toBe(false);
    expect(shouldUseFullScreen(true, true, false, 'xterm')).toBe(false);
    expect(shouldUseFullScreen(true, true, true, 'dumb')).toBe(false);
  });
});
