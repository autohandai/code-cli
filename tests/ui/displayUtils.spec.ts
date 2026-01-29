// tests/ui/displayUtils.spec.ts
import { describe, it, expect } from 'vitest';
import { getContentDisplay } from '../../src/ui/displayUtils.js';

describe('getContentDisplay', () => {
  it('should return content as-is for less than 5 lines', () => {
    const text = 'line1\nline2\nline3\nline4';
    const result = getContentDisplay(text);

    expect(result.visual).toBe(text);
    expect(result.actual).toBe(text);
    expect(result.isPasted).toBe(false);
    expect(result.lineCount).toBe(4);
  });

  it('should show indicator for 5 or more lines', () => {
    const text = 'line1\nline2\nline3\nline4\nline5';
    const result = getContentDisplay(text);

    expect(result.visual).toBe('[Text pasted: 5 lines]');
    expect(result.actual).toBe(text);
    expect(result.isPasted).toBe(true);
    expect(result.lineCount).toBe(5);
  });

  it('should handle single line correctly', () => {
    const text = 'single line';
    const result = getContentDisplay(text);

    expect(result.visual).toBe(text);
    expect(result.actual).toBe(text);
    expect(result.isPasted).toBe(false);
    expect(result.lineCount).toBe(1);
  });

  it('should handle empty string', () => {
    const text = '';
    const result = getContentDisplay(text);

    expect(result.visual).toBe('');
    expect(result.actual).toBe('');
    expect(result.isPasted).toBe(false);
    expect(result.lineCount).toBe(1);
  });

  it('should count lines correctly for large paste', () => {
    const lines = Array(100).fill('line').join('\n');
    const result = getContentDisplay(lines);

    expect(result.visual).toBe('[Text pasted: 100 lines]');
    expect(result.actual).toBe(lines);
    expect(result.isPasted).toBe(true);
    expect(result.lineCount).toBe(100);
  });
});
