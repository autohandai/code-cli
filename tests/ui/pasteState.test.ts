/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for paste state handling in AgentUI
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getContentDisplay } from '../../src/ui/displayUtils.js';

describe('Paste State Handling', () => {
  describe('getContentDisplay', () => {
    it('should return visual indicator for 5+ line pastes', () => {
      const content = 'line1\nline2\nline3\nline4\nline5';
      const result = getContentDisplay(content);
      
      expect(result.isPasted).toBe(true);
      expect(result.visual).toBe('[Text pasted: 5 lines]');
      expect(result.actual).toBe(content);
    });

    it('should return actual content for small pastes', () => {
      const content = 'line1\nline2\nline3\nline4';
      const result = getContentDisplay(content);
      
      expect(result.isPasted).toBe(false);
      expect(result.visual).toBe(content);
      expect(result.actual).toBe(content);
    });

    it('should handle empty content', () => {
      const result = getContentDisplay('');
      
      expect(result.visual).toBe('');
      expect(result.actual).toBe('');
      expect(result.isPasted).toBe(false);
      expect(result.lineCount).toBe(1);
    });

    it('should handle single line content', () => {
      const content = 'single line';
      const result = getContentDisplay(content);
      
      expect(result.visual).toBe(content);
      expect(result.actual).toBe(content);
      expect(result.isPasted).toBe(false);
      expect(result.lineCount).toBe(1);
    });
  });

  describe('Paste indicator format', () => {
    it('should format indicator with correct line count', () => {
      const lines = Array(25).fill(0).map((_, i) => `line${i + 1}`).join('\n');
      const result = getContentDisplay(lines);
      
      expect(result.visual).toBe('[Text pasted: 25 lines]');
    });

    it('should handle exactly threshold line count', () => {
      // 5 lines is the threshold
      const fiveLines = '1\n2\n3\n4\n5';
      const result = getContentDisplay(fiveLines);
      
      expect(result.isPasted).toBe(true);
      expect(result.visual).toBe('[Text pasted: 5 lines]');
    });

    it('should handle one below threshold', () => {
      // 4 lines is below threshold
      const fourLines = '1\n2\n3\n4';
      const result = getContentDisplay(fourLines);
      
      expect(result.isPasted).toBe(false);
      expect(result.visual).toBe(fourLines);
    });
  });

  describe('Hidden content preservation', () => {
    it('should preserve actual content when indicator shown', () => {
      const code = `function test() {
  return 1;
}

const x = test();`;
      const result = getContentDisplay(code);
      
      // Visual shows indicator
      expect(result.visual).toBe('[Text pasted: 5 lines]');
      
      // Actual preserves original code
      expect(result.actual).toBe(code);
      expect(result.actual).toContain('function test()');
      expect(result.actual).toContain('return 1;');
      expect(result.actual).toContain('const x = test();');
    });

    it('should preserve unicode and special characters', () => {
      const content = 'Hello 世界\nEmoji 🎉\nQuote "test"\nBackslash \\path\nLine 5';
      const result = getContentDisplay(content);
      
      expect(result.actual).toBe(content);
      expect(result.actual).toContain('世界');
      expect(result.actual).toContain('🎉');
      expect(result.actual).toContain('"test"');
      expect(result.actual).toContain('\\path');
    });

    it('should preserve indentation', () => {
      const content = `if (true) {
    console.log("indented");
    if (nested) {
        deeplyNested();
    }
}`;
      const result = getContentDisplay(content);
      
      expect(result.actual).toBe(content);
      expect(result.actual).toContain('    console.log');
      expect(result.actual).toContain('        deeplyNested');
    });
  });
});