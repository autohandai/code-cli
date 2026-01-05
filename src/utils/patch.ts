/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createTwoFilesPatch } from 'diff';
import type { BatchedChange } from '../actions/filesystem.js';

/**
 * Generate a git-compatible unified diff from batched changes
 * @param changes Array of batched changes from preview mode
 * @returns Unified diff string compatible with `git apply`
 */
export function generateUnifiedPatch(changes: BatchedChange[]): string {
  if (changes.length === 0) {
    return '';
  }

  const patches: string[] = [];

  for (const change of changes) {
    const { filePath, changeType, originalContent, proposedContent } = change;

    // Build git-style header
    const header = `diff --git a/${filePath} b/${filePath}`;

    // Add file mode header based on change type
    if (changeType === 'create') {
      patches.push(`${header}\nnew file mode 100644`);
    } else if (changeType === 'delete') {
      patches.push(`${header}\ndeleted file mode 100644`);
    } else {
      patches.push(header);
    }

    // Generate unified diff using the diff library
    const oldPath = changeType === 'create' ? '/dev/null' : `a/${filePath}`;
    const newPath = changeType === 'delete' ? '/dev/null' : `b/${filePath}`;

    const diff = createTwoFilesPatch(
      oldPath,
      newPath,
      originalContent,
      proposedContent,
      '', // oldHeader
      ''  // newHeader
    );

    // The diff library includes its own header (===, ----, ++++, etc.)
    // We need to extract just the --- and +++ and hunk parts
    const lines = diff.split('\n');

    // Find where the actual diff content starts (skip the first two header lines from createTwoFilesPatch)
    // The format is:
    // Index: oldPath
    // ===================================================================
    // --- oldPath
    // +++ newPath
    // @@ ... @@
    // ...content...

    let startIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('---')) {
        startIndex = i;
        break;
      }
    }

    // Include from --- onwards
    const diffContent = lines.slice(startIndex).join('\n');
    patches.push(diffContent);
  }

  return patches.join('\n');
}

/**
 * Format a summary of changes for display
 * @param changes Array of batched changes
 * @returns Human-readable summary string
 */
export function formatChangeSummary(changes: BatchedChange[]): string {
  const creates = changes.filter(c => c.changeType === 'create').length;
  const modifies = changes.filter(c => c.changeType === 'modify').length;
  const deletes = changes.filter(c => c.changeType === 'delete').length;

  const parts: string[] = [];
  if (creates > 0) parts.push(`${creates} file${creates > 1 ? 's' : ''} created`);
  if (modifies > 0) parts.push(`${modifies} file${modifies > 1 ? 's' : ''} modified`);
  if (deletes > 0) parts.push(`${deletes} file${deletes > 1 ? 's' : ''} deleted`);

  if (parts.length === 0) {
    return 'No changes';
  }

  return parts.join(', ');
}
