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
import {
  encodeCommunityUrlPath,
  parseGitHubSkillSourceUrl,
  validateCommunityRelativePath,
  validateCommunitySkillFiles,
  validateCommunitySkillIdentifier,
  validateCommunitySkillMetadata,
  validateCommunitySkillsRegistry,
  validateGitHubRepository,
  validateGitHubUrlComponent,
} from './communitySkillPaths.js';

const DEFAULT_REPO = 'autohandai/community-skills';
const DEFAULT_BRANCH = 'main';
const SKILLED_HOST = 'skilled.autohand.ai';

export interface GitHubFetcherConfig {
  /** GitHub repository in format "owner/repo" */
  repo?: string;
  /** Branch to fetch from */
  branch?: string;
  /** Full registry URL, used for non-default catalogs */
  registryUrl?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * Fetches community skills from a GitHub repository
 */
export class GitHubRegistryFetcher {
  private readonly baseUrl: string;
  private readonly registryUrl: string;
  private readonly timeout: number;

  constructor(config: GitHubFetcherConfig = {}) {
    const repo = config.repo || DEFAULT_REPO;
    const branch = config.branch || DEFAULT_BRANCH;
    const validatedRepo = validateGitHubRepository(repo);
    const validatedBranch = validateGitHubUrlComponent(branch, 'GitHub branch');
    this.baseUrl = `https://raw.githubusercontent.com/${validatedRepo.owner}/${validatedRepo.repo}/${validatedBranch}`;
    this.registryUrl = config.registryUrl || `${this.baseUrl}/registry.json`;
    this.timeout = config.timeout || 15000;
  }

  /**
   * Fetch the registry.json index file
   */
  async fetchRegistry(): Promise<CommunitySkillsRegistry> {
    const data = await this.fetchJson(this.registryUrl, 'registry', {
      Accept: 'application/json',
      'User-Agent': 'autohand-cli',
    });
    return this.validateRegistry(data);
  }

  /**
   * Fetch a single file from a skill directory
   */
  async fetchSkillFile(skillDirectory: string, filePath: string): Promise<string> {
    const directory = validateCommunityRelativePath(
      skillDirectory,
      'community skill source directory'
    );
    const file = validateCommunityRelativePath(filePath, 'community skill file path');
    const url = `${this.baseUrl}/${encodeCommunityUrlPath(directory)}/${encodeCommunityUrlPath(file)}`;

    return this.fetchText(url, filePath);
  }

  private async fetchText(url: string, errorLabel: string): Promise<string> {
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
        throw new Error(`Failed to fetch ${errorLabel}: HTTP ${response.status} at ${url}`);
      }

      return response.text();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async fetchJson(
    url: string,
    errorLabel: string,
    headers: Record<string, string>
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch ${errorLabel}: HTTP ${response.status} at ${url}`);
      }

      return response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async fetchSkillFileForSkill(
    skill: GitHubCommunitySkill,
    filePath: string
  ): Promise<string> {
    return this.fetchText(this.resolveSkillFileUrl(skill, filePath), filePath);
  }

  private resolveSkillFileUrl(skill: GitHubCommunitySkill, filePath: string): string {
    const file = validateCommunityRelativePath(filePath, 'community skill file path');
    const sourceBaseUrl = resolveGitHubSourceUrlBase(skill.sourceUrl)
      ?? resolveGitHubSourceBase(skill.source, skill.directory)
      ?? `${this.baseUrl}/${encodeCommunityUrlPath(
        validateCommunityRelativePath(skill.directory, 'community skill source directory')
      )}`;

    return `${sourceBaseUrl}/${encodeCommunityUrlPath(file)}`;
  }

  /**
   * Fetch all files for a skill directory
   * Returns a Map of relative file paths to their contents
   */
  async fetchSkillDirectory(
    skill: GitHubCommunitySkill
  ): Promise<Map<string, string>> {
    const validatedSkill = validateCommunitySkillMetadata(skill);
    const catalogFiles = await this.fetchCatalogSkillDirectory(validatedSkill);
    if (catalogFiles) {
      return validateCommunitySkillFiles(validatedSkill, catalogFiles);
    }

    const contents = new Map<string, string>();
    const errors: string[] = [];

    // Fetch files in parallel with concurrency limit
    const concurrencyLimit = 5;
    const files = [...validatedSkill.files];

    for (let i = 0; i < files.length; i += concurrencyLimit) {
      const batch = files.slice(i, i + concurrencyLimit);
      const results = await Promise.allSettled(
        batch.map(async (file) => {
          const content = await this.fetchSkillFileForSkill(validatedSkill, file);
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

    return validateCommunitySkillFiles(validatedSkill, contents);
  }

  private async fetchCatalogSkillDirectory(
    skill: GitHubCommunitySkill
  ): Promise<Map<string, string> | null> {
    if (typeof skill.content === 'string' && skill.content.trim()) {
      return new Map([['SKILL.md', skill.content]]);
    }

    const detailUrl = resolveSkilledDetailUrl(skill);
    if (!detailUrl) {
      return null;
    }

    const data = await this.fetchJson(detailUrl, `Skilled skill detail for ${skill.name}`, {
      Accept: 'application/json',
      'User-Agent': 'autohand-cli',
    });
    if (!data || typeof data !== 'object') {
      throw new Error(`Invalid Skilled skill detail for ${skill.name} at ${detailUrl}`);
    }

    const detail = data as Record<string, unknown>;
    const content = typeof detail.content === 'string'
      ? detail.content
      : typeof detail.body === 'string'
        ? detail.body
        : null;

    if (!content?.trim()) {
      throw new Error(`Skilled skill detail for ${skill.name} did not include SKILL.md content at ${detailUrl}`);
    }

    return new Map([['SKILL.md', content]]);
  }

  /**
   * Validate and normalize the registry data
   */
  private validateRegistry(data: unknown): CommunitySkillsRegistry {
    return validateCommunitySkillsRegistry(data);
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

function resolveGitHubSourceUrlBase(sourceUrl?: string): string | null {
  if (!sourceUrl) {
    return null;
  }

  const source = parseGitHubSkillSourceUrl(sourceUrl);
  return `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.branch}/${encodeCommunityUrlPath(source.directory)}`;
}

function resolveGitHubSourceBase(source: string | undefined, directory: string): string | null {
  if (!source) {
    return null;
  }

  const repository = validateGitHubRepository(source);
  const sourceDirectory = validateCommunityRelativePath(directory, 'community skill source directory');
  return `https://raw.githubusercontent.com/${repository.owner}/${repository.repo}/main/${encodeCommunityUrlPath(sourceDirectory)}`;
}

function resolveSkilledDetailUrl(skill: GitHubCommunitySkill): string | null {
  if (!skill.url) {
    return null;
  }

  try {
    const url = new URL(skill.url);
    if (url.hostname !== SKILLED_HOST) {
      return null;
    }

    if (url.protocol !== 'https:' || url.search || url.hash || url.port || url.username || url.password) {
      throw new Error(`Invalid Skilled skill URL for ${skill.id}`);
    }

    const [route, id] = url.pathname.split('/').filter(Boolean);
    if (route !== 'skill' || !id || url.pathname.split('/').filter(Boolean).length !== 2) {
      throw new Error(`Invalid Skilled skill URL for ${skill.id}`);
    }

    const validatedId = validateCommunitySkillIdentifier(id, 'Skilled skill id');
    return `https://${SKILLED_HOST}/skills/${encodeURIComponent(validatedId)}.json`;
  } catch {
    throw new Error(`Invalid Skilled skill URL for ${skill.id}`);
  }
}
