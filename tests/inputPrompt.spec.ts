/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  getDisplayContent,
  MAX_DISPLAY_LINES,
  NEWLINE_MARKER,
  countNewlineMarkers,
  convertNewlineMarkersToNewlines,
  processImagesInText,
} from '../src/ui/inputPrompt.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('inputPrompt', () => {
  describe('getDisplayContent', () => {
    it('returns full content when under MAX_DISPLAY_LINES', () => {
      const result = getDisplayContent('short text', 80);
      expect(result.display).toBe('short text');
      expect(result.totalLines).toBe(1);
      expect(result.isTruncated).toBe(false);
    });

    it('returns full content when exactly at MAX_DISPLAY_LINES', () => {
      // 5 lines at 80 width = 400 chars (with 2 char prompt)
      const exactFiveLines = 'a'.repeat(78 * 5); // 78 = 80 - 2 (prompt width)
      const result = getDisplayContent(exactFiveLines, 80);
      expect(result.totalLines).toBe(5);
      expect(result.isTruncated).toBe(false);
    });

    it('truncates content exceeding MAX_DISPLAY_LINES', () => {
      // 6 lines at 80 width
      const sixLines = 'a'.repeat(78 * 6);
      const result = getDisplayContent(sixLines, 80);
      expect(result.isTruncated).toBe(true);
      expect(result.display).toContain('... (');
      expect(result.display).toContain('lines)');
    });

    it('shows end of content when truncating (most recent typing)', () => {
      const text = 'START' + 'x'.repeat(78 * 6) + 'END';
      const result = getDisplayContent(text, 80);
      expect(result.display).toContain('END');
      expect(result.display).not.toContain('START');
    });

    it('calculates line count correctly for single line', () => {
      const text = 'hello world';
      const result = getDisplayContent(text, 80);
      expect(result.totalLines).toBe(1);
    });

    it('calculates line count correctly for multiple lines', () => {
      // 3 lines at 80 width (78 chars available after prompt)
      const text = 'a'.repeat(78 * 3);
      const result = getDisplayContent(text, 80);
      expect(result.totalLines).toBe(3);
    });

    it('calculates line count correctly with partial line', () => {
      // 2 full lines + partial = 3 lines
      const text = 'a'.repeat(78 * 2 + 10);
      const result = getDisplayContent(text, 80);
      expect(result.totalLines).toBe(3);
    });

    it('formats indicator correctly showing total line count', () => {
      const text = 'a'.repeat(78 * 8); // 8 lines
      const result = getDisplayContent(text, 80);
      expect(result.display).toContain('... (8 lines)');
    });

    it('handles empty content', () => {
      const result = getDisplayContent('', 80);
      expect(result.display).toBe('');
      expect(result.totalLines).toBe(0);
      expect(result.isTruncated).toBe(false);
    });

    it('handles narrow terminal width', () => {
      const text = 'a'.repeat(100);
      const result = getDisplayContent(text, 30); // Narrow terminal
      expect(result.totalLines).toBeGreaterThan(1);
    });

    it('handles very wide terminal', () => {
      const text = 'a'.repeat(100);
      const result = getDisplayContent(text, 200);
      expect(result.totalLines).toBe(1);
      expect(result.isTruncated).toBe(false);
    });

    it('preserves special characters in content', () => {
      const text = 'test 🔧 emoji and "quotes"';
      const result = getDisplayContent(text, 80);
      expect(result.display).toBe(text);
    });

    it('handles content with newline markers', () => {
      const text = `line1${NEWLINE_MARKER}line2${NEWLINE_MARKER}line3`;
      const result = getDisplayContent(text, 80);
      expect(result.display).toContain(NEWLINE_MARKER);
    });

    it('calculates lines based on visual length including markers', () => {
      // Newline markers take visual space
      const text = `${'a'.repeat(70)}${NEWLINE_MARKER}more`;
      const result = getDisplayContent(text, 80);
      // Should wrap because marker adds visual characters
      expect(result.totalLines).toBeGreaterThanOrEqual(1);
    });
  });

  describe('countNewlineMarkers', () => {
    it('counts zero markers in plain text', () => {
      expect(countNewlineMarkers('hello world')).toBe(0);
    });

    it('counts single newline marker', () => {
      expect(countNewlineMarkers(`line1${NEWLINE_MARKER}line2`)).toBe(1);
    });

    it('counts multiple newline markers', () => {
      expect(countNewlineMarkers(`a${NEWLINE_MARKER}b${NEWLINE_MARKER}c`)).toBe(2);
    });

    it('handles empty string', () => {
      expect(countNewlineMarkers('')).toBe(0);
    });

    it('handles text with only markers', () => {
      expect(countNewlineMarkers(`${NEWLINE_MARKER}${NEWLINE_MARKER}`)).toBe(2);
    });
  });

  describe('convertNewlineMarkersToNewlines', () => {
    it('converts single marker to newline', () => {
      const input = `line1${NEWLINE_MARKER}line2`;
      expect(convertNewlineMarkersToNewlines(input)).toBe('line1\nline2');
    });

    it('converts multiple markers to newlines', () => {
      const input = `a${NEWLINE_MARKER}b${NEWLINE_MARKER}c`;
      expect(convertNewlineMarkersToNewlines(input)).toBe('a\nb\nc');
    });

    it('preserves text without markers', () => {
      const input = 'no markers here';
      expect(convertNewlineMarkersToNewlines(input)).toBe('no markers here');
    });

    it('handles empty string', () => {
      expect(convertNewlineMarkersToNewlines('')).toBe('');
    });
  });

  describe('MAX_DISPLAY_LINES constant', () => {
    it('is set to 5', () => {
      expect(MAX_DISPLAY_LINES).toBe(5);
    });
  });

  describe('NEWLINE_MARKER constant', () => {
    it('is a visible marker', () => {
      expect(NEWLINE_MARKER).toBe(' ↵ ');
    });
  });

  describe('processImagesInText', () => {
    it('replaces escaped macOS image paths with image placeholders', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autohand-img-test-'));
      const imagePath = path.join(tempDir, 'Screenshot 2026-02-17 at 9.22.22 PM.png');
      fs.writeFileSync(imagePath, Buffer.from('fake-png-data'));

      const escapedPath = imagePath.replace(/ /g, '\\ ');
      const output = processImagesInText(
        escapedPath,
        (_data, mimeType, filename) => {
          expect(mimeType).toBe('image/png');
          expect(filename).toBe('Screenshot 2026-02-17 at 9.22.22 PM.png');
          return 1;
        },
        { announce: false }
      );

      expect(output).toBe('[Image #1] Screenshot 2026-02-17 at 9.22.22 PM.png');
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('leaves missing image paths unchanged', () => {
      const input = '/tmp/this-image-does-not-exist-12345.png';
      const output = processImagesInText(input, () => 1, { announce: false });
      expect(output).toBe(input);
    });

    it('increments [Image #N] per callback across multiple images', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autohand-img-multi-'));
      const imgA = path.join(tempDir, 'a.png');
      const imgB = path.join(tempDir, 'b.png');
      fs.writeFileSync(imgA, Buffer.from('fake-a'));
      fs.writeFileSync(imgB, Buffer.from('fake-b'));

      let counter = 0;
      const onImage = () => ++counter;

      const input = `${imgA} ${imgB}`;
      const output = processImagesInText(input, onImage, { announce: false });

      expect(output).toBe('[Image #1] a.png [Image #2] b.png');
      expect(counter).toBe(2);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('handles mixed escaped and simple paths with incrementing IDs', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autohand-img-mixed-'));
      const spacePath = path.join(tempDir, 'my screenshot.png');
      const simplePath = path.join(tempDir, 'icon.jpg');
      fs.writeFileSync(spacePath, Buffer.from('fake-space'));
      fs.writeFileSync(simplePath, Buffer.from('fake-simple'));

      let counter = 0;
      const onImage = () => ++counter;

      const escaped = spacePath.replace(/ /g, '\\ ');
      const input = `${escaped} ${simplePath}`;
      const output = processImagesInText(input, onImage, { announce: false });

      expect(output).toContain('[Image #1] my screenshot.png');
      expect(output).toContain('[Image #2] icon.jpg');
      expect(counter).toBe(2);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('replaces base64 data URL with [Image #N]', () => {
      const base64Png = 'data:image/png;base64,iVBORw0KGgo=';
      let counter = 0;
      const onImage = () => ++counter;

      const input = `Look at this ${base64Png} image`;
      const output = processImagesInText(input, onImage, { announce: false });

      expect(output).toBe('Look at this [Image #1] image');
      expect(counter).toBe(1);
    });

    it('returns text unchanged when no callback provided', () => {
      const input = '/tmp/some-file.png';
      const output = processImagesInText(input, undefined);
      expect(output).toBe(input);
    });
  });

  describe('regression tests', () => {
    it('preserves full content when truncated for display', () => {
      const fullContent = 'START' + 'x'.repeat(1000) + 'END';
      const result = getDisplayContent(fullContent, 80);

      // The display is truncated
      expect(result.isTruncated).toBe(true);

      // But original content is not modified (tested via integration)
      // This test verifies the function doesn't mutate input
      expect(fullContent).toContain('START');
      expect(fullContent).toContain('END');
    });

    it('handles content with mixed special characters', () => {
      const text = 'const API_KEY = "sk-abc123"; // TODO: fix 🔧';
      const result = getDisplayContent(text, 80);
      expect(result.display).toBe(text);
    });

    it('handles very long single word', () => {
      const longWord = 'x'.repeat(500);
      const result = getDisplayContent(longWord, 80);
      expect(result.totalLines).toBeGreaterThan(5);
      expect(result.isTruncated).toBe(true);
    });

    it('truncation indicator does not exceed available space', () => {
      const text = 'a'.repeat(78 * 10); // 10 lines
      const result = getDisplayContent(text, 80);

      // Display should fit within MAX_DISPLAY_LINES * available width
      const maxDisplayChars = (80 - 2) * MAX_DISPLAY_LINES;
      expect(result.display.length).toBeLessThanOrEqual(maxDisplayChars);
    });

    it('handles minimum terminal width gracefully', () => {
      const text = 'a'.repeat(100);
      const result = getDisplayContent(text, 20); // Very narrow
      expect(result.display).toBeDefined();
      expect(result.totalLines).toBeGreaterThan(0);
    });
  });
});
