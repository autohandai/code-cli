/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getInlineGhostCompletionSuffix,
  getPrimaryHotTipSuggestion,
  buildPromptHotTips,
  resetCachedSkillMentions,
  NEWLINE_MARKER,
  convertNewlineMarkersToNewlines,
  processImagesInText,
} from '../src/ui/inputPrompt.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('inputPrompt', () => {
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

  describe('skill mention hot tips', () => {
    const sampleSkills = [
      { name: 'code-review', description: 'Review code quality', isActive: true, source: 'user' },
      { name: 'debugger', description: 'Debug issues', isActive: true, source: 'project' },
      { name: 'frontend-design', description: 'Design UIs', isActive: false, source: 'community' },
      { name: 'test-helper', description: 'Write tests', isActive: true, source: 'user' },
    ];

    beforeEach(() => {
      resetCachedSkillMentions();
    });

    it('returns skill suggestions for $ prefix', () => {
      const result = buildPromptHotTips('$co', [], [], undefined, () => sampleSkills);
      expect(result[0]).toEqual({ label: 'Tab -> $code-review' });
    });

    it('returns exact match for $ prefix', () => {
      const result = buildPromptHotTips('$debugger', [], [], undefined, () => sampleSkills);
      expect(result[0]).toEqual({ label: 'Tab -> $debugger' });
    });

    it('returns filter message when no skill matches empty seed', () => {
      const result = buildPromptHotTips('$', [], [], undefined, () => []);
      expect(result[0]).toEqual({ label: 'Type more after $ to filter skills' });
    });

    it('falls back to default tips when no skillsProvider given', () => {
      const result = buildPromptHotTips('$', [], []);
      expect(result.some((t) => t.label === 'Type /, @, or ! to switch suggestion mode')).toBe(true);
    });

    it('works alongside @ mentions in same line', () => {
      const files = ['src/ui/inputPrompt.ts'];
      const result = buildPromptHotTips('@src', files, [], undefined, () => sampleSkills);
      expect(result[0]).toEqual({ label: 'Tab -> @src/ui/inputPrompt.ts' });
    });
  });

  describe('skill tab completion', () => {
    const sampleSkills = [
      { name: 'code-review', description: 'Review code', isActive: true, source: 'user' },
      { name: 'debugger', description: 'Debug issues', isActive: true, source: 'user' },
      { name: 'frontend-design', description: 'Design UIs', isActive: false, source: 'community' },
    ];

    beforeEach(() => {
      resetCachedSkillMentions();
    });

    it('completes skill name with trailing space on Tab', () => {
      const result = getPrimaryHotTipSuggestion('$code', [], [], undefined, undefined, () => sampleSkills);
      expect(result).toEqual({ line: '$code-review ', cursor: '$code-review '.length });
    });

    it('completes exact skill match with trailing space', () => {
      const result = getPrimaryHotTipSuggestion('$debugger', [], [], undefined, undefined, () => sampleSkills);
      expect(result).toEqual({ line: '$debugger ', cursor: '$debugger '.length });
    });

    it('returns null when no skills match', () => {
      const result = getPrimaryHotTipSuggestion('$nonexistent', [], [], undefined, undefined, () => sampleSkills);
      expect(result).toBeNull();
    });

    it('preserves text before $ when completing', () => {
      const result = getPrimaryHotTipSuggestion('hello $code', [], [], undefined, undefined, () => sampleSkills);
      expect(result).toEqual({ line: 'hello $code-review ', cursor: ('hello $code-review ').length });
    });
  });

  describe('skill ghost completion', () => {
    const sampleSkills = [
      { name: 'code-review', description: 'Review code', isActive: true, source: 'user' },
      { name: 'debugger', description: 'Debug issues', isActive: true, source: 'user' },
    ];

    beforeEach(() => {
      resetCachedSkillMentions();
    });

    it('returns ghost text for partial skill match', () => {
      const ghost = getInlineGhostCompletionSuffix('$code', [], [], undefined, undefined, () => sampleSkills);
      expect(ghost).toBe('-review ');
    });

    it('returns null for non-matching skill input', () => {
      const ghost = getInlineGhostCompletionSuffix('$xyz', [], [], undefined, undefined, () => sampleSkills);
      expect(ghost).toBeNull();
    });
  });
});
