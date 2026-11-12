/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { applyPatch, parsePatch, type StructuredPatchHunk } from 'diff';

interface PatchEnvelope {
  body: string;
  target?: string;
}

const NUMBERED_HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const HUNK_HEADER = /^@@(?:\s|$)/;

function unwrapPatchEnvelope(patch: string): PatchEnvelope {
  const lines = patch.replace(/\r\n/g, '\n').split('\n');
  const body: string[] = [];
  let target: string | undefined;
  let foundHunk = false;
  for (const line of lines) {
    const update = /^\*\*\* Update File:\s*(.+)$/i.exec(line);
    if (update) {
      if (target !== undefined) throw new Error('apply_patch supports only one file per patch.');
      if (foundHunk) throw new Error('apply_patch: the Update File target must precede the hunks.');
      target = update[1].trim();
    } else if (/^\*\*\* (?:Begin Patch|End Patch)$/i.test(line)) {
      continue;
    } else if (/^\*\*\* /.test(line)) {
      throw new Error('apply_patch supports a single Update File envelope; use write_file, delete_path or rename_path for other file operations.');
    } else {
      foundHunk ||= HUNK_HEADER.test(line);
      body.push(line);
    }
  }
  return { body: body.join('\n'), target };
}

export function extractPatchTarget(patch: string): string | undefined {
  return unwrapPatchEnvelope(patch).target;
}

function sourceLines(source: string): string[] {
  if (source.length === 0) return [];
  const lines = source.split('\n').map(line => line.endsWith('\r') ? line.slice(0, -1) : line);
  if (source.endsWith('\n')) lines.pop();
  return lines;
}

function matchesPatchLine(actual: string | undefined, operation: string, expected: string): boolean {
  return actual !== undefined && (operation === ' ' ? actual.trim() === expected.trim() : actual === expected);
}

function describeHunkFailure(
  lines: string[],
  hunk: Pick<StructuredPatchHunk, 'lines' | 'oldStart'>,
  index: number,
  reason: string,
): Error {
  const expected = hunk.lines.find(line => line.startsWith('-'))?.slice(1)
    ?? hunk.lines.find(line => line.startsWith(' '))?.slice(1)
    ?? '';
  const reference = expected.trim().slice(0, 160);
  let nearest = Math.max(0, Math.min(lines.length - 1, hunk.oldStart - 1));
  let bestScore = -1;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const actual = lines[lineIndex].trim().slice(0, 160);
    let prefix = 0;
    while (prefix < reference.length && prefix < actual.length && reference[prefix] === actual[prefix]) prefix++;
    const score = actual === reference ? 2 : prefix / Math.max(reference.length, actual.length, 1);
    if (score > bestScore) {
      bestScore = score;
      nearest = lineIndex;
    }
  }
  const nearby = lines.slice(Math.max(0, nearest - 2), nearest + 3)
    .map((line, offset) => `${Math.max(0, nearest - 2) + offset + 1}: ${line.slice(0, 200)}`)
    .join('\n');
  return new Error(`apply_patch: hunk ${index} ${reason}. Expected ${JSON.stringify(expected.slice(0, 160))}.`
    + `\nNearby source:\n${nearby || '(empty file)'}\nThe file may have changed; re-read it before retrying the patch.`);
}

function normalizeAnchoredHunks(source: string, patch: string): string {
  const actualLines = sourceLines(source);
  const exact = new Map<string, number[]>();
  const whitespace = new Map<string, number[]>();
  for (let index = 0; index < actualLines.length; index++) {
    const actual = actualLines[index];
    const exactPositions = exact.get(actual) ?? [];
    exactPositions.push(index);
    exact.set(actual, exactPositions);
    const key = actual.trim();
    const whitespacePositions = whitespace.get(key) ?? [];
    whitespacePositions.push(index);
    whitespace.set(key, whitespacePositions);
  }
  const lines = patch.split('\n');
  const result: string[] = [];
  let hunkIndex = 0;
  let delta = 0;
  for (let index = 0; index < lines.length;) {
    const header = lines[index];
    if (!HUNK_HEADER.test(header)) {
      result.push(header);
      index++;
      continue;
    }
    hunkIndex++;
    let end = index + 1;
    while (end < lines.length && !HUNK_HEADER.test(lines[end])
      && !/^(?:diff\s|Index:|={3,})/.test(lines[end])
      && !(lines[end].startsWith('--- ') && lines[end + 1]?.startsWith('+++ '))) end++;
    const body = lines.slice(index + 1, end);
    while (body.at(-1) === '') body.pop();
    const normalizedBody = body.map(line => line === '' ? ' ' : line);
    for (const line of normalizedBody) {
      if (!/^[ +\-\\]/.test(line)) {
        throw new Error(`apply_patch: hunk ${hunkIndex} contains an invalid line. Prefix context with a space, additions with + and removals with -.`);
      }
    }
    const oldLines = normalizedBody.filter(line => line.startsWith(' ') || line.startsWith('-'));
    const newCount = normalizedBody.filter(line => line.startsWith(' ') || line.startsWith('+')).length;
    const numbered = NUMBERED_HUNK.exec(header);
    let normalizedHeader = header;
    if (!numbered) {
      if (header !== '@@') {
        throw new Error(`apply_patch: hunk ${hunkIndex} has an invalid header. Use @@ or @@ -start,count +start,count @@.`);
      }
      if (!normalizedBody.some(line => line.startsWith('+') || line.startsWith('-'))) {
        throw new Error('apply_patch: no additions or deletions were supplied; the patch makes no changes.');
      }
      let matches: number[];
      if (oldLines.length === 0) {
        matches = actualLines.length === 0 ? [0] : [];
      } else {
        const anchors = oldLines.map((line, oldIndex) => ({
          oldIndex,
          positions: (line.startsWith(' ') ? whitespace.get(line.slice(1).trim()) : exact.get(line.slice(1))) ?? [],
        })).sort((left, right) => left.positions.length - right.positions.length);
        matches = [];
        for (const position of anchors[0].positions) {
          const start = position - anchors[0].oldIndex;
          if (start < 0 || start + oldLines.length > actualLines.length) continue;
          if (oldLines.every((line, offset) => matchesPatchLine(actualLines[start + offset], line[0], line.slice(1)))) matches.push(start);
          if (matches.length > 1) break;
        }
      }
      if (matches.length !== 1) {
        throw describeHunkFailure(actualLines, { lines: normalizedBody, oldStart: 1 }, hunkIndex,
          matches.length > 1 ? 'has ambiguous context; include more context' : 'could not match its context; include existing lines for an insertion');
      }
      const oldStart = oldLines.length === 0 ? 0 : matches[0] + 1;
      const newStart = newCount === 0 ? matches[0] + delta : matches[0] + delta + 1;
      normalizedHeader = `@@ -${oldStart},${oldLines.length} +${newStart},${newCount} @@`;
    }
    delta += newCount - oldLines.length;
    result.push(normalizedHeader, ...normalizedBody);
    index = end;
  }
  if (hunkIndex === 0) throw new Error('apply_patch: no hunks found. Use @@ with context or @@ -start,count +start,count @@ headers.');
  return result.join('\n');
}

function parsedHunksCoverPatch(patch: string, hunks: StructuredPatchHunk[]): boolean {
  let hunkIndex = -1;
  let offset = 0;
  for (const line of patch.split('\n')) {
    if (HUNK_HEADER.test(line)) {
      if (hunkIndex >= 0 && offset !== hunks[hunkIndex]?.lines.length) return false;
      hunkIndex++;
      offset = 0;
      if (!hunks[hunkIndex]) return false;
    } else if (hunkIndex >= 0) {
      const expected = hunks[hunkIndex].lines;
      if (offset < expected.length) {
        if (line !== expected[offset]) return false;
        offset++;
      } else if (line !== '') {
        return false;
      }
    }
  }
  return hunkIndex + 1 === hunks.length && offset === hunks[hunkIndex]?.lines.length;
}

export function applyValidatedPatch(source: string, patch: string): string {
  const body = unwrapPatchEnvelope(patch).body;
  const hasAnchoredHunks = body.split('\n').some(line => HUNK_HEADER.test(line) && !NUMBERED_HUNK.test(line));
  let parsed: ReturnType<typeof parsePatch> | undefined;
  if (!hasAnchoredHunks) {
    try {
      parsed = parsePatch(body);
      if (parsed.length === 1 && !parsedHunksCoverPatch(body, parsed[0].hunks)) parsed = undefined;
    } catch {
      // Models can miscount numbered headers; repair those before retrying.
    }
  }
  if (!parsed?.some(file => file.hunks.length > 0)) {
    const normalized = normalizeAnchoredHunks(source, body);
    try {
      parsed = parsePatch(validateAndFixPatch(normalized));
    } catch (error) {
      throw new Error(`apply_patch: invalid patch: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (parsed.length !== 1) throw new Error('apply_patch supports only one file per patch.');
  const structured = parsed[0];
  if (!structured.hunks.some(hunk => hunk.lines.some(line => line.startsWith('+') || line.startsWith('-')))) {
    throw new Error('apply_patch: no additions or deletions were supplied; the patch makes no changes.');
  }
  const options = { compareLine: (_line: number, actual: string, operation: string, expected: string) => matchesPatchLine(actual, operation, expected) };
  const updated = applyPatch(source, structured, options);
  if (updated === false) {
    let diagnosticSource = source;
    for (let index = 0; index < structured.hunks.length; index++) {
      const hunk = structured.hunks[index];
      const candidate = applyPatch(diagnosticSource, { ...structured, hunks: [hunk] }, options);
      if (candidate === false || index === structured.hunks.length - 1) {
        throw describeHunkFailure(sourceLines(source), hunk, index + 1, 'could not match its context');
      }
      diagnosticSource = candidate;
    }
  }
  if (updated === false || updated === source) throw new Error('apply_patch: the patch left the file unchanged; no changes were applied.');
  return updated;
}

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
        if (HUNK_HEADER.test(nextLine) || nextLine.match(/^(---|\+\+\+|Index:|diff\s)/) || nextLine === '===================================================================') {
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
        correctedHeader = `@@ -${oldStart},0 +${newStart},${newCount} @@`;
      } else if (newCount === 0) {
        correctedHeader = `@@ -${oldStart},${oldCount} +${newStart},0 @@`;
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
