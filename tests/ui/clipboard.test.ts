/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { copyToClipboard, osc52 } from '../../src/ui/clipboard.js';

const decode = (sequence: string) => Buffer.from(/52;c;([^\u0007\u001B]*)/.exec(sequence)?.[1] ?? '', 'base64').toString('utf8');

describe('osc52', () => {
  it('encodes UTF-8 text for the system clipboard', () => {
    const sequence = osc52('héllo ✓ 世界');
    expect(sequence.startsWith('\u001B]52;c;')).toBe(true);
    expect(sequence.endsWith('\u0007')).toBe(true);
    expect(decode(sequence)).toBe('héllo ✓ 世界');
  });

  it('wraps the sequence for tmux passthrough', () => {
    const sequence = osc52('copied', { TMUX: '/tmp/tmux-501/default,1,0' });
    expect(sequence.startsWith('\u001BPtmux;\u001B\u001B]52;c;')).toBe(true);
    expect(sequence.endsWith('\u001B\\')).toBe(true);
    expect(decode(sequence)).toBe('copied');
  });
});

describe('copyToClipboard', () => {
  it('writes OSC 52 and uses pbcopy on a local macOS session', () => {
    const write = vi.fn();
    const pbcopy = vi.fn();
    copyToClipboard('selected text', { write, platform: 'darwin', env: {}, pbcopy });
    expect(decode(write.mock.calls[0][0])).toBe('selected text');
    expect(pbcopy).toHaveBeenCalledWith('selected text');
  });

  it('relies on OSC 52 alone over SSH so the remote clipboard is not touched', () => {
    const write = vi.fn();
    const pbcopy = vi.fn();
    copyToClipboard('remote', { write, platform: 'darwin', env: { SSH_CONNECTION: '1 2 3 4' }, pbcopy });
    expect(write).toHaveBeenCalledOnce();
    expect(pbcopy).not.toHaveBeenCalled();
  });

  it('relies on OSC 52 alone outside macOS', () => {
    const write = vi.fn();
    const pbcopy = vi.fn();
    copyToClipboard('linux', { write, platform: 'linux', env: {}, pbcopy });
    expect(write).toHaveBeenCalledOnce();
    expect(pbcopy).not.toHaveBeenCalled();
  });

  it('ignores empty text', () => {
    const write = vi.fn();
    copyToClipboard('', { write, platform: 'darwin', env: {}, pbcopy: vi.fn() });
    expect(write).not.toHaveBeenCalled();
  });
});
