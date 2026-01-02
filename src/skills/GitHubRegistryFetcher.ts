/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * GitHubRegistryFetcher - Fetches community skills registry from GitHub
 */
import type {
  CommunitySkillsRegistry,
  GitHubCommunitySkill,
} from '../types.js';

const DEFAULT_REPO = 'autohandai/community-skills';
const DEFAULT_BRANCH = 'main';

export interface GitHubFetcherConfig {
  /** GitHub repository in format "owner/repo" */
  repo?: string;
  /** Branch to fetch from */
  branch?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * Fetches community skills from a GitHub repository
 */
export class GitHubRegistryFetcher {
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(config: GitHubFetcherConfig = {}) {
    const repo = config.repo || DEFAULT_REPO;
    const branch = config.branch || DEFAULT_BRANCH;
    this.baseUrl = `https://raw.githubusercontent.com/${repo}/${branch}`;
    this.timeout = config.timeout || 15000;
  }

  /**
   * Fetch the registry.json index file
   */
  async fetchRegistry(): Promise<CommunitySkillsRegistry> {
    const url = `${this.baseUrl}/registry.json`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'autohand-cli',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch registry: HTTP ${response.status}`);
      }

      const data = await response.json();
      return this.validateRegistry(data);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Fetch a single file from a skill directory
   */
  async fetchSkillFile(skillDirectory: string, filePath: string): Promise<string> {
    const url = `${this.baseUrl}/${skillDirectory}/${filePath}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'autohand-cli',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch ${filePath}: HTTP ${response.status}`);
      }

      return response.text();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Fetch all files for a skill directory
   * Returns a Map of relative file paths to their contents
   */
  async fetchSkillDirectory(
    skill: GitHubCommunitySkill
  ): Promise<Map<string, string>> {
    const contents = new Map<string, string>();
    const errors: string[] = [];

    // Fetch files in parallel with concurrency limit
    const concurrencyLimit = 5;
    const files = [...skill.files];

    for (let i = 0; i < files.length; i += concurrencyLimit) {
      const batch = files.slice(i, i + concurrencyLimit);
      const results = await Promise.allSettled(
        batch.map(async (file) => {
          const content = await this.fetchSkillFile(skill.directory, file);
          return { file, content };
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          contents.set(result.value.file, result.value.content);
        } else {
          errors.push(result.reason?.message || 'Unknown error');
        }
      }
    }

    // At minimum, SKILL.md must be fetched successfully
    if (!contents.has('SKILL.md')) {
      throw new Error(
        `Failed to fetch SKILL.md for ${skill.name}: ${errors.join(', ')}`
      );
    }

    return contents;
  }

  /**
   * Validate and normalize the registry data
   */
  private validateRegistry(data: unknown): CommunitySkillsRegistry {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid registry: expected object');
    }

    const registry = data as Record<string, unknown>;

    if (!Array.isArray(registry.skills)) {
      throw new Error('Invalid registry: missing skills array');
    }

    if (!Array.isArray(registry.categories)) {
      throw new Error('Invalid registry: missing categories array');
    }

    // Validate each skill has required fields
    const validatedSkills: GitHubCommunitySkill[] = [];
    for (const skill of registry.skills) {
      if (this.isValidSkill(skill)) {
        validatedSkills.push(skill);
      }
    }

    return {
      version: String(registry.version || '1.0.0'),
      updatedAt: String(registry.updatedAt || new Date().toISOString()),
      skills: validatedSkills,
      categories: registry.categories as CommunitySkillsRegistry['categories'],
    };
  }

  /**
   * Type guard for valid skill objects
   */
  private isValidSkill(skill: unknown): skill is GitHubCommunitySkill {
    if (!skill || typeof skill !== 'object') return false;

    const s = skill as Record<string, unknown>;

    return (
      typeof s.id === 'string' &&
      typeof s.name === 'string' &&
      typeof s.description === 'string' &&
      typeof s.directory === 'string' &&
      Array.isArray(s.files) &&
      s.files.includes('SKILL.md')
    );
  }

  /**
   * Search skills by query (client-side filtering)
   */
  filterSkills(
    skills: GitHubCommunitySkill[],
    query: string
  ): GitHubCommunitySkill[] {
    if (!query.trim()) return skills;

    const lowerQuery = query.toLowerCase();

    return skills.filter((skill) => {
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
  }

  /**
   * Get skills by category
   */
  getSkillsByCategory(
    skills: GitHubCommunitySkill[],
    categoryId: string
  ): GitHubCommunitySkill[] {
    return skills.filter((skill) => skill.category === categoryId);
  }

  /**
   * Get featured skills
   */
  getFeaturedSkills(skills: GitHubCommunitySkill[]): GitHubCommunitySkill[] {
    return skills.filter((skill) => skill.isFeatured);
  }

  /**
   * Find a skill by name or ID
   */
  findSkill(
    skills: GitHubCommunitySkill[],
    nameOrId: string
  ): GitHubCommunitySkill | null {
    const lower = nameOrId.toLowerCase();
    return (
      skills.find(
        (s) => s.id.toLowerCase() === lower || s.name.toLowerCase() === lower
      ) || null
    );
  }

  /**
   * Get similar skills based on simple string matching
   */
  findSimilarSkills(
    skills: GitHubCommunitySkill[],
    query: string,
    limit = 5
  ): GitHubCommunitySkill[] {
    const lower = query.toLowerCase();

    const scored = skills.map((skill) => {
      let score = 0;

      // Name contains query
      if (skill.name.toLowerCase().includes(lower)) {
        score += 10;
      }

      // Description contains query
      if (skill.description.toLowerCase().includes(lower)) {
        score += 5;
      }

      // Tags contain query
      if (skill.tags?.some((t) => t.toLowerCase().includes(lower))) {
        score += 3;
      }

      return { skill, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.skill);
  }
}
