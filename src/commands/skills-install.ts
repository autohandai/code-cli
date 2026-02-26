/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Skills install command - Browse and install community skills from GitHub
 */
import path from 'node:path';
import chalk from 'chalk';
import { safePrompt } from '../utils/prompt.js';
import { showInput, showModal } from '../ui/ink/components/Modal.js';
import type { SkillsRegistry } from '../skills/SkillsRegistry.js';
import { GitHubRegistryFetcher } from '../skills/GitHubRegistryFetcher.js';
import { CommunitySkillsCache } from '../skills/CommunitySkillsCache.js';
import { AUTOHAND_PATHS, PROJECT_DIR_NAME } from '../constants.js';
import type {
  GitHubCommunitySkill,
  CommunitySkillsRegistry,
  SkillInstallScope,
} from '../types.js';

export const metadata = {
  command: '/skills install',
  description: 'browse and install community skills',
  implemented: true,
};

export interface SkillsInstallContext {
  skillsRegistry: SkillsRegistry;
  workspaceRoot: string;
}

const MAX_BROWSER_CHOICES = 50;
const SEARCH_OPTION_VALUE = '__skills_search__';
const CANCEL_OPTION_VALUE = '__skills_cancel__';

/**
 * Main entry point for /skills install command
 */
export async function skillsInstall(
  ctx: SkillsInstallContext,
  skillName?: string
): Promise<string | null> {
  const { skillsRegistry } = ctx;

  if (!skillsRegistry) {
    console.log(chalk.red('Skills registry not available.'));
    return null;
  }

  const cache = new CommunitySkillsCache();
  const fetcher = new GitHubRegistryFetcher();

  // Fetch registry (with cache)
  let registry: CommunitySkillsRegistry;
  try {
    const cached = await cache.getRegistry();
    if (cached) {
      registry = cached;
    } else {
      console.log(chalk.cyan('Fetching community skills registry...'));
      registry = await fetcher.fetchRegistry();
      await cache.setRegistry(registry);
    }
  } catch (error) {
    // Try offline fallback
    const stale = await cache.getRegistryIgnoreTTL();
    if (stale) {
      console.log(chalk.yellow('Using cached skills (offline mode)'));
      registry = stale;
    } else {
      console.log(chalk.red('Failed to fetch community skills. Please check your internet connection.'));
      console.log(chalk.gray(error instanceof Error ? error.message : 'Unknown error'));
      return null;
    }
  }

  // If skill name provided, do direct install
  if (skillName) {
    return directInstall(ctx, registry, fetcher, cache, skillName);
  }

  // Otherwise, open interactive browser
  return interactiveBrowser(ctx, registry, fetcher, cache);
}

/**
 * Direct install a skill by name
 */
async function directInstall(
  ctx: SkillsInstallContext,
  registry: CommunitySkillsRegistry,
  fetcher: GitHubRegistryFetcher,
  cache: CommunitySkillsCache,
  skillName: string
): Promise<string | null> {
  // Find the skill
  const skill = fetcher.findSkill(registry.skills, skillName);
  if (!skill) {
    console.log(chalk.red(`Skill not found: ${skillName}`));

    // Suggest similar skills
    const similar = fetcher.findSimilarSkills(registry.skills, skillName, 3);
    if (similar.length > 0) {
      console.log(chalk.gray('Did you mean:'));
      for (const s of similar) {
        console.log(chalk.gray(`  - ${s.name}: ${s.description}`));
      }
    }

    return null;
  }

  // Prompt for install scope
  const scope = await promptInstallScope();
  if (!scope) {
    console.log(chalk.gray('Installation cancelled.'));
    return null;
  }

  return installSkill(ctx, fetcher, cache, skill, scope);
}

/**
 * Interactive browser for browsing and installing skills
 */
async function interactiveBrowser(
  ctx: SkillsInstallContext,
  registry: CommunitySkillsRegistry,
  fetcher: GitHubRegistryFetcher,
  cache: CommunitySkillsCache
): Promise<string | null> {
  console.log();
  console.log(chalk.bold.cyan('Community Skills Marketplace'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.gray(`${registry.skills.length} skills available`));
  console.log();

  // Show categories
  console.log(chalk.bold('Categories:'));
  for (const cat of registry.categories) {
    console.log(chalk.gray(`  ${cat.name} (${cat.count})`));
  }
  console.log();

  // Show featured skills
  const featured = fetcher.getFeaturedSkills(registry.skills);
  if (featured.length > 0) {
    console.log(chalk.bold.yellow('Featured Skills:'));
    for (const skill of featured.slice(0, 5)) {
      const rating = skill.rating ? `★ ${skill.rating.toFixed(1)}` : '';
      const downloads = skill.downloadCount ? `↓${formatDownloads(skill.downloadCount)}` : '';
      console.log(`  ${chalk.green('●')} ${chalk.bold(skill.name)} ${chalk.gray(rating)} ${chalk.gray(downloads)}`);
      console.log(chalk.gray(`      ${skill.description}`));
    }
    console.log();
  }

  const selectedSkill = await browseAndSelectSkill(registry, fetcher);
  if (!selectedSkill) {
    console.log(chalk.gray('No skill selected.'));
    return null;
  }

  // Show skill details and confirm
  console.log();
  console.log(chalk.bold.cyan(`Skill: ${selectedSkill.name}`));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.white('Description: ') + selectedSkill.description);
  console.log(chalk.white('Category: ') + selectedSkill.category);
  if (selectedSkill.tags?.length) {
    console.log(chalk.white('Tags: ') + selectedSkill.tags.join(', '));
  }
  if (selectedSkill.rating) {
    console.log(chalk.white('Rating: ') + `★ ${selectedSkill.rating.toFixed(1)}`);
  }
  if (selectedSkill.downloadCount) {
    console.log(chalk.white('Downloads: ') + formatDownloads(selectedSkill.downloadCount));
  }
  if (selectedSkill.files.length > 1) {
    console.log(chalk.white('Files: ') + selectedSkill.files.length + ' files');
    for (const file of selectedSkill.files.slice(0, 5)) {
      console.log(chalk.gray(`  - ${file}`));
    }
    if (selectedSkill.files.length > 5) {
      console.log(chalk.gray(`  ... and ${selectedSkill.files.length - 5} more`));
    }
  }
  console.log();

  // Prompt for install scope
  const scope = await promptInstallScope();
  if (!scope) {
    console.log(chalk.gray('Installation cancelled.'));
    return null;
  }

  return installSkill(ctx, fetcher, cache, selectedSkill, scope);
}

async function browseAndSelectSkill(
  registry: CommunitySkillsRegistry,
  fetcher: GitHubRegistryFetcher
): Promise<GitHubCommunitySkill | null> {
  let searchQuery = '';

  while (true) {
    const filteredSkills = sortSkillsForDisplay(
      fetcher.filterSkills(registry.skills, searchQuery)
    );

    if (searchQuery && filteredSkills.length === 0) {
      console.log(chalk.yellow(`No skills found for "${searchQuery}".`));
      const retryQuery = await showInput({
        title: 'Search skills (leave empty to show all)',
        defaultValue: '',
        placeholder: 'react, testing, python',
      });

      if (retryQuery === null) {
        return null;
      }

      searchQuery = retryQuery.trim();
      continue;
    }

    const options = filteredSkills
      .slice(0, MAX_BROWSER_CHOICES)
      .map((skill) => ({
        label: formatSkillChoice(skill),
        value: skill.id,
      }));

    options.push({
      label: searchQuery
        ? `Search again (current: "${searchQuery}")`
        : 'Search skills',
      value: SEARCH_OPTION_VALUE,
    });
    options.push({
      label: 'Cancel',
      value: CANCEL_OPTION_VALUE,
    });

    if (filteredSkills.length > MAX_BROWSER_CHOICES) {
      console.log(
        chalk.gray(
          `Showing first ${MAX_BROWSER_CHOICES} of ${filteredSkills.length} matching skills. Refine search for more precise results.`
        )
      );
    }

    const selected = await showModal({
      title: searchQuery
        ? `Select a skill to install (search: "${searchQuery}")`
        : 'Select a skill to install',
      options,
    });

    if (!selected) {
      return null;
    }

    if (selected.value === CANCEL_OPTION_VALUE) {
      return null;
    }

    if (selected.value === SEARCH_OPTION_VALUE) {
      const nextQuery = await showInput({
        title: 'Search skills (leave empty to show all)',
        defaultValue: searchQuery,
        placeholder: 'react, testing, python',
      });

      if (nextQuery === null) {
        return null;
      }

      searchQuery = nextQuery.trim();
      continue;
    }

    const selectedSkill = registry.skills.find(
      (skill) => skill.id === selected.value || skill.name === selected.value
    );

    if (selectedSkill) {
      return selectedSkill;
    }

    console.log(chalk.yellow('Selected skill no longer exists in registry. Please choose again.'));
  }
}

/**
 * Prompt user for install scope (user vs project)
 */
async function promptInstallScope(): Promise<SkillInstallScope | null> {
  const answer = await safePrompt<{ scope: SkillInstallScope }>([
    {
      type: 'select',
      name: 'scope',
      message: 'Install location',
      choices: [
        {
          name: 'user',
          message: 'User (~/.autohand/skills/) - Available in all projects',
        },
        {
          name: 'project',
          message: 'Project (.autohand/skills/) - Only this project',
        },
      ],
    },
  ]);

  return answer?.scope || null;
}

/**
 * Install a skill with the given scope
 */
async function installSkill(
  ctx: SkillsInstallContext,
  fetcher: GitHubRegistryFetcher,
  cache: CommunitySkillsCache,
  skill: GitHubCommunitySkill,
  scope: SkillInstallScope
): Promise<string | null> {
  const { skillsRegistry, workspaceRoot } = ctx;

  // Determine target directory
  const targetDir =
    scope === 'project'
      ? path.join(workspaceRoot, PROJECT_DIR_NAME, 'skills')
      : AUTOHAND_PATHS.skills;

  // Check if already installed
  const isInstalled = await skillsRegistry.isSkillInstalled(skill.name, targetDir);
  if (isInstalled) {
    const confirm = await safePrompt<{ overwrite: boolean }>([
      {
        type: 'confirm',
        name: 'overwrite',
        message: `Skill "${skill.name}" already exists. Overwrite?`,
        initial: false,
      },
    ]);

    if (!confirm?.overwrite) {
      console.log(chalk.gray('Installation cancelled.'));
      return null;
    }
  }

  console.log(chalk.cyan(`Installing ${skill.name}...`));

  try {
    // Try to get from cache first
    let files = await cache.getSkillDirectory(skill.id);

    if (!files) {
      // Fetch from GitHub
      console.log(chalk.gray(`Fetching ${skill.files.length} files...`));
      files = await fetcher.fetchSkillDirectory(skill);

      // Cache for next time
      await cache.setSkillDirectory(skill.id, files);
    }

    // Import using the registry
    const result = await skillsRegistry.importCommunitySkillDirectory(
      skill.name,
      files,
      targetDir,
      isInstalled // force if overwriting
    );

    if (result.success) {
      console.log(chalk.green(`✓ Installed ${skill.name} to ${scope} skills`));
      console.log(chalk.gray(`  Path: ${result.path}`));

      // Show usage hint
      console.log();
      console.log(chalk.gray('To activate this skill, run:'));
      console.log(chalk.gray(`  /skills use ${skill.name}`));

      return `Skill "${skill.name}" installed successfully.`;
    } else {
      console.log(chalk.red(`Failed to install: ${result.error}`));
      return null;
    }
  } catch (error) {
    console.log(chalk.red('Installation failed.'));
    console.log(chalk.gray(error instanceof Error ? error.message : 'Unknown error'));
    return null;
  }
}

/**
 * Format download count for display
 */
function formatDownloads(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}

function sortSkillsForDisplay(skills: GitHubCommunitySkill[]): GitHubCommunitySkill[] {
  return [...skills].sort((a, b) => {
    const featuredRank = Number(Boolean(b.isFeatured)) - Number(Boolean(a.isFeatured));
    if (featuredRank !== 0) return featuredRank;

    const curatedRank = Number(Boolean(b.isCurated)) - Number(Boolean(a.isCurated));
    if (curatedRank !== 0) return curatedRank;

    const ratingRank = (b.rating ?? 0) - (a.rating ?? 0);
    if (ratingRank !== 0) return ratingRank;

    const downloadRank = (b.downloadCount ?? 0) - (a.downloadCount ?? 0);
    if (downloadRank !== 0) return downloadRank;

    return a.name.localeCompare(b.name);
  });
}

/**
 * Format a skill as a choice for the Ink modal list
 */
function formatSkillChoice(skill: GitHubCommunitySkill): string {
  const parts: string[] = [];

  if (skill.isFeatured) {
    parts.push(chalk.yellow('★'));
  } else if (skill.isCurated) {
    parts.push(chalk.green('✓'));
  } else {
    parts.push(' ');
  }

  parts.push(chalk.bold(skill.name.padEnd(30)));

  if (skill.rating) {
    parts.push(chalk.gray(`${skill.rating.toFixed(1)}`));
  }

  parts.push(chalk.gray(skill.description.slice(0, 40)));

  return parts.join(' ');
}

/**
 * Refresh the cache from GitHub
 */
export async function refreshCache(): Promise<void> {
  const cache = new CommunitySkillsCache();
  const fetcher = new GitHubRegistryFetcher();

  console.log(chalk.cyan('Refreshing community skills cache...'));

  try {
    const registry = await fetcher.fetchRegistry();
    await cache.setRegistry(registry);
    console.log(chalk.green(`✓ Cached ${registry.skills.length} skills`));
  } catch (error) {
    console.log(chalk.red('Failed to refresh cache.'));
    console.log(chalk.gray(error instanceof Error ? error.message : 'Unknown error'));
  }
}
