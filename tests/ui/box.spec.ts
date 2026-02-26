import { describe, it, expect } from 'vitest';
import { drawInputBox } from '../../src/ui/box.js';
import stripAnsi from 'strip-ansi';

describe('drawInputBox', () => {
  it('renders left-only content padded to width', () => {
    const result = stripAnsi(drawInputBox('hello', 20));
    expect(result.length).toBe(20);
    expect(result.startsWith('│hello')).toBe(true);
    expect(result.endsWith('│')).toBe(true);
  });

  it('renders left and right content with gap', () => {
    const result = stripAnsi(drawInputBox('left', 30, 'right'));
    expect(result.length).toBe(30);
    expect(result.startsWith('│left')).toBe(true);
    expect(result.endsWith('right│')).toBe(true);
  });

  it('truncates right content when no room', () => {
    const result = stripAnsi(drawInputBox('lefttext', 10, 'rightttx'));
    expect(result.length).toBe(10);
    expect(result.startsWith('│left')).toBe(true);
    expect(result.endsWith('│')).toBe(true);
  });

  it('handles empty right gracefully', () => {
    const result = stripAnsi(drawInputBox('status', 40, ''));
    expect(result.length).toBe(40);
    expect(result.startsWith('│status')).toBe(true);
    expect(result.endsWith('│')).toBe(true);
  });

  it('pads to visible width when left content contains ANSI sequences', () => {
    const styled = '\u001b[31mhello\u001b[39m';
    const result = stripAnsi(drawInputBox(styled, 20));
    expect(result.length).toBe(20);
    expect(result.startsWith('│hello')).toBe(true);
    expect(result.endsWith('│')).toBe(true);
  });

  it('calculates right clipping using visible width when ANSI is present', () => {
    const left = '\u001b[36mleft\u001b[39m';
    const right = '\u001b[33mright-content\u001b[39m';
    const result = stripAnsi(drawInputBox(left, 16, right));
    expect(result.length).toBe(16);
    expect(result.startsWith('│left')).toBe(true);
    expect(result.endsWith('│')).toBe(true);
  });
});
