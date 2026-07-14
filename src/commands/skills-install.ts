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
import { SkillParser } from '../skills/SkillParser.js';
import { GitHubRegistryFetcher } from '../skills/GitHubRegistryFetcher.js';
import { CommunitySkillsCache } from '../skills/CommunitySkillsCache.js';
import {
  assertCommunityPathSymlinkSafe,
  resolveContainedCommunityPath,
  validateCommunitySkillFiles,
  validateCommunitySkillMetadata,
} from '../skills/communitySkillPaths.js';
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
  installScope?: SkillInstallScope;
  showActivationHint?: boolean;
  onSkillInstalled?: (skillName: string) => void;
}

const MAX_BROWSER_CHOICES = 50;
const SEARCH_OPTION_VALUE = '__skills_search__';
const CANCEL_OPTION_VALUE = '__skills_cancel__';
const SKILLED_CATALOG_REGISTRY_URL = 'https://skilled.autohand.ai/skills-index.json';
const INSTALL_PROGRESS_STEPS = 6;

interface SkillFileLoadResult {
  files: Map<string, string>;
  cacheAfterValidation: boolean;
}

/**
 * Main entry point for /skills install command
 */
export async function skillsInstall(
  ctx: SkillsInstallContext,
  skillName?: string
): Promise<string | null> {
  const { skillsRegistry } = ctx;

  if (!skillsRegistry) {
    return chalk.red('Skills registry not available.');
  }

  const cache = new CommunitySkillsCache();
  const fetcher = new GitHubRegistryFetcher();

  // Fetch registry (with cache)
  let registry: CommunitySkillsRegistry | null;
  try {
    const cached = await cache.getRegistry();
    if (cached) {
      registry = cached;
    } else {
      registry = await fetcher.fetchRegistry();
      await cache.setRegistry(registry);
    }
  } catch {
    // Try offline fallback
    const stale = await cache.getRegistryIgnoreTTL();
    if (stale) {
      registry = stale;
    } else {
      registry = null;
    }
  }

  if (!registry && !skillName) {
    return chalk.red('Failed to fetch community skills. Please check your internet connection.');
  }

  const installRegistry = registry ?? createEmptyRegistry();

  // If skill name provided, do direct install
  if (skillName) {
    return directInstall(ctx, installRegistry, fetcher, cache, skillName);
  }

  // Otherwise, open interactive browser
  return interactiveBrowser(ctx, installRegistry, fetcher, cache);
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
  const { skill, installFetcher, suggestionSkills } = await findDirectInstallSkill(
    registry,
    fetcher,
    skillName
  );
  if (!skill) {
    const lines = [chalk.red(`Skill not found: ${skillName}`)];

    // Suggest similar skills
    const similar = fetcher.findSimilarSkills(suggestionSkills, skillName, 3);
    if (similar.length > 0) {
      lines.push(chalk.gray('Did you mean:'));
      for (const s of similar) {
        lines.push(chalk.gray(`  - ${s.name}: ${s.description}`));
      }
    }

    return lines.join('\n');
  }

  const scope = ctx.installScope ?? await promptInstallScope();
  if (!scope) {
    return chalk.gray('Installation cancelled.');
  }

  return installSkill(ctx, installFetcher, cache, skill, scope);
}

async function findDirectInstallSkill(
  registry: CommunitySkillsRegistry,
  fetcher: GitHubRegistryFetcher,
  skillName: string
): Promise<{
  skill: GitHubCommunitySkill | null;
  installFetcher: GitHubRegistryFetcher;
  suggestionSkills: GitHubCommunitySkill[];
}> {
  const registrySkill = fetcher.findSkill(registry.skills, skillName);
  if (registrySkill) {
    return {
      skill: registrySkill,
      installFetcher: fetcher,
      suggestionSkills: registry.skills,
    };
  }

  try {
    const skilledFetcher = new GitHubRegistryFetcher({
      registryUrl: SKILLED_CATALOG_REGISTRY_URL,
    });
    const skilledRegistry = await skilledFetcher.fetchRegistry();
    const skilledSkill = skilledFetcher.findSkill(skilledRegistry.skills, skillName);
    return {
      skill: skilledSkill,
      installFetcher: skilledSkill ? skilledFetcher : fetcher,
      suggestionSkills: mergeSuggestionSkills(registry.skills, skilledRegistry.skills),
    };
  } catch {
    return {
      skill: null,
      installFetcher: fetcher,
      suggestionSkills: registry.skills,
    };
  }
}

function mergeSuggestionSkills(
  primarySkills: GitHubCommunitySkill[],
  fallbackSkills: GitHubCommunitySkill[]
): GitHubCommunitySkill[] {
  const seen = new Set(primarySkills.map((skill) => skill.id.toLowerCase()));
  const merged = [...primarySkills];

  for (const skill of fallbackSkills) {
    const id = skill.id.toLowerCase();
    if (!seen.has(id)) {
      seen.add(id);
      merged.push(skill);
    }
  }

  return merged;
}

function createEmptyRegistry(): CommunitySkillsRegistry {
  return {
    version: '1.0.0',
    updatedAt: '1970-01-01T00:00:00.000Z',
    skills: [],
    categories: [],
  };
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
  const selectedSkill = await browseAndSelectSkill(registry, fetcher);
  if (!selectedSkill) {
    return chalk.gray('No skill selected.');
  }

  const scope = ctx.installScope ?? await promptInstallScope();
  if (!scope) {
    return chalk.gray('Installation cancelled.');
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
  const metadataError = validateInstallSkillMetadata(skill);
  if (metadataError) {
    return failPreflight(metadataError);
  }
  const progress = createInstallProgress(skill.name);
  progress.step(1, 'Validating skill metadata');

  // Determine target directory
  const targetDir =
    scope === 'project'
      ? path.join(workspaceRoot, PROJECT_DIR_NAME, 'skills')
      : AUTOHAND_PATHS.skills;

  progress.step(2, 'Checking target folder');
  const targetError = await validateInstallTarget(targetDir, skill.id);
  if (targetError) {
    return failPreflight(targetError);
  }

  // Check if already installed
  progress.step(3, 'Checking existing installation');
  const isInstalled = await skillsRegistry.isSkillInstalled(skill.id, targetDir);
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

  let loadedFiles: SkillFileLoadResult;
  try {
    progress.step(4, 'Validating source files');
    loadedFiles = await loadSkillFilesForInstall(cache, fetcher, skill);

    progress.step(5, 'Validating SKILL.md content');
    const filesError = validateInstallFiles(skill, loadedFiles.files);
    if (filesError) {
      return failPreflight(filesError);
    }

    if (loadedFiles.cacheAfterValidation) {
      await cache.setSkillDirectory(skill.id, loadedFiles.files);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return failPreflight(`Unable to validate source files for ${skill.name}: ${message}`);
  }

  try {
    progress.step(6, 'Installing validated files');

    // Import using the registry
    const result = await skillsRegistry.importCommunitySkillDirectory(
      skill.id,
      loadedFiles.files,
      targetDir,
      isInstalled // force if overwriting
    );

    if (result.success) {
      console.log(chalk.green(`✓ Installed ${skill.name} to ${scope} skills`));
      console.log(chalk.gray(`  Path: ${result.path}`));
      ctx.onSkillInstalled?.(skill.id);

      if (ctx.showActivationHint !== false) {
        console.log();
        console.log(chalk.gray('To activate this skill, run:'));
        console.log(chalk.gray(`  /skills use ${skill.id}`));
      }

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

async function loadSkillFilesForInstall(
  cache: CommunitySkillsCache,
  fetcher: GitHubRegistryFetcher,
  skill: GitHubCommunitySkill
): Promise<SkillFileLoadResult> {
  const cachedFiles = await cache.getSkillDirectory(skill.id);
  if (cachedFiles) {
    return {
      files: validateCommunitySkillFiles(skill, cachedFiles),
      cacheAfterValidation: false,
    };
  }

  const files = await fetcher.fetchSkillDirectory(skill);
  return {
    files: validateCommunitySkillFiles(skill, files),
    cacheAfterValidation: true,
  };
}

function validateInstallSkillMetadata(skill: GitHubCommunitySkill): string | null {
  try {
    validateCommunitySkillMetadata(skill);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid community skill metadata.';
  }
}

async function validateInstallTarget(targetDir: string, skillName: string): Promise<string | null> {
  try {
    const resolvedSkillDir = resolveContainedCommunityPath(
      targetDir,
      skillName,
      'community skill install directory'
    );
    await assertCommunityPathSymlinkSafe(
      targetDir,
      resolvedSkillDir,
      'community skill install directory'
    );
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : `Invalid install target for ${skillName}`;
  }
}

function validateInstallFiles(
  skill: GitHubCommunitySkill,
  files: Map<string, string>
): string | null {
  try {
    validateCommunitySkillFiles(skill, files);
  } catch (error) {
    return error instanceof Error ? error.message : `Invalid community skill files for ${skill.name}`;
  }

  const skillMd = files.get('SKILL.md');
  if (!skillMd?.trim()) {
    return `Validated source returned an empty SKILL.md for ${skill.name}.`;
  }

  const parseResult = new SkillParser().parseContent(
    skillMd,
    path.join(skill.id, 'SKILL.md'),
    'community'
  );
  if (!parseResult.success) {
    return `Invalid SKILL.md for ${skill.name}: ${parseResult.error ?? 'parse failed'}`;
  }

  return null;
}

interface SkillInstallProgress {
  step(step: number, message: string): void;
}

function createInstallProgress(skillName: string): SkillInstallProgress {
  let headerPrinted = false;

  return {
    step(step: number, message: string): void {
      if (!headerPrinted) {
        console.log(chalk.gray(`${formatBrailleProgress(INSTALL_PROGRESS_STEPS, INSTALL_PROGRESS_STEPS)} Installing ${skillName}`));
        headerPrinted = true;
      }
      console.log(chalk.gray(`  [${step}/${INSTALL_PROGRESS_STEPS}] ${message}`));
    },
  };
}

function formatBrailleProgress(step: number, total: number, width = 10): string {
  const filled = Math.max(1, Math.min(width, Math.ceil((step / total) * width)));
  return `${'⣿'.repeat(filled)}${'⣀'.repeat(width - filled)}`;
}

function failPreflight(message: string): null {
  console.log(chalk.red('Validation failed before installation.'));
  console.log(chalk.gray(message));
  console.log(chalk.gray('No files were written.'));
  return null;
}

/**
 * Format download count for display
 */
export function formatDownloads(count: number): string {
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
