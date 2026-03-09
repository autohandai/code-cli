/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Skills command - List and manage available skills
 * Also handles package-management subcommands: search, trending, remove, feedback
 */
import path from 'node:path';
import fse from 'fs-extra';
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import { LearnClient } from '../skills/LearnClient.js';
import { CommunitySkillsCache } from '../skills/CommunitySkillsCache.js';
import { GitHubRegistryFetcher } from '../skills/GitHubRegistryFetcher.js';
import {
  fetchRegistryWithFallback,
  installSkillWithSecurity,
} from '../skills/communityInstaller.js';
import { showModal, showConfirm } from '../ui/ink/components/Modal.js';
import type { SkillsRegistry } from '../skills/SkillsRegistry.js';
import type { HookManager } from '../core/HookManager.js';


export interface SkillsCommandContext {
  skillsRegistry: SkillsRegistry;
  workspaceRoot?: string;
  hookManager?: HookManager;
  isNonInteractive?: boolean;
}

/**
 * Skills command - lists all available skills
 * /skills - List all skills
 * /skills use <name> - Activate a skill
 * /skills deactivate <name> - Deactivate a skill
 */
export async function skills(ctx: SkillsCommandContext, args: string[] = []): Promise<string | null> {
  const { skillsRegistry } = ctx;

  if (!skillsRegistry) {
    return 'Skills registry not available.';
  }

  const subcommand = args[0]?.toLowerCase();
  const skillName = args.slice(1).join(' ').trim() || args[1];

  switch (subcommand) {
    case 'install':
    case 'get':
    case 'add':
      return handleSkillsInstall(ctx, skillName);

    case 'search':
      return handleSkillsSearch(ctx, args.slice(1).join(' '));

    case 'trending':
      return handleSkillsTrending();

    case 'remove':
    case 'uninstall':
      return handleSkillsRemove(ctx, skillName);

    case 'feedback':
    case 'rate':
      return handleSkillsFeedback(args[1], Number(args[2]), args.slice(3).join(' '));

    case 'use':
    case 'activate':
      return activateSkill(skillsRegistry, skillName);

    case 'deactivate':
    case 'off':
      return deactivateSkill(skillsRegistry, skillName);

    case 'info':
    case 'show':
      return showSkillInfo(skillsRegistry, skillName);

    default:
      return listSkills(skillsRegistry);
  }
}

/**
 * Generate a smart suggestion prompt based on skill description
 */
function generateSkillSuggestion(skillName: string, description: string): string {
  const desc = description.toLowerCase();

  // Generate contextual suggestions based on skill type
  if (desc.includes('commit') || desc.includes('git')) {
    return `Help me write a great commit message for my recent changes`;
  }
  if (desc.includes('test') || desc.includes('testing')) {
    return `Write comprehensive tests for the code I'm working on`;
  }
  if (desc.includes('review') || desc.includes('code review')) {
    return `Review my code and suggest improvements`;
  }
  if (desc.includes('document') || desc.includes('docs')) {
    return `Generate documentation for the current file`;
  }
  if (desc.includes('refactor')) {
    return `Help me refactor this code for better readability`;
  }
  if (desc.includes('debug') || desc.includes('fix')) {
    return `Help me debug the issue I'm seeing`;
  }
  if (desc.includes('api') || desc.includes('endpoint')) {
    return `Help me design a new API endpoint`;
  }
  if (desc.includes('database') || desc.includes('sql') || desc.includes('schema')) {
    return `Help me design the database schema`;
  }
  if (desc.includes('ui') || desc.includes('component') || desc.includes('frontend')) {
    return `Create a new UI component`;
  }
  if (desc.includes('deploy') || desc.includes('ci') || desc.includes('pipeline')) {
    return `Help me set up the deployment pipeline`;
  }
  if (desc.includes('security') || desc.includes('auth')) {
    return `Review security concerns in my code`;
  }
  if (desc.includes('performance') || desc.includes('optimize')) {
    return `Analyze and optimize performance`;
  }

  // Default suggestion
  return `Use ${skillName} to help with: ${description.slice(0, 50)}...`;
}

/**
 * List all available skills
 */
function listSkills(registry: SkillsRegistry): string {
  const allSkills = registry.listSkills();
  const activeSkills = registry.getActiveSkills();
  const lines: string[] = [];

  lines.push('');
  lines.push(`📚 **${t('commands.skills.title')}**`);
  lines.push('');

  if (allSkills.length === 0) {
    lines.push(t('commands.skills.noSkills'));
    lines.push('');
    lines.push('**Get started:**');
    lines.push('');
    lines.push('{{action:🌐 Browse Community Skills|/skills install}}');
    lines.push('{{action:✨ Create New Skill|/skills new}}');
    lines.push('');
    lines.push('_Skills can be added in:_');
    lines.push('- `~/.autohand/skills/<skill-name>/SKILL.md`');
    lines.push('- `<project>/.autohand/skills/<skill-name>/SKILL.md`');
    return lines.join('\n');
  }

  // Group skills by source
  const bySource = new Map<string, typeof allSkills>();
  for (const skill of allSkills) {
    const existing = bySource.get(skill.source) ?? [];
    existing.push(skill);
    bySource.set(skill.source, existing);
  }

  // Display by source
  const sourceLabels: Record<string, string> = {
    'codex-user': '📁 Codex User Skills',
    'claude-user': '📁 Claude User Skills',
    'claude-project': '📁 Project Skills',
    'autohand-user': '📁 Autohand User Skills',
    'autohand-project': '📁 Project Skills',
  };

  for (const [source, skills] of bySource) {
    lines.push(`**${sourceLabels[source] || source}**`);
    lines.push('');

    for (const skill of skills) {
      const isActive = skill.isActive;
      const statusIcon = isActive ? '🟢' : '⚪';
      const statusText = isActive ? ' _(active)_' : '';

      lines.push(`${statusIcon} **${skill.name}**${statusText}`);
      lines.push(`   ${skill.description}`);

      // Add action buttons for each skill
      if (isActive) {
        const suggestion = generateSkillSuggestion(skill.name, skill.description);
        lines.push(`   {{action:💡 Try it|${suggestion}}} {{action:ℹ️ Info|/skills info ${skill.name}}} {{action:⏸️ Deactivate|/skills deactivate ${skill.name}}}`);
      } else {
        lines.push(`   {{action:▶️ Activate|/skills use ${skill.name}}} {{action:ℹ️ Info|/skills info ${skill.name}}}`);
      }
      lines.push('');
    }
  }

  lines.push('─'.repeat(40));
  lines.push(`📊 **${allSkills.length}** skills available, **${activeSkills.length}** active`);
  lines.push('');
  lines.push('**Quick Actions:**');
  lines.push('{{action:🌐 Browse Community|/skills install}} {{action:✨ Create New|/skills new}}');

  return lines.join('\n');
}

/**
 * Activate a skill by name
 */
function activateSkill(registry: SkillsRegistry, name: string): string {
  if (!name) {
    return 'Usage: /skills use <skill-name>';
  }

  const skill = registry.getSkill(name);
  if (!skill) {
    const lines = [`Skill not found: ${name}`];

    // Suggest similar skills
    const similar = registry.findSimilar(name, 0.2);
    if (similar.length > 0) {
      lines.push('Did you mean:');
      for (const match of similar.slice(0, 3)) {
        lines.push(`  - ${match.skill.name}`);
      }
    }
    return lines.join('\n');
  }

  if (skill.isActive) {
    return `Skill "${name}" is already active.`;
  }

  const success = registry.activateSkill(name);
  if (success) {
    return `✓ Activated skill: ${name}\n  ${skill.description}`;
  } else {
    return `Failed to activate skill: ${name}`;
  }
}

/**
 * Deactivate a skill by name
 */
function deactivateSkill(registry: SkillsRegistry, name: string): string {
  if (!name) {
    return 'Usage: /skills deactivate <skill-name>';
  }

  const skill = registry.getSkill(name);
  if (!skill) {
    return `Skill not found: ${name}`;
  }

  if (!skill.isActive) {
    return `Skill "${name}" is not active.`;
  }

  const success = registry.deactivateSkill(name);
  if (success) {
    return `✓ Deactivated skill: ${name}`;
  } else {
    return `Failed to deactivate skill: ${name}`;
  }
}

/**
 * Show detailed info about a skill
 */
function showSkillInfo(registry: SkillsRegistry, name: string): string {
  if (!name) {
    return 'Usage: /skills info <skill-name>';
  }

  const skill = registry.getSkill(name);
  if (!skill) {
    return `Skill not found: ${name}`;
  }

  const lines: string[] = [];
  lines.push('');
  lines.push(`📋 **Skill: ${skill.name}**`);
  lines.push('');

  // Status with action button
  if (skill.isActive) {
    lines.push(`**Status:** 🟢 Active`);
    const suggestion = generateSkillSuggestion(skill.name, skill.description);
    lines.push('');
    lines.push(`{{action:💡 Try it now|${suggestion}}} {{action:⏸️ Deactivate|/skills deactivate ${skill.name}}}`);
  } else {
    lines.push(`**Status:** ⚪ Inactive`);
    lines.push('');
    lines.push(`{{action:▶️ Activate|/skills use ${skill.name}}}`);
  }

  lines.push('');
  lines.push('─'.repeat(40));
  lines.push('');
  lines.push(`**Description:** ${skill.description}`);
  lines.push(`**Source:** ${skill.source}`);
  lines.push(`**Path:** \`${skill.path}\``);

  if (skill.license) {
    lines.push(`**License:** ${skill.license}`);
  }

  if (skill.compatibility) {
    lines.push(`**Compatibility:** ${skill.compatibility}`);
  }

  if (skill['allowed-tools']) {
    lines.push(`**Allowed Tools:** ${skill['allowed-tools']}`);
  }

  if (skill.metadata && Object.keys(skill.metadata).length > 0) {
    lines.push('');
    lines.push('**Metadata:**');
    for (const [key, value] of Object.entries(skill.metadata)) {
      lines.push(`- ${key}: ${value}`);
    }
  }

  lines.push('');
  lines.push('**Content Preview:**');
  lines.push('```');
  // Show first 500 chars of body
  const bodyPreview = skill.body.length > 500
    ? skill.body.slice(0, 500) + '\n... (truncated)'
    : skill.body;
  lines.push(bodyPreview || '(no body content)');
  lines.push('```');

  lines.push('');
  lines.push('{{action:← Back to Skills|/skills}}');

  return lines.join('\n');
}

/**
 * Handle /skills install subcommand
 */
async function handleSkillsInstall(
  ctx: SkillsCommandContext,
  skillName?: string
): Promise<string> {
  const { skillsRegistry, workspaceRoot } = ctx;

  if (!workspaceRoot) {
    return 'Workspace root not available.';
  }

  // Dynamic import to avoid circular dependencies
  const { skillsInstall } = await import('./skills-install.js');

  const result = await skillsInstall(
    {
      skillsRegistry,
      workspaceRoot,
    },
    skillName
  );

  return result ?? 'Skills install completed.';
}

// ─── Migrated Handlers (from /learn) ─────────────────────────────────

/**
 * Handle /skills search <query> — search the community registry
 */
async function handleSkillsSearch(
  ctx: SkillsCommandContext,
  query: string,
): Promise<string> {
  const cache = new CommunitySkillsCache();
  const fetcher = new GitHubRegistryFetcher();
  const registry = await fetchRegistryWithFallback(cache, fetcher);

  if (!registry) {
    return chalk.red('Unable to fetch community skills registry. Check your network connection.');
  }

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
    return t('commands.learn.noResults', { query });
  }

  const skill = results.find((s) => s.id === selected.value);
  if (!skill) return t('commands.learn.noResults', { query });

  if (!ctx.workspaceRoot) {
    return 'Workspace root not available for install.';
  }

  return installSkillWithSecurity(
    { skillsRegistry: ctx.skillsRegistry, workspaceRoot: ctx.workspaceRoot, hookManager: ctx.hookManager, isNonInteractive: ctx.isNonInteractive },
    skill, cache, fetcher,
  );
}

/**
 * Handle /skills trending — show popular community skills
 */
async function handleSkillsTrending(): Promise<string> {
  const cache = new CommunitySkillsCache();
  const fetcher = new GitHubRegistryFetcher();
  const registry = await fetchRegistryWithFallback(cache, fetcher);

  if (!registry) {
    return chalk.red('Unable to fetch community skills registry. Check your network connection.');
  }

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
    lines.push(`   {{action:Install|/skills install @${skill.author ?? 'community'}/${skill.id}}}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Handle /skills remove <slug> — remove an installed community skill
 */
async function handleSkillsRemove(
  ctx: SkillsCommandContext,
  slug: string | undefined,
): Promise<string> {
  if (!slug) {
    return 'Usage: /skills remove <skill-slug>';
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

    // Track remove telemetry
    ctx.skillsRegistry.trackSkillEvent({
      skillName: target.name,
      source: target.source,
      activationType: 'explicit',
      action: 'remove',
    });

    return chalk.green(t('commands.learn.removed', { name: target.name }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return chalk.red(`Failed to remove skill: ${msg}`);
  }
}

/**
 * Handle /skills feedback <slug> <rating> [comment] — submit skill feedback
 */
function handleSkillsFeedback(
  slug: string | undefined,
  rating: number | undefined,
  _comment: string | undefined,
): string {
  if (!slug) {
    return 'Usage: /skills feedback <skill-slug> <1-5> [comment]';
  }

  if (rating === undefined || isNaN(rating) || rating < 1 || rating > 5) {
    return t('commands.learn.feedbackInvalid');
  }

  // Acknowledge locally (future: send to API)
  return t('commands.learn.feedbackThanks', { name: slug });
}

export const metadata = {
  command: '/skills',
  description: t('commands.skills.description'),
  implemented: true,
};

export const useMetadata = {
  command: '/skills use',
  description: 'activate a skill',
  implemented: true,
};

export const installMetadata = {
  command: '/skills install',
  description: 'browse and install community skills',
  implemented: true,
};

export const searchMetadata = {
  command: '/skills search',
  description: 'search community skills',
  implemented: true,
};

export const trendingMetadata = {
  command: '/skills trending',
  description: 'show trending community skills',
  implemented: true,
};

export const removeMetadata = {
  command: '/skills remove',
  description: 'remove an installed skill',
  implemented: true,
};
