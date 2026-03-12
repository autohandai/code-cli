/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * /learn command — LLM-powered project analysis, skill recommendation,
 * auditing of installed skills, and custom skill generation.
 */
import path from 'node:path';
import chalk from 'chalk';
import fse from 'fs-extra';
import { t } from '../i18n/index.js';
import { LearnAdvisor } from '../skills/LearnAdvisor.js';
import { ProjectAnalyzer } from '../skills/autoSkill.js';
import {
  fetchRegistryWithFallback,
  injectGeneratedMetadata,
  computeProjectHash,
} from '../skills/communityInstaller.js';
import { GitHubRegistryFetcher } from '../skills/GitHubRegistryFetcher.js';
import { CommunitySkillsCache } from '../skills/CommunitySkillsCache.js';
import { AUTOHAND_PATHS, PROJECT_DIR_NAME } from '../constants.js';
import { showConfirm, showModal } from '../ui/ink/components/Modal.js';
import type { LLMProvider } from '../providers/LLMProvider.js';
import type { SkillsRegistry } from '../skills/SkillsRegistry.js';
import type { HookManager } from '../core/HookManager.js';
import type {
  CommunitySkillsRegistry,
  LearnAnalysisResponse,
  SkillInstallScope,
} from '../types.js';
import type { ProjectAnalysis } from '../skills/autoSkill.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface LearnCommandContext {
  skillsRegistry: SkillsRegistry;
  workspaceRoot: string;
  hookManager?: HookManager;
  isNonInteractive?: boolean;
  llm: LLMProvider;
  onProgress?: (message: string) => void;
  onBeforeModal?: () => void;
  onAfterModal?: () => void;
  /** Called with the top recommended skill slug for install hint in the composer */
  onTopRecommendation?: (slug: string) => void;
}

function logProgress(ctx: LearnCommandContext, message: string): void {
  ctx.onProgress?.(message);
  console.log(chalk.cyan(message));
}

async function withModalPause<T>(ctx: LearnCommandContext, fn: () => Promise<T>): Promise<T> {
  ctx.onBeforeModal?.();
  try {
    return await fn();
  } finally {
    ctx.onAfterModal?.();
  }
}

export interface ParsedLearnArgs {
  subcommand: 'recommend' | 'update';
  deep?: boolean;
}

// ─── Arg Parser ──────────────────────────────────────────────────────

export function parseLearnArgs(args: string[]): ParsedLearnArgs {
  if (args.length === 0) {
    return { subcommand: 'recommend', deep: false };
  }

  if (args[0] === 'deep') {
    return { subcommand: 'recommend', deep: true };
  }

  if (args[0] === 'update') {
    return { subcommand: 'update', deep: args.includes('deep') };
  }

  // Legacy: support --deep flag for backwards compat
  if (args.every((a) => a === '--deep')) {
    return { subcommand: 'recommend', deep: true };
  }

  // Default to recommend for any unrecognized args
  return { subcommand: 'recommend', deep: args.includes('deep') || args.includes('--deep') };
}

// ─── Sub-handlers ────────────────────────────────────────────────────

async function handleLearnRecommend(
  ctx: LearnCommandContext,
  deep?: boolean,
): Promise<string> {
  const { skillsRegistry, workspaceRoot, llm, isNonInteractive } = ctx;

  logProgress(ctx, deep ? 'Deep-analyzing your project...' : 'Analyzing your project...');

  // 1. Analyze project
  const analyzer = new ProjectAnalyzer(workspaceRoot);
  const analysis = await analyzer.analyze();

  // 2. Fetch registry
  const cache = new CommunitySkillsCache();
  const fetcher = new GitHubRegistryFetcher();
  logProgress(ctx, 'Loading community skills...');
  let registry: CommunitySkillsRegistry | null = null;
  try {
    registry = await fetchRegistryWithFallback(cache, fetcher);
  } catch {
    // Registry unavailable — continue with empty
  }

  // 3. Collect installed skills
  const installedSkills = skillsRegistry.listSkills();
  const registrySkills = registry?.skills ?? [];

  // 4. Call LLM advisor
  logProgress(ctx, 'Evaluating skill matches...');
  const advisor = new LearnAdvisor(llm);
  const result = await advisor.analyze(analysis, installedSkills, registrySkills);

  // 5. Format output
  const lines: string[] = [];
  lines.push('');

  // Project summary
  if (result.projectSummary) {
    lines.push(chalk.bold(`Project: ${result.projectSummary}`));
    lines.push('');
  }

  // Audit findings
  if (result.audit.length > 0) {
    lines.push(chalk.yellow.bold('Skill Audit'));
    for (const entry of result.audit) {
      const icon =
        entry.status === 'redundant' ? '\u26A0' : entry.status === 'outdated' ? '\u23F0' : '\u26A1';
      lines.push(`  ${icon} **${entry.skill}** — ${entry.status}: ${entry.reason}`);
    }
    lines.push('');
  }

  // Recommendations
  const goodMatches = result.recommendations
    .filter((r) => r.score >= 60)
    .sort((a, b) => b.score - a.score);

  if (goodMatches.length > 0) {
    lines.push(chalk.green.bold('Recommended Skills'));
    for (const rec of goodMatches.slice(0, 5)) {
      lines.push(`  ${chalk.green('\u25CF')} **${rec.slug}** (${rec.score}%) — ${rec.reason}`);
      lines.push(`    {{action:Install|/skills install @${rec.slug}}}`);
    }
    lines.push('');
    // Notify caller of the top recommendation for composer hint
    ctx.onTopRecommendation?.(goodMatches[0].slug);
  } else {
    lines.push(chalk.yellow('No strong matches found in the community registry.'));
    if (result.gapAnalysis) {
      lines.push(chalk.gray(`Gap: ${result.gapAnalysis}`));
    }
    lines.push('');
  }

  // 6. Offer generation if no good matches
  if (goodMatches.length === 0 && !isNonInteractive) {
    // Show context so the user knows what will be generated
    const gapDesc = result.gapAnalysis
      ? `Based on gap analysis: ${result.gapAnalysis}`
      : `A custom skill tailored for your ${analysis.frameworks.join('/') || analysis.languages.join('/')} project.`;
    lines.push(chalk.cyan(gapDesc));

    // Print accumulated output now (before the confirm dialog) so user sees
    // the analysis results. We return only the post-dialog result to avoid
    // the caller printing this text a second time.
    console.log(lines.join('\n'));

    const wantGenerate = await withModalPause(ctx, () =>
      showConfirm({ title: 'Generate a custom skill to fill this gap?' }),
    );
    if (wantGenerate) {
      return await handleGeneration(ctx, analysis, result);
    }
    return '';
  }

  return lines.join('\n');
}

async function handleGeneration(
  ctx: LearnCommandContext,
  analysis: ProjectAnalysis,
  analysisResult: LearnAnalysisResponse,
): Promise<string> {
  const gapHint = analysisResult.gapAnalysis
    ? ` for: ${analysisResult.gapAnalysis}`
    : '';
  logProgress(ctx, `Generating a custom skill${gapHint}...`);

  const advisor = new LearnAdvisor(ctx.llm);
  const lowScoring = analysisResult.recommendations
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const generated = await advisor.generateSkill(analysis, analysisResult.gapAnalysis, lowScoring);

  if (!generated) {
    return (
      chalk.red('Failed to generate a custom skill.\n') +
      chalk.gray('  The LLM may have returned an invalid response. Check your provider is configured and try again.\n') +
      chalk.gray('  Run with DEBUG=1 for detailed error output.')
    );
  }

  // Show what was generated before asking where to install
  console.log(chalk.green(`\nGenerated: ${chalk.bold(generated.name)}`));
  console.log(chalk.gray(`  ${generated.description}`));
  if (generated.allowedTools.length > 0) {
    console.log(chalk.gray(`  Tools: ${generated.allowedTools.join(', ')}`));
  }

  // Ask scope
  const scopeChoice = await withModalPause(ctx, () =>
    showModal({
      title: 'Where should this skill be installed?',
      options: [
        { label: `Project (.autohand/skills/)`, value: 'project' },
        { label: `User (~/.autohand/skills/)`, value: 'user' },
      ],
    }),
  );

  const scope: SkillInstallScope =
    scopeChoice?.value === 'project' ? 'project' : 'user';

  // Build SKILL.md content
  let frontmatter = `---\nname: ${generated.name}\ndescription: ${generated.description}\n`;
  if (generated.allowedTools.length > 0) {
    frontmatter += `allowed-tools: ${generated.allowedTools.join(' ')}\n`;
  }
  frontmatter += `---\n\n`;
  let skillContent = frontmatter + generated.body + '\n';

  // Inject generated metadata
  const projectHash = computeProjectHash(analysis);
  skillContent = injectGeneratedMetadata(skillContent, generated.name, projectHash);

  // Save
  const targetDir =
    scope === 'project'
      ? path.join(ctx.workspaceRoot, PROJECT_DIR_NAME, 'skills')
      : AUTOHAND_PATHS.skills;

  const skillDir = path.join(targetDir, generated.name);
  await fse.ensureDir(skillDir);
  await fse.writeFile(path.join(skillDir, 'SKILL.md'), skillContent, 'utf-8');

  return (
    chalk.green(`Generated and installed skill: ${generated.name}\n`) +
    chalk.gray(`  Location: ${skillDir}/SKILL.md\n`) +
    chalk.gray(`  Use "/skills use ${generated.name}" to activate it.`)
  );
}

async function handleLearnUpdate(ctx: LearnCommandContext): Promise<string> {
  const { skillsRegistry, workspaceRoot, llm } = ctx;

  logProgress(ctx, 'Checking for skill updates...');

  // 1. Analyze current project
  const analyzer = new ProjectAnalyzer(workspaceRoot);
  const analysis = await analyzer.analyze();
  const currentHash = computeProjectHash(analysis);

  // 2. Find LLM-generated skills
  const allSkills = skillsRegistry.listSkills();
  const generatedSkills = allSkills.filter(
    (s) => s.metadata?.['agentskill-source'] === 'llm-generated',
  );

  if (generatedSkills.length === 0) {
    return 'No LLM-generated skills found. Use /learn to generate skills first.';
  }

  // 3. Compare hashes and regenerate stale skills
  const advisor = new LearnAdvisor(llm);
  let updated = 0;
  let unchanged = 0;
  const lines: string[] = [];

  for (const skill of generatedSkills) {
    const storedHash = skill.metadata?.['agentskill-project-hash'];

    if (storedHash === currentHash) {
      unchanged++;
      continue;
    }

    // Project changed — regenerate this skill
    logProgress(ctx, `Regenerating ${skill.name}...`);

    const generated = await advisor.generateSkill(analysis, null, []);

    if (!generated) {
      lines.push(chalk.yellow(`  Failed to regenerate ${skill.name}`));
      continue;
    }

    // Build new SKILL.md with frontmatter + body
    let frontmatter = `---\nname: ${generated.name}\ndescription: ${generated.description}\n`;
    if (generated.allowedTools.length > 0) {
      frontmatter += `allowed-tools: ${generated.allowedTools.join(' ')}\n`;
    }
    frontmatter += `---\n\n`;
    let content = frontmatter + generated.body + '\n';

    // Inject updated generated metadata (source, hash, timestamp)
    content = injectGeneratedMetadata(content, skill.name, currentHash);

    // Write to the skill's existing path
    try {
      await fse.writeFile(skill.path, content, 'utf-8');
      updated++;
      lines.push(chalk.green(`  Regenerated ${skill.name}`));
    } catch {
      lines.push(chalk.yellow(`  Failed to write ${skill.name}`));
    }
  }

  // 4. Report results
  lines.push('');
  if (updated > 0) {
    lines.push(chalk.green(`Updated ${updated} skill${updated !== 1 ? 's' : ''}.`));
  }
  if (unchanged > 0) {
    lines.push(chalk.gray(`${unchanged} skill${unchanged !== 1 ? 's' : ''} already up to date.`));
  }

  return lines.join('\n');
}

// ─── Main Entry Point ────────────────────────────────────────────────

export async function learn(ctx: LearnCommandContext, args: string[]): Promise<string | null> {
  if (!ctx.skillsRegistry) {
    return 'Skills registry not available.';
  }

  const parsed = parseLearnArgs(args);

  switch (parsed.subcommand) {
    case 'recommend':
      return handleLearnRecommend(ctx, parsed.deep);
    case 'update':
      return handleLearnUpdate(ctx);
    default:
      return handleLearnRecommend(ctx, false);
  }
}

// ─── Metadata ────────────────────────────────────────────────────────

export const metadata = {
  command: '/learn',
  description: t('commands.learn.description'),
  implemented: true,
  subcommands: [
    { name: 'deep', description: 'Deep-analyze project for better skill matching' },
    { name: 'update', description: 'Regenerate stale LLM-generated skills' },
  ],
};
