/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  getDisplayContent,
  getInlineGhostCompletionSuffix,
  getPrimaryHotTipSuggestion,
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
      // 10 lines at 80 width (with 2 char prompt)
      const exactTenLines = 'a'.repeat(78 * 10); // 78 = 80 - 2 (prompt width)
      const result = getDisplayContent(exactTenLines, 80);
      expect(result.totalLines).toBe(10);
      expect(result.isTruncated).toBe(false);
    });

    it('truncates content exceeding MAX_DISPLAY_LINES', () => {
      // 11 lines at 80 width
      const elevenLines = 'a'.repeat(78 * 11);
      const result = getDisplayContent(elevenLines, 80);
      expect(result.isTruncated).toBe(true);
      expect(result.display).toContain('... (');
      expect(result.display).toContain('lines)');
    });

    it('shows end of content when truncating (most recent typing)', () => {
      const text = 'START' + 'x'.repeat(78 * 11) + 'END';
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
      const text = 'a'.repeat(78 * 15); // 15 lines (exceeds MAX_DISPLAY_LINES=10)
      const result = getDisplayContent(text, 80);
      expect(result.display).toContain('... (15 lines)');
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

    it('counts literal newline characters too', () => {
      expect(countNewlineMarkers('line1\nline2')).toBe(1);
      expect(countNewlineMarkers('a\nb\nc')).toBe(2);
    });

    it('counts mixed marker and literal newline forms', () => {
      expect(countNewlineMarkers(`a${NEWLINE_MARKER}b\nc`)).toBe(2);
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

    it('normalizes mixed marker and literal CRLF/LF newlines', () => {
      const input = `a${NEWLINE_MARKER}b\r\nc\rd\ne`;
      expect(convertNewlineMarkersToNewlines(input)).toBe('a\nb\nc\nd\ne');
    });
  });

  describe('MAX_DISPLAY_LINES constant', () => {
    it('is set to 10', () => {
      expect(MAX_DISPLAY_LINES).toBe(10);
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

      const escapedPath = imagePath.replace(/ /g, (value) => `\\${value}`);
      const output = processImagesInText(
        escapedPath,
        (_data, mimeType, filename) => {
          expect(mimeType).toBe('image/png');
          expect(filename).toBe('Screenshot 2026-02-17 at 9.22.22 PM.png');
          return 1;
        },
        { announce: false }
      );

      expect(output).toBe('[Image #1]');
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

      expect(output).toBe('[Image #1] [Image #2]');
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

      const escaped = spacePath.replace(/ /g, (value) => `\\${value}`);
      const input = `${escaped} ${simplePath}`;
      const output = processImagesInText(input, onImage, { announce: false });

      expect(output).toContain('[Image #1]');
      expect(output).toContain('[Image #2]');
      expect(counter).toBe(2);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('replaces escaped paths containing narrow no-break spaces', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autohand-img-u202f-'));
      const filename = 'Screenshot 2026-02-17 at 10.48.54\u202FPM.png';
      const imagePath = path.join(tempDir, filename);
      fs.writeFileSync(imagePath, Buffer.from('fake-u202f'));

      const escapedPath = imagePath.replace(/[ \u202f]/g, (value) => `\\${value}`);
      const output = processImagesInText(
        escapedPath,
        (_data, mimeType, detectedFilename) => {
          expect(mimeType).toBe('image/png');
          expect(detectedFilename).toBe(filename);
          return 1;
        },
        { announce: false }
      );

      expect(output).toBe('[Image #1]');
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

    it('finds file with U+202F when terminal normalizes to regular space', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autohand-img-norm-'));
      // Actual file on disk uses U+202F before PM (macOS Sequoia+)
      const realFilename = 'Screenshot 2026-02-17 at 10.33.32\u202FPM.png';
      const imagePath = path.join(tempDir, realFilename);
      fs.writeFileSync(imagePath, Buffer.from('fake-nnbsp'));

      // Terminal normalizes U+202F to regular space when escaping
      const terminalPath = path.join(tempDir, 'Screenshot 2026-02-17 at 10.33.32 PM.png');
      const escapedPath = terminalPath.replace(/ /g, (v) => `\\${v}`);

      let counter = 0;
      const output = processImagesInText(
        escapedPath,
        (_data, _mime, filename) => {
          expect(filename).toBe(realFilename);
          return ++counter;
        },
        { announce: false }
      );

      expect(output).toContain('[Image #1]');
      expect(counter).toBe(1);
      fs.rmSync(tempDir, { recursive: true, force: true });
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
      const longWord = 'x'.repeat(1000);
      const result = getDisplayContent(longWord, 80);
      expect(result.totalLines).toBeGreaterThan(10);
      expect(result.isTruncated).toBe(true);
    });

    it('truncation indicator does not exceed available space', () => {
      const text = 'a'.repeat(78 * 15); // 15 lines (exceeds MAX_DISPLAY_LINES)
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

  describe('shell command tab suggestions', () => {
    it('suggests shell command completion for ! prefix', () => {
      const suggestion = getPrimaryHotTipSuggestion('!gi', [], []);
      expect(suggestion).toEqual({ line: '! git ', cursor: '! git '.length });
    });

    it('completes cd path using workspace root', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autohand-shell-suggest-'));
      const docsDir = path.join(tempDir, 'docs');
      fs.mkdirSync(docsDir, { recursive: true });

      const suggestion = getPrimaryHotTipSuggestion('! cd do', [], [], undefined, tempDir);
      expect(suggestion).toEqual({ line: '! cd docs/', cursor: '! cd docs/'.length });

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('inline ghost completion', () => {
    it('returns suffix for partial ! command completion', () => {
      const ghost = getInlineGhostCompletionSuffix('! git s', [], []);
      expect(ghost).toBe('tatus');
    });

    it('returns null for non-shell input', () => {
      const ghost = getInlineGhostCompletionSuffix('hello world', [], []);
      expect(ghost).toBeNull();
    });

    it('returns directory suffix for cd path completion', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autohand-shell-ghost-'));
      fs.mkdirSync(path.join(tempDir, 'docs'), { recursive: true });

      const ghost = getInlineGhostCompletionSuffix('! cd do', [], [], tempDir);
      expect(ghost).toBe('cs/');

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('prefers LLM ghost suggestion when it extends current ! input', () => {
      const ghost = getInlineGhostCompletionSuffix(
        '! git s',
        [],
        [],
        undefined,
        '! git status --short'
      );
      expect(ghost).toBe('tatus --short');
    });

    it('falls back to local suggestion when LLM suggestion does not match prefix', () => {
      const ghost = getInlineGhostCompletionSuffix(
        '! git s',
        [],
        [],
        undefined,
        '! bun test'
      );
      expect(ghost).toBe('tatus');
    });
  });
});
