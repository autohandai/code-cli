/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const MENTION_SUGGESTION_LIMIT = 8;

export interface SkillMentionInfo {
  name: string;
  description: string;
  isActive: boolean;
  source: string;
}

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

export function buildSkillMentionSuggestions(
  skills: SkillMentionInfo[],
  seed: string,
  limit = MENTION_SUGGESTION_LIMIT
): string[] {
  const trimmedSeed = seed.trim();
  // Require filter text after $ — don't show all skills for bare $
  if (!trimmedSeed) {
    return [];
  }

  const normalizedSeed = trimmedSeed.toLowerCase();

  type RankedSkill = { name: string; rank: number; index: number };
  const ranked: RankedSkill[] = [];

  skills.forEach((skill, index) => {
    const nameLower = skill.name.toLowerCase();
    const descLower = skill.description.toLowerCase();

    const nameStartsWith = nameLower.startsWith(normalizedSeed);
    const nameContains = nameLower.includes(normalizedSeed);
    const descContains = descLower.includes(normalizedSeed);

    if (!nameContains && !descContains) {
      return;
    }

    let rank: number;
    if (nameStartsWith) {
      rank = 0;
    } else if (nameContains) {
      rank = 1;
    } else {
      rank = 2;
    }

    // Boost active skills slightly
    if (skill.isActive) {
      rank -= 0.5;
    }

    ranked.push({ name: skill.name, rank, index });
  });

  return ranked
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.name);
}
