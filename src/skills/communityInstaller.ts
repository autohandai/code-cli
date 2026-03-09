/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared community skill install utilities.
 * Used by both /skills (registry install) and /learn (LLM-generated install).
 */
import path from 'node:path';
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import { LearnClient } from './LearnClient.js';
import { SkillSecurityScanner } from './SkillSecurityScanner.js';
import { GitHubRegistryFetcher } from './GitHubRegistryFetcher.js';
import { CommunitySkillsCache } from './CommunitySkillsCache.js';
import { AUTOHAND_PATHS, PROJECT_DIR_NAME } from '../constants.js';
import { showConfirm } from '../ui/ink/components/Modal.js';
import type { SkillsRegistry } from './SkillsRegistry.js';
import type { HookManager } from '../core/HookManager.js';
import type { CommunitySkillsRegistry, GitHubCommunitySkill, SkillInstallScope } from '../types.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface InstallContext {
  skillsRegistry: SkillsRegistry;
  workspaceRoot: string;
  hookManager?: HookManager;
  isNonInteractive?: boolean;
}

// ─── Registry Fetching (cached + offline) ────────────────────────────

export async function fetchRegistryWithFallback(
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

export async function installSkillWithSecurity(
  ctx: InstallContext,
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

  // 10. Track install telemetry
  ctx.skillsRegistry.trackSkillEvent({
    skillName: skill.name,
    source: 'community',
    activationType: 'explicit',
    action: 'install',
  });

  // 11. Success
  return chalk.green(t('commands.learn.installed', { name: skill.name }));
}

// ─── Metadata Injection ─────────────────────────────────────────────

export function injectLearnMetadata(
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
