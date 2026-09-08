import { describe, expect, it } from 'vitest';
import { CommandOutputCapture } from '../../src/utils/commandOutputCapture.js';

describe('CommandOutputCapture', () => {
  it.each([0, 1, 2.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid capture limit %s', (limit) => {
    expect(() => new CommandOutputCapture(limit)).toThrow(RangeError);
  });

  it('retains exact text until the capture limit is reached', () => {
    const capture = new CommandOutputCapture(8);
    capture.append('abc');
    capture.append('defgh');

    expect(capture.toString()).toBe('abcdefgh');
  });

  it('keeps a bounded head and rolling tail with an accurate omission count', () => {
    const capture = new CommandOutputCapture(8);
    capture.append('abcdefghij');
    capture.append('klmnop');

    expect(capture.toString()).toBe('abcd\n[output truncated: 8 characters omitted]\nmnop');
    expect(capture.length).toBe(16);
  });

  it('does not split surrogate pairs at either truncation boundary', () => {
    const capture = new CommandOutputCapture(8);
    capture.append('abc🌍123🌍xyz');

    expect(capture.toString()).toBe('abc\n[output truncated: 7 characters omitted]\nxyz');
  });
});
