import { describe, it, expect } from 'vitest';
import { drawInputBox } from '../../src/ui/box.js';
import stripAnsi from 'strip-ansi';

describe('drawInputBox', () => {
  it('renders left-only content padded to width', () => {
    const result = stripAnsi(drawInputBox('hello', 20));
    expect(result.length).toBe(20);
    expect(result.startsWith('hello')).toBe(true);
  });

  it('renders left and right content with gap', () => {
    const result = stripAnsi(drawInputBox('left', 30, 'right'));
    expect(result.length).toBe(30);
    expect(result.startsWith('left')).toBe(true);
    expect(result.endsWith('right')).toBe(true);
  });

  it('truncates right content when no room', () => {
    const result = stripAnsi(drawInputBox('lefttext', 10, 'rightttx'));
    expect(result.length).toBe(10);
    expect(result.startsWith('lefttext')).toBe(true);
  });

  it('handles empty right gracefully', () => {
    const result = stripAnsi(drawInputBox('status', 40, ''));
    expect(result.length).toBe(40);
    expect(result.startsWith('status')).toBe(true);
  });
});
