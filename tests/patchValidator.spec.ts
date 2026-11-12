/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { createTwoFilesPatch } from 'diff';
import { applyValidatedPatch, extractPatchTarget, validateAndFixPatch, stripPatchHeaders } from '../src/utils/patchValidator.js';

describe('applyValidatedPatch', () => {
  it.each([
    ['empty-file creation', '', 'new\n'],
    ['whole-file deletion', 'old\n', ''],
    ['no final newline', 'old', 'new'],
    ['adding a final newline', 'same', 'same\n'],
    ['removing a final newline', 'same\n', 'same'],
    ['Windows line endings', 'old\r\nkeep\r\n', 'new\r\nkeep\r\n'],
    ['header-like source lines', '-- heading\nkeep\n', '++ heading\nkeep\n'],
  ])('preserves standard unified patch semantics for %s', (_name, current, expected) => {
    const patch = createTwoFilesPatch('a/example.txt', 'b/example.txt', current, expected);

    expect(applyValidatedPatch(current, patch)).toBe(expected);
  });

  it('applies distant numbered hunks from a standard generated diff', () => {
    const middle = Array.from({ length: 30 }, (_value, index) => `line ${index}`).join('\n');
    const current = `first\n${middle}\nlast\n`;
    const expected = `updated first\n${middle}\nupdated last\n`;

    expect(applyValidatedPatch(current, createTwoFilesPatch('a/file', 'b/file', current, expected))).toBe(expected);
  });

  it('does not silently ignore changes after an unprefixed blank line and understated counts', () => {
    const current = 'one\n\nthree\n';
    const patch = '@@ -1,1 +1,1 @@\n-one\n+ONE\n\n-three\n+THREE\n';

    expect(applyValidatedPatch(current, patch)).toBe('ONE\n\nTHREE\n');
  });

  it('validates trailing context that an understated header would otherwise leave unparsed', () => {
    const current = 'one\n\ncurrent context\n';
    const patch = '@@ -1,1 +1,1 @@\n-one\n+ONE\n\n stale context\n';

    expect(() => applyValidatedPatch(current, patch)).toThrow(/hunk 1.*could not match/i);
  });

  it('rejects an unanchored insertion into an existing file', () => {
    expect(() => applyValidatedPatch('existing\n', '@@\n+inserted\n')).toThrow(/hunk 1.*include existing lines/i);
  });

  it('rejects multiple unified file patches', () => {
    const patch = createTwoFilesPatch('a/one', 'b/one', 'old\n', 'new\n')
      + createTwoFilesPatch('a/two', 'b/two', 'old\n', 'new\n');

    expect(() => applyValidatedPatch('old\n', patch)).toThrow(/one file/i);
  });
});

describe('extractPatchTarget', () => {
  it('extracts a target only from a single Update File directive', () => {
    expect(extractPatchTarget('*** Begin Patch\n*** Update File: src/file.ts\n@@\n-old\n+new\n*** End Patch'))
      .toBe('src/file.ts');
    expect(extractPatchTarget('--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new')).toBeUndefined();
  });

  it.each(['*** Add File: one', '*** Delete File: one', '*** Move to: two'])('rejects an unsupported file operation: %s', (directive) => {
    expect(() => extractPatchTarget(`*** Begin Patch\n${directive}\n*** End Patch`)).toThrow(/single Update File/i);
  });
});

describe('validateAndFixPatch', () => {
  it('should return unchanged patch if line counts are correct', () => {
    const patch = `@@ -1,3 +1,4 @@
 line1
 line2
+line3
 line4`;
    const result = validateAndFixPatch(patch);
    expect(result).toBe(patch);
  });

  it('should fix incorrect added line count in hunk header', () => {
    // Header says 5 added lines, but there are only 2
    const patch = `@@ -1,3 +1,5 @@
 line1
 line2
+line3
 line4`;
    const result = validateAndFixPatch(patch);
    expect(result).toContain('@@ -1,3 +1,4 @@');
  });

  it('should fix incorrect removed line count in hunk header', () => {
    // Header says 5 removed lines, but there are only 2
    const patch = `@@ -1,5 +1,3 @@
 line1
-line2
 line3
 line4`;
    const result = validateAndFixPatch(patch);
    expect(result).toContain('@@ -1,4 +1,3 @@');
  });

  it('should handle multiple hunks', () => {
    const patch = `@@ -1,5 +1,3 @@
 line1
-line2
 line3
 line4
@@ -10,3 +10,5 @@
 line10
+line11
+line12
 line13`;
    const result = validateAndFixPatch(patch);
    expect(result).toContain('@@ -1,4 +1,3 @@');
    // Second hunk: 2 context + 2 added = 4 new lines, 2 context = 2 old lines
    expect(result).toContain('@@ -10,2 +10,4 @@');
  });

  it('should handle context lines (space prefix)', () => {
    const patch = `@@ -1,10 +1,5 @@
 line1
 line2
+line3
 line4
 line5`;
    const result = validateAndFixPatch(patch);
    // 4 context lines + 1 added = 5 total for new, 4 context = 4 old
    expect(result).toContain('@@ -1,4 +1,5 @@');
  });

  it('should handle deletion lines', () => {
    const patch = `@@ -1,10 +1,3 @@
 line1
-line2
-line3
 line4`;
    const result = validateAndFixPatch(patch);
    // 4 lines total: 2 removed + 2 context
    expect(result).toContain('@@ -1,4 +1,2 @@');
  });

  it('should handle empty patches', () => {
    const patch = '';
    const result = validateAndFixPatch(patch);
    expect(result).toBe('');
  });

  it('should handle patches with file headers', () => {
    const patch = `--- a/file.txt
+++ b/file.txt
@@ -1,5 +1,3 @@
 line1
-line2
 line3
 line4`;
    const result = validateAndFixPatch(patch);
    expect(result).toContain('--- a/file.txt');
    expect(result).toContain('+++ b/file.txt');
    expect(result).toContain('@@ -1,4 +1,3 @@');
  });

  it('should handle \\ No newline at end of file marker', () => {
    const patch = `@@ -1,3 +1,4 @@
 line1
 line2
+line3
 line4
\\ No newline at end of file`;
    const result = validateAndFixPatch(patch);
    // The \ No newline line should not be counted
    expect(result).toContain('@@ -1,3 +1,4 @@');
  });

  it('should handle pure addition (no context before)', () => {
    const patch = `@@ -0,0 +1,3 @@
+line1
+line2
+line3`;
    const result = validateAndFixPatch(patch);
    expect(result).toContain('@@ -0,0 +1,3 @@');
  });

  it('should handle pure deletion', () => {
    const patch = `@@ -1,3 +0,0 @@
-line1
-line2
-line3`;
    const result = validateAndFixPatch(patch);
    expect(result).toContain('@@ -1,3 +0,0 @@');
  });
});

describe('stripPatchHeaders', () => {
  it('should strip file headers and keep hunks', () => {
    const patch = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,4 @@
 line1
 line2
+line3
 line4`;
    const result = stripPatchHeaders(patch);
    expect(result).not.toContain('--- a/file.txt');
    expect(result).not.toContain('+++ b/file.txt');
    expect(result).toContain('@@ -1,3 +1,4 @@');
  });

  it('should return empty string if no hunks', () => {
    const patch = `--- a/file.txt
+++ b/file.txt`;
    const result = stripPatchHeaders(patch);
    expect(result).toBe('');
  });

  it('should handle patches without headers', () => {
    const patch = `@@ -1,3 +1,4 @@
 line1
 line2
+line3
 line4`;
    const result = stripPatchHeaders(patch);
    expect(result).toBe(patch);
  });
});
