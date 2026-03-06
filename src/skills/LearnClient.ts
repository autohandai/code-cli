/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * LearnClient - Search, version-check, and filtering logic for /learn command.
 * Wraps GitHubRegistryFetcher with learn-specific behavior.
 */
import { createHash } from 'node:crypto';
import type { CommunitySkillsRegistry, GitHubCommunitySkill } from '../types.js';
import type { SkillDefinition } from './types.js';

const DEFAULT_LIMIT = 5;

export interface LearnSearchResult extends GitHubCommunitySkill {
  relevance: number;
}

export interface SkillUpdateInfo {
  name: string;
  slug: string;
  localSha: string;
  remoteSha: string;
}

export class LearnClient {
  search(
    registry: CommunitySkillsRegistry,
    query: string,
    limit: number = DEFAULT_LIMIT
  ): GitHubCommunitySkill[] {
    if (!query.trim()) return [];

    const lowerQuery = query.toLowerCase();

    const matched = registry.skills.filter((skill) => {
      const searchText = [
        skill.name,
        skill.description,
        skill.category,
        ...(skill.tags || []),
        ...(skill.languages || []),
        ...(skill.frameworks || []),
      ]
        .join(' ')
        .toLowerCase();

      return searchText.includes(lowerQuery);
    });

    matched.sort((a, b) => (b.downloadCount ?? 0) - (a.downloadCount ?? 0));

    return matched.slice(0, limit);
  }

  trending(
    registry: CommunitySkillsRegistry,
    limit: number = 10
  ): GitHubCommunitySkill[] {
    const sorted = [...registry.skills].sort((a, b) => {
      const featuredDiff = Number(Boolean(b.isFeatured)) - Number(Boolean(a.isFeatured));
      if (featuredDiff !== 0) return featuredDiff;
      return (b.downloadCount ?? 0) - (a.downloadCount ?? 0);
    });

    return sorted.slice(0, limit);
  }

  findBySlug(
    registry: CommunitySkillsRegistry,
    slug: string
  ): GitHubCommunitySkill | null {
    let searchName = slug;
    let searchAuthor: string | undefined;

    if (slug.startsWith('@')) {
      const parts = slug.slice(1).split('/');
      if (parts.length === 2) {
        searchAuthor = parts[0].toLowerCase();
        searchName = parts[1].toLowerCase();
      }
    }

    const lower = searchName.toLowerCase();

    return (
      registry.skills.find((s) => {
        const nameMatch =
          s.id.toLowerCase() === lower || s.name.toLowerCase() === lower;
        if (!nameMatch) return false;
        if (searchAuthor && s.author?.toLowerCase() !== searchAuthor) return false;
        return true;
      }) || null
    );
  }

  filterLearnedSkills(skills: SkillDefinition[]): SkillDefinition[] {
    return skills.filter(
      (s) => s.metadata && s.metadata['agentskill-slug']
    );
  }

  checkUpdates(
    installedSkills: SkillDefinition[],
    registry: CommunitySkillsRegistry,
    getShaForSkill: (skillId: string) => string | null
  ): SkillUpdateInfo[] {
    const updates: SkillUpdateInfo[] = [];

    for (const skill of installedSkills) {
      const slug = skill.metadata?.['agentskill-slug'];
      const localSha = skill.metadata?.['agentskill-sha'];
      if (!slug || !localSha) continue;

      const registrySkill = registry.skills.find(
        (s) => s.id === slug || s.name === slug
      );
      if (!registrySkill) continue;

      const remoteSha = getShaForSkill(registrySkill.id);
      if (remoteSha && remoteSha !== localSha) {
        updates.push({
          name: skill.name,
          slug,
          localSha,
          remoteSha,
        });
      }
    }

    return updates;
  }

  static computeContentSha(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 7);
  }
}
