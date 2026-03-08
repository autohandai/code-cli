/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * /learn command - Search and install community skills with security scanning
 */
import path from 'node:path';
import fse from 'fs-extra';
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import { LearnClient } from '../skills/LearnClient.js';
import { SkillSecurityScanner } from '../skills/SkillSecurityScanner.js';
import { GitHubRegistryFetcher } from '../skills/GitHubRegistryFetcher.js';
import { CommunitySkillsCache } from '../skills/CommunitySkillsCache.js';
import { AUTOHAND_PATHS, PROJECT_DIR_NAME } from '../constants.js';
import { showModal, showConfirm } from '../ui/ink/components/Modal.js';
import type { SkillsRegistry } from '../skills/SkillsRegistry.js';
import type { HookManager } from '../core/HookManager.js';
import type { CommunitySkillsRegistry, GitHubCommunitySkill, SkillInstallScope } from '../types.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface LearnCommandContext {
  skillsRegistry: SkillsRegistry;
  workspaceRoot: string;
  hookManager?: HookManager;
  isNonInteractive?: boolean;
}

export interface ParsedLearnArgs {
  subcommand: 'search' | 'install' | 'trending' | 'list' | 'update' | 'remove' | 'feedback' | 'recommendations';
  query?: string;
  slug?: string;
  rating?: number;
  comment?: string;
}

// ─── Arg Parser ──────────────────────────────────────────────────────

const KNOWN_SUBCOMMANDS = new Set(['trending', 'list', 'update', 'remove', 'feedback']);

export function parseLearnArgs(args: string[]): ParsedLearnArgs {
  if (args.length === 0) {
    return { subcommand: 'recommendations' };
  }

  const first = args[0];

  // Known subcommands
  if (KNOWN_SUBCOMMANDS.has(first)) {
    if (first === 'remove') {
      return { subcommand: 'remove', slug: args[1] };
    }
    if (first === 'feedback') {
      return {
        subcommand: 'feedback',
        slug: args[1],
        rating: args[2] ? Number(args[2]) : undefined,
        comment: args.slice(3).join(' ') || undefined,
      };
    }
    return { subcommand: first as ParsedLearnArgs['subcommand'] };
  }

  // @owner/name → direct install
  if (first.startsWith('@') && first.includes('/')) {
    return { subcommand: 'install', slug: first };
  }

  // Anything else is a search query
  return { subcommand: 'search', query: args.join(' ') };
}

// ─── Registry Fetching (cached + offline) ────────────────────────────

async function fetchRegistryWithFallback(
  cache: CommunitySkillsCache,
  fetcher: GitHubRegistryFetcher,
): Promise<CommunitySkillsRegistry | null> {
  // Try cache first
  const cached = await cache.getRegistry();
  if (cached) return cached;

  // Fetch from GitHub
  try {
    const registry = await fetcher.fetchRegistry();
    await cache.setRegistry(registry);
    return registry;
  } catch {
    // Offline fallback: use stale cache
    return cache.getRegistryIgnoreTTL();
  }
}

// ─── Security Install Flow ───────────────────────────────────────────

async function installSkillWithSecurity(
  ctx: LearnCommandContext,
  skill: GitHubCommunitySkill,
  cache: CommunitySkillsCache,
  fetcher: GitHubRegistryFetcher,
  scope: SkillInstallScope = 'user',
): Promise<string> {
  const targetDir = scope === 'project'
    ? path.join(ctx.workspaceRoot, PROJECT_DIR_NAME, 'skills')
    : AUTOHAND_PATHS.skills;

  // 1. Check already installed
  const installed = await ctx.skillsRegistry.isSkillInstalled(skill.id, targetDir);
  if (installed) {
    return t('commands.learn.alreadyInstalled', { name: skill.name });
  }

  // 2. Fetch skill files (cached)
  let files = await cache.getSkillDirectory(skill.id);
  if (!files) {
    try {
      files = await fetcher.fetchSkillDirectory(skill);
      await cache.setSkillDirectory(skill.id, files);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return chalk.red(`Failed to fetch skill files: ${msg}`);
    }
  }

  // 3. Security scan all content
  const scanner = new SkillSecurityScanner();
  const allContent = Array.from(files.values()).join('\n');
  const scanResult = scanner.scan(allContent);

  // 4. Handle blocked (score < 30)
  if (scanResult.blocked) {
    const lines: string[] = [];
    lines.push(chalk.red(t('commands.learn.securityBlocked', { score: String(scanResult.score) })));
    lines.push('');
    for (const threat of scanResult.threats) {
      lines.push(chalk.red(`  [${threat.category}] Line ${threat.line}: ${threat.context}`));
    }

    if (ctx.isNonInteractive) {
      return lines.join('\n');
    }

    // Interactive: ask for explicit override
    lines.push('');
    const override = await showConfirm({
      title: t('commands.learn.securityOverride'),
      defaultValue: false,
    });
    if (!override) {
      return lines.join('\n');
    }
  } else if (!scanResult.safe) {
    // 5. Handle warning (score < 50)
    console.log(chalk.yellow(t('commands.learn.securityWarning', { score: String(scanResult.score) })));
    for (const threat of scanResult.threats) {
      console.log(chalk.yellow(`  [${threat.category}] Line ${threat.line}: ${threat.context}`));
    }
  }

  // 6. Fire pre-learn hook
  if (ctx.hookManager) {
    const hookResults = await ctx.hookManager.executeHooks('pre-learn', {
      tool: 'learn',
      args: { slug: skill.id, name: skill.name, scope },
    });
    const blocked = hookResults.some((r) => r.blockingError);
    if (blocked) {
      return chalk.yellow(t('commands.learn.hookBlocked'));
    }
  }

  // 7. Inject agentskill metadata into SKILL.md frontmatter
  const skillMd = files.get('SKILL.md');
  if (skillMd) {
    const enriched = injectLearnMetadata(skillMd, skill);
    files.set('SKILL.md', enriched);
  }

  // 8. Import via skillsRegistry
  const importResult = await ctx.skillsRegistry.importCommunitySkillDirectory(
    skill.id,
    files,
    targetDir,
  );

  if (!importResult.success) {
    return chalk.red(importResult.error ?? 'Failed to install skill');
  }

  // 9. Fire post-learn hook
  if (ctx.hookManager) {
    await ctx.hookManager.executeHooks('post-learn', {
      tool: 'learn',
      args: { slug: skill.id, name: skill.name, scope },
      path: importResult.path,
      success: true,
    });
  }

  // 10. Success
  return chalk.green(t('commands.learn.installed', { name: skill.name }));
}

// ─── Metadata Injection ─────────────────────────────────────────────

function injectLearnMetadata(
  skillMd: string,
  skill: GitHubCommunitySkill,
): string {
  const now = new Date().toISOString();
  const sha = LearnClient.computeContentSha(skillMd);

  const metadataEntries = [
    `agentskill-slug: ${skill.id}`,
    `agentskill-owner: ${skill.author ?? 'community'}`,
    `agentskill-sha: ${sha}`,
    `agentskill-installed: ${now}`,
    `agentskill-source: github-registry`,
  ];

  // If the file starts with a YAML frontmatter block, inject inside it
  if (skillMd.startsWith('---')) {
    const endIndex = skillMd.indexOf('---', 3);
    if (endIndex !== -1) {
      const frontmatter = skillMd.slice(0, endIndex);
      const rest = skillMd.slice(endIndex);

      // Check if there's already a metadata section
      if (frontmatter.includes('metadata:')) {
        // Inject individual keys under the existing metadata block
        const injected = metadataEntries.map((e) => `  ${e}`).join('\n');
        return frontmatter + injected + '\n' + rest;
      }

      // Add a new metadata block
      const metadataBlock = 'metadata:\n' + metadataEntries.map((e) => `  ${e}`).join('\n') + '\n';
      return frontmatter + metadataBlock + rest;
    }
  }

  // No frontmatter: add one
  const metadataBlock = '---\nmetadata:\n' + metadataEntries.map((e) => `  ${e}`).join('\n') + '\n---\n';
  return metadataBlock + skillMd;
}

// ─── Sub-handlers ────────────────────────────────────────────────────

async function handleSearch(
  ctx: LearnCommandContext,
  query: string,
  registry: CommunitySkillsRegistry,
  cache: CommunitySkillsCache,
  fetcher: GitHubRegistryFetcher,
): Promise<string> {
  const client = new LearnClient();
  const results = client.search(registry, query);

  if (results.length === 0) {
    return t('commands.learn.noResults', { query });
  }

  // Non-interactive: return as formatted text
  if (ctx.isNonInteractive) {
    const lines = [t('commands.learn.found', { count: String(results.length) })];
    for (const skill of results) {
      const stars = skill.rating ? ` (${skill.rating.toFixed(1)}/5)` : '';
      lines.push(`  ${chalk.cyan(skill.name)} - ${skill.description}${stars}`);
    }
    return lines.join('\n');
  }

  // Interactive: show modal picker
  const options = results.map((s) => ({
    label: `${s.name} - ${s.description}`,
    value: s.id,
  }));

  const selected = await showModal({
    title: t('commands.learn.selectPrompt'),
    options,
  });

  if (!selected) {
    return null as unknown as string;
  }

  const skill = results.find((s) => s.id === selected.value);
  if (!skill) return null as unknown as string;

  return installSkillWithSecurity(ctx, skill, cache, fetcher);
}

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

function handleTrending(registry: CommunitySkillsRegistry): string {
  const client = new LearnClient();
  const trending = client.trending(registry);

  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.bold(t('commands.learn.trendingTitle')));
  lines.push('');

  for (let i = 0; i < trending.length; i++) {
    const skill = trending[i];
    const idx = chalk.gray(`${i + 1}.`);
    const name = chalk.cyan(skill.name);
    const featured = skill.isFeatured ? chalk.yellow(' [featured]') : '';
    const downloads = skill.downloadCount ? chalk.gray(` (${skill.downloadCount} installs)`) : '';
    lines.push(`${idx} ${name}${featured}${downloads}`);
    lines.push(`   ${skill.description}`);
    lines.push(`   {{action:Install|/learn @${skill.author ?? 'community'}/${skill.id}}}`);
    lines.push('');
  }

  return lines.join('\n');
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
    lines.push(`    {{action:Remove|/learn remove ${slug}}} {{action:Info|/skills info ${skill.name}}}`);
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
      updatedCount++;
    } catch {
      // Skip failed updates silently
    }
  }

  return chalk.green(t('commands.learn.updated', { count: String(updatedCount) }));
}

async function handleRemove(
  ctx: LearnCommandContext,
  slug: string,
): Promise<string> {
  if (!slug) {
    return 'Usage: /learn remove <skill-slug>';
  }

  // Find the installed skill by slug metadata
  const allSkills = ctx.skillsRegistry.listSkills();
  const target = allSkills.find(
    (s) => s.metadata?.['agentskill-slug'] === slug || s.name === slug,
  );

  if (!target) {
    return t('commands.learn.removeNotFound', { name: slug });
  }

  // Interactive confirmation
  if (!ctx.isNonInteractive) {
    const confirmed = await showConfirm({
      title: t('commands.learn.confirmRemove', { name: target.name }),
      defaultValue: false,
    });
    if (!confirmed) return null as unknown as string;
  }

  // Delete the skill directory
  const skillDir = path.dirname(target.path);
  try {
    await fse.remove(skillDir);
    return chalk.green(t('commands.learn.removed', { name: target.name }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return chalk.red(`Failed to remove skill: ${msg}`);
  }
}

function handleFeedback(slug: string | undefined, rating: number | undefined, _comment: string | undefined): string {
  if (!slug) {
    return 'Usage: /learn feedback <skill-slug> <1-5> [comment]';
  }

  if (rating === undefined || isNaN(rating) || rating < 1 || rating > 5) {
    return t('commands.learn.feedbackInvalid');
  }

  // Acknowledge locally (future: send to API)
  return t('commands.learn.feedbackThanks', { name: slug });
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

  lines.push(chalk.gray('Use /learn <keyword> to search or /learn trending for more'));

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
  const needsRegistry = new Set(['search', 'install', 'trending', 'update', 'recommendations']);

  let registry: CommunitySkillsRegistry | null = null;
  if (needsRegistry.has(parsed.subcommand)) {
    console.log(chalk.gray(t('commands.learn.searching', { query: parsed.query ?? parsed.slug ?? '...' })));
    registry = await fetchRegistryWithFallback(cache, fetcher);
    if (!registry) {
      return chalk.red('Unable to fetch community skills registry. Check your network connection.');
    }
  }

  switch (parsed.subcommand) {
    case 'search':
      return handleSearch(ctx, parsed.query!, registry!, cache, fetcher);

    case 'install':
      return handleInstall(ctx, parsed.slug!, registry!, cache, fetcher);

    case 'trending':
      return handleTrending(registry!);

    case 'list':
      return handleList(ctx);

    case 'update':
      return handleUpdate(ctx, registry!, cache, fetcher);

    case 'remove':
      return handleRemove(ctx, parsed.slug!);

    case 'feedback':
      return handleFeedback(parsed.slug, parsed.rating, parsed.comment);

    case 'recommendations':
      return handleRecommendations(ctx, registry!);

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
