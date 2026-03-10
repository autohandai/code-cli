/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Skills discovery action — searches the community skills registry.
 */
import { CommunitySkillsCache } from '../skills/CommunitySkillsCache.js';
import { GitHubRegistryFetcher } from '../skills/GitHubRegistryFetcher.js';
import { fetchRegistryWithFallback } from '../skills/communityInstaller.js';
import type { GitHubCommunitySkill } from '../types.js';

export interface SearchSkillsOptions {
  category?: string;
  limit?: number;
}

/**
 * Search the community skills registry for skills matching a query.
 * Uses cache-first with offline fallback.
 */
export async function searchCommunitySkills(
  query: string,
  options: SearchSkillsOptions = {},
): Promise<string> {
  const limit = Math.min(options.limit ?? 10, 20);

  const cache = new CommunitySkillsCache();
  const fetcher = new GitHubRegistryFetcher();
  const registry = await fetchRegistryWithFallback(cache, fetcher);

  if (!registry || registry.skills.length === 0) {
    return 'No skills found — registry unavailable (offline and no cache).';
  }

  let skills = registry.skills;

  // Filter by category if provided
  if (options.category) {
    const cat = options.category.toLowerCase();
    skills = skills.filter((s) => s.category.toLowerCase() === cat);
  }

  // Search by query
  if (query.trim()) {
    const lowerQuery = query.toLowerCase();
    skills = skills.filter((skill) => {
      const searchText = [
        skill.name,
        skill.id,
        skill.description,
        skill.category,
        ...(skill.tags ?? []),
        ...(skill.languages ?? []),
        ...(skill.frameworks ?? []),
      ]
        .join(' ')
        .toLowerCase();
      return searchText.includes(lowerQuery);
    });
  }

  // Sort by download count (most popular first)
  skills.sort((a, b) => (b.downloadCount ?? 0) - (a.downloadCount ?? 0));

  // Apply limit
  skills = skills.slice(0, limit);

  if (skills.length === 0) {
    return `No skills found matching "${query}".`;
  }

  return formatSkillResults(skills);
}

function formatSkillResults(skills: GitHubCommunitySkill[]): string {
  const lines = skills.map((s, i) => {
    const parts = [`${i + 1}. **${s.name}** (${s.id})`];
    parts.push(`   ${s.description}`);

    const meta: string[] = [];
    if (s.category) meta.push(`category: ${s.category}`);
    if (s.languages?.length) meta.push(`languages: ${s.languages.join(', ')}`);
    if (s.frameworks?.length) meta.push(`frameworks: ${s.frameworks.join(', ')}`);
    if (s.downloadCount) meta.push(`downloads: ${s.downloadCount}`);
    if (meta.length > 0) parts.push(`   [${meta.join(' | ')}]`);

    parts.push(`   Install: /skills install ${s.id}`);
    return parts.join('\n');
  });

  return lines.join('\n\n');
}
