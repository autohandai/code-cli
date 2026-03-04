import { describe, it, expect } from 'vitest';
import { drawInputBox } from '../../src/ui/box.js';
import stripAnsi from 'strip-ansi';

/** Extract content between the │ side borders */
function innerContent(value: string): string {
  const plain = stripAnsi(value);
  return plain.slice(1, -1);
}

describe('drawInputBox', () => {
  it('renders left-only content padded to width', () => {
    const result = stripAnsi(drawInputBox('hello', 20));
    expect(result.length).toBe(20);
    expect(result[0]).toBe('│');
    expect(result[result.length - 1]).toBe('│');
    expect(result).toContain('hello');
  });

  it('renders left and right content with gap', () => {
    const result = stripAnsi(drawInputBox('left', 30, 'right'));
    expect(result.length).toBe(30);
    expect(result[0]).toBe('│');
    expect(result[result.length - 1]).toBe('│');
    const inner = innerContent(drawInputBox('left', 30, 'right'));
    expect(inner.startsWith('left')).toBe(true);
    expect(inner.endsWith('right')).toBe(true);
  });

  it('truncates right content when no room', () => {
    const result = stripAnsi(drawInputBox('lefttext', 10, 'rightttx'));
    expect(result.length).toBe(10);
    expect(result[0]).toBe('│');
    expect(result[result.length - 1]).toBe('│');
    expect(innerContent(drawInputBox('lefttext', 10, 'rightttx')).startsWith('lefttext')).toBe(true);
  });

  it('handles empty right gracefully', () => {
    const result = stripAnsi(drawInputBox('status', 40, ''));
    expect(result.length).toBe(40);
    expect(result[0]).toBe('│');
    expect(result[result.length - 1]).toBe('│');
    expect(result).toContain('status');
  });

  it('pads to visible width when left content contains ANSI sequences', () => {
    const styled = '\u001b[31mhello\u001b[39m';
    const result = stripAnsi(drawInputBox(styled, 20));
    expect(result.length).toBe(20);
    expect(result[0]).toBe('│');
    expect(result).toContain('hello');
  });

  it('calculates right clipping using visible width when ANSI is present', () => {
    const left = '\u001b[36mleft\u001b[39m';
    const right = '\u001b[33mright-content\u001b[39m';
    const result = stripAnsi(drawInputBox(left, 16, right));
    expect(result.length).toBe(16);
    expect(result[0]).toBe('│');
    expect(result[result.length - 1]).toBe('│');
    expect(result).toContain('left');
  });
});
