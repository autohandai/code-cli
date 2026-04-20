/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { validateAndFixPatch, stripPatchHeaders } from '../src/utils/patchValidator.js';

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
    expect(result).toContain('@@ -1 +1,3 @@');
  });

  it('should handle pure deletion', () => {
    const patch = `@@ -1,3 +0,0 @@
-line1
-line2
-line3`;
    const result = validateAndFixPatch(patch);
    expect(result).toContain('@@ -1,3 +1 @@');
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