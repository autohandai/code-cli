/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Integration tests for paste detection
 */
import { describe, it, expect } from 'vitest';
import { getContentDisplay } from '../../src/ui/displayUtils.js';

describe('Paste Integration', () => {
  describe('getContentDisplay', () => {
    it('should handle small paste (4 lines) without indicator', () => {
      const content = 'line1\nline2\nline3\nline4';
      const result = getContentDisplay(content);

      expect(result.visual).toBe(content);
      expect(result.actual).toBe(content);
      expect(result.isPasted).toBe(false);
      expect(result.lineCount).toBe(4);
    });

    it('should handle exactly 5 lines with indicator', () => {
      const content = 'line1\nline2\nline3\nline4\nline5';
      const result = getContentDisplay(content);

      expect(result.visual).toBe('[Text pasted: 5 lines]');
      expect(result.actual).toBe(content);
      expect(result.isPasted).toBe(true);
      expect(result.lineCount).toBe(5);
    });

    it('should handle large paste (10 lines) with indicator', () => {
      const lines = Array(10).fill(0).map((_, i) => `line${i + 1}`).join('\n');
      const result = getContentDisplay(lines);

      expect(result.visual).toBe('[Text pasted: 10 lines]');
      expect(result.actual).toBe(lines);
      expect(result.isPasted).toBe(true);
      expect(result.lineCount).toBe(10);
    });

    it('should handle very large paste (100 lines)', () => {
      const lines = Array(100).fill(0).map((_, i) => `line${i + 1}`).join('\n');
      const result = getContentDisplay(lines);

      expect(result.visual).toBe('[Text pasted: 100 lines]');
      expect(result.actual).toBe(lines);
      expect(result.isPasted).toBe(true);
      expect(result.lineCount).toBe(100);
    });

    it('should handle paste with code content', () => {
      const code = `function hello() {
  console.log("world");
  return 42;
}

const x = hello();`;
      const result = getContentDisplay(code);

      expect(result.visual).toBe('[Text pasted: 6 lines]');
      expect(result.actual).toBe(code);
      expect(result.isPasted).toBe(true);
      expect(result.lineCount).toBe(6);
    });

    it('should preserve special characters in actual content', () => {
      const content = 'line1\nline2 with "quotes"\nline3 with \\backslash\nline4\nline5';
      const result = getContentDisplay(content);

      expect(result.actual).toBe(content);
      expect(result.actual).toContain('"quotes"');
      expect(result.actual).toContain('\\backslash');
    });

    it('should handle empty lines in paste', () => {
      const content = 'line1\n\nline3\n\nline5\n\nline7';
      const result = getContentDisplay(content);

      expect(result.visual).toBe('[Text pasted: 7 lines]');
      expect(result.actual).toBe(content);
      expect(result.lineCount).toBe(7);
    });

    it('should handle JSON content', () => {
      const json = `{
  "name": "test",
  "value": 123,
  "nested": {
    "key": "value"
  }
}`;
      const result = getContentDisplay(json);

      expect(result.visual).toBe('[Text pasted: 7 lines]');
      expect(result.actual).toBe(json);
      // Verify JSON is valid
      expect(() => JSON.parse(result.actual)).not.toThrow();
    });

    it('should handle SQL content', () => {
      const sql = `SELECT
  users.name,
  users.email,
  orders.total
FROM users
JOIN orders ON users.id = orders.user_id
WHERE orders.total > 100;`;
      const result = getContentDisplay(sql);

      expect(result.visual).toBe('[Text pasted: 7 lines]');
      expect(result.actual).toBe(sql);
    });
  });
});
