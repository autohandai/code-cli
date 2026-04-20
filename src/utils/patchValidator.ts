/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Validates and fixes a unified diff patch by correcting hunk header line counts.
 *
 * The `diff` package's parsePatch function throws an error when the line counts
 * in the hunk header (e.g., @@ -1,5 +1,7 @@) don't match the actual number of
 * lines in the hunk. This function fixes those counts.
 *
 * @param patch The unified diff patch string
 * @returns The corrected patch string
 */
export function validateAndFixPatch(patch: string): string {
  const lines = patch.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Check if this is a hunk header
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);

    if (hunkMatch) {
      // Found a hunk header, collect all lines until the next hunk or end
      i++;

      const hunkLines: string[] = [];
      while (i < lines.length) {
        const nextLine = lines[i];
        // Stop at next hunk header, file header, or separator
        if (nextLine.match(/^@@ /) || nextLine.match(/^(---|\+\+\+|Index:|diff\s)/) || nextLine === '===================================================================') {
          break;
        }
        hunkLines.push(nextLine);
        i++;
      }

      // Count actual lines in the hunk
      let oldCount = 0;
      let newCount = 0;

      for (const hunkLine of hunkLines) {
        if (hunkLine.length === 0) continue; // Skip empty lines

        const firstChar = hunkLine[0];
        if (firstChar === '-') {
          oldCount++;
        } else if (firstChar === '+') {
          newCount++;
        } else if (firstChar === ' ' || firstChar === '\t') {
          oldCount++;
          newCount++;
        } else if (firstChar === '\\') {
          // "\ No newline at end of file" - don't count
        } else {
          // Line doesn't start with a valid prefix, treat as context
          oldCount++;
          newCount++;
        }
      }

      // Build the corrected hunk header
      const oldStart = hunkMatch[1];
      const newStart = hunkMatch[3];

      // Format: @@ -oldStart,oldCount +newStart,newCount @@
      let correctedHeader: string;
      if (oldCount === 0) {
        // Special case: if oldCount is 0, we only show the start
        correctedHeader = `@@ -${parseInt(oldStart) + 1} +${newStart},${newCount} @@`;
      } else if (newCount === 0) {
        correctedHeader = `@@ -${oldStart},${oldCount} +${parseInt(newStart) + 1} @@`;
      } else {
        correctedHeader = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
      }

      result.push(correctedHeader);
      result.push(...hunkLines);
    } else {
      // Not a hunk header, just add the line
      result.push(line);
      i++;
    }
  }

  return result.join('\n');
}

/**
 * Strips file headers from a patch to make it suitable for applyPatch.
 * The diff package's applyPatch expects just the hunks, not the file headers.
 *
 * @param patch The unified diff patch string
 * @returns The patch with file headers stripped
 */
export function stripPatchHeaders(patch: string): string {
  const lines = patch.split('\n');
  const result: string[] = [];
  let foundHunk = false;

  for (const line of lines) {
    // Once we find a hunk, include everything from there
    if (line.match(/^@@ /)) {
      foundHunk = true;
    }

    if (foundHunk) {
      result.push(line);
    }
  }

  return result.join('\n');
}