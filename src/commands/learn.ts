/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * /learn command - Search and install community skills with security scanning
 */
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import { LearnClient } from '../skills/LearnClient.js';
import {
  fetchRegistryWithFallback,
  installSkillWithSecurity,
  injectLearnMetadata,
} from '../skills/communityInstaller.js';
import { GitHubRegistryFetcher } from '../skills/GitHubRegistryFetcher.js';
import { CommunitySkillsCache } from '../skills/CommunitySkillsCache.js';
import { AUTOHAND_PATHS } from '../constants.js';
import { showConfirm } from '../ui/ink/components/Modal.js';
import type { SkillsRegistry } from '../skills/SkillsRegistry.js';
import type { HookManager } from '../core/HookManager.js';
import type { CommunitySkillsRegistry } from '../types.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface LearnCommandContext {
  skillsRegistry: SkillsRegistry;
  workspaceRoot: string;
  hookManager?: HookManager;
  isNonInteractive?: boolean;
}

export interface ParsedLearnArgs {
  subcommand: 'search' | 'install' | 'list' | 'update' | 'recommendations';
  query?: string;
  slug?: string;
}

// ─── Arg Parser ──────────────────────────────────────────────────────

const KNOWN_SUBCOMMANDS = new Set(['list', 'update']);

export function parseLearnArgs(args: string[]): ParsedLearnArgs {
  if (args.length === 0) {
    return { subcommand: 'recommendations' };
  }

  const first = args[0];

  // Known subcommands
  if (KNOWN_SUBCOMMANDS.has(first)) {
    return { subcommand: first as ParsedLearnArgs['subcommand'] };
  }

  // @owner/name → direct install
  if (first.startsWith('@') && first.includes('/')) {
    return { subcommand: 'install', slug: first };
  }

  // Anything else is a search query
  return { subcommand: 'search', query: args.join(' ') };
}

// ─── Sub-handlers ────────────────────────────────────────────────────

async function handleInstall(
  ctx: LearnCommandContext,
  slug: string,
  registry: CommunitySkillsRegistry,
  cache: CommunitySkillsCache,
  fetcher: GitHubRegistryFetcher,
): Promise<string> {
  const client = new LearnClient();
  const skill = client.findBySlug(registry, slug);

  if (!skill) {
    return t('commands.learn.noResults', { query: slug });
  }

  // Interactive confirmation
  if (!ctx.isNonInteractive) {
    const confirmed = await showConfirm({
      title: t('commands.learn.confirmInstall', { name: skill.name }),
      defaultValue: true,
    });
    if (!confirmed) return null as unknown as string;
  }

  return installSkillWithSecurity(ctx, skill, cache, fetcher);
}

function handleList(ctx: LearnCommandContext): string {
  const client = new LearnClient();
  const allSkills = ctx.skillsRegistry.listSkills();
  const learnedSkills = client.filterLearnedSkills(allSkills);

  if (learnedSkills.length === 0) {
    return t('commands.learn.listEmpty');
  }

  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.bold(t('commands.learn.listTitle')));
  lines.push('');

  for (const skill of learnedSkills) {
    const slug = skill.metadata?.['agentskill-slug'] ?? skill.name;
    const status = skill.isActive ? chalk.green('[active]') : chalk.gray('[inactive]');
    lines.push(`  ${chalk.cyan(skill.name)} ${status}`);
    lines.push(`    ${skill.description}`);
    lines.push(`    {{action:Remove|/skills remove ${slug}}} {{action:Info|/skills info ${skill.name}}}`);
    lines.push('');
  }

  return lines.join('\n');
}

async function handleUpdate(
  ctx: LearnCommandContext,
  registry: CommunitySkillsRegistry,
  cache: CommunitySkillsCache,
  fetcher: GitHubRegistryFetcher,
): Promise<string> {
  const client = new LearnClient();
  const allSkills = ctx.skillsRegistry.listSkills();
  const learnedSkills = client.filterLearnedSkills(allSkills);

  if (learnedSkills.length === 0) {
    return t('commands.learn.listEmpty');
  }

  // Check for updates using content SHA comparison
  const updates = client.checkUpdates(
    learnedSkills,
    registry,
    (skillId: string) => {
      // Compute SHA from cached content if available
      // This is a simplified version — in production we'd compare against registry checksums
      const skill = registry.skills.find((s) => s.id === skillId);
      return skill ? skill.version ?? null : null;
    },
  );

  if (updates.length === 0) {
    return chalk.green(t('commands.learn.upToDate'));
  }

  // Re-install each updated skill
  let updatedCount = 0;
  for (const update of updates) {
    const skill = registry.skills.find((s) => s.id === update.slug || s.name === update.slug);
    if (!skill) continue;

    // Fetch fresh files
    try {
      const files = await fetcher.fetchSkillDirectory(skill);
      await cache.setSkillDirectory(skill.id, files);

      const enrichedFiles = new Map(files);
      const skillMd = enrichedFiles.get('SKILL.md');
      if (skillMd) {
        enrichedFiles.set('SKILL.md', injectLearnMetadata(skillMd, skill));
      }

      const targetDir = AUTOHAND_PATHS.skills;
      await ctx.skillsRegistry.importCommunitySkillDirectory(
        skill.id,
        enrichedFiles,
        targetDir,
        true, // force overwrite
      );

      // Track update telemetry
      ctx.skillsRegistry.trackSkillEvent({
        skillName: skill.name,
        source: 'community',
        activationType: 'explicit',
        action: 'update',
      });

      updatedCount++;
    } catch {
      // Skip failed updates silently
    }
  }

  return chalk.green(t('commands.learn.updated', { count: String(updatedCount) }));
}

async function handleRecommendations(
  ctx: LearnCommandContext,
  registry: CommunitySkillsRegistry,
): Promise<string> {
  const client = new LearnClient();
  const trending = client.trending(registry, 5);

  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.bold(t('commands.learn.recommendationsTitle')));
  lines.push('');

  for (const skill of trending) {
    const name = chalk.cyan(skill.name);
    const featured = skill.isFeatured ? chalk.yellow(' [featured]') : '';
    lines.push(`  ${name}${featured} - ${skill.description}`);
    lines.push(`  {{action:Install|/learn @${skill.author ?? 'community'}/${skill.id}}} {{action:Details|/learn ${skill.id}}}`);
    lines.push('');
  }

  lines.push(chalk.gray('Use /skills search <keyword> to search or /skills trending for more'));

  return lines.join('\n');
}

// ─── Main Entry Point ────────────────────────────────────────────────

export async function learn(ctx: LearnCommandContext, args: string[]): Promise<string | null> {
  if (!ctx.skillsRegistry) {
    return 'Skills registry not available.';
  }

  const parsed = parseLearnArgs(args);

  // Initialize services
  const cache = new CommunitySkillsCache();
  const fetcher = new GitHubRegistryFetcher();

  // For subcommands that need the registry, fetch it
  const needsRegistry = new Set(['search', 'install', 'update', 'recommendations']);

  let registry: CommunitySkillsRegistry | null = null;
  if (needsRegistry.has(parsed.subcommand)) {
    console.log(chalk.gray(t('commands.learn.searching', { query: parsed.query ?? parsed.slug ?? '...' })));
    registry = await fetchRegistryWithFallback(cache, fetcher);
    if (!registry) {
      return chalk.red('Unable to fetch community skills registry. Check your network connection.');
    }
  }

  switch (parsed.subcommand) {
    case 'install':
      return handleInstall(ctx, parsed.slug!, registry!, cache, fetcher);

    case 'list':
      return handleList(ctx);

    case 'update':
      return handleUpdate(ctx, registry!, cache, fetcher);

    case 'recommendations':
      return handleRecommendations(ctx, registry!);

    case 'search':
      // Search has been migrated to /skills — redirect users
      return 'Search has moved to /skills search. Use: /skills search ' + (parsed.query ?? '');

    default:
      return null;
  }
}

// ─── Metadata ────────────────────────────────────────────────────────

export const metadata = {
  command: '/learn',
  description: t('commands.learn.description'),
  implemented: true,
};
