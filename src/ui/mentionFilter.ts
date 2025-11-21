/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const MENTION_SUGGESTION_LIMIT = 8;

export function buildFileMentionSuggestions(files: string[], seed: string, limit = MENTION_SUGGESTION_LIMIT): string[] {
  const trimmedSeed = seed.trim();
  if (!trimmedSeed) {
    return files.slice(0, limit);
  }

  const normalizedSeed = trimmedSeed.toLowerCase().replace(/\\/g, '/');
  const wantsPathPrefix = normalizedSeed.includes('/');

  type Ranked = { file: string; rank: number; index: number };
  const ranked: Ranked[] = [];

  files.forEach((file, index) => {
    const normalizedPath = file.toLowerCase().replace(/\\/g, '/');
    const filenameLower = normalizedPath.split('/').pop() ?? normalizedPath;

    const pathStartsWith = normalizedPath.startsWith(normalizedSeed);
    const pathContains = normalizedPath.includes(normalizedSeed);
    const filenameContains = filenameLower.includes(normalizedSeed);
    const exactFilename = filenameLower === normalizedSeed;

    if (wantsPathPrefix && !pathContains) {
      return;
    }
    if (!pathContains && !filenameContains) {
      return;
    }

    let rank: number;
    if (exactFilename) {
      rank = 0;
    } else if (filenameContains) {
      rank = 1;
    } else if (pathStartsWith) {
      rank = 2;
    } else {
      rank = 3;
    }

    ranked.push({ file, rank, index });
  });

  return ranked
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.file);
}
