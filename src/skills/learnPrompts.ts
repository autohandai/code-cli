/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Learn Prompts — LLM prompt builders for the /learn advisor
 *
 * Phase 1: Analyze project, audit installed skills, rank catalog
 * Phase 2: Generate a custom skill when no catalog match is good enough
 */
import type { ProjectAnalysis } from './autoSkill.js';
import { buildSkillGenerationPrompt } from './autoSkill.js';
import type { SkillDefinition } from './types.js';
import type { GitHubCommunitySkill, LearnRecommendation } from '../types.js';

/**
 * System prompt for Phase 1 — analyze, rank, and audit.
 * Instructs the LLM to return a structured JSON response with
 * projectSummary, audit, recommendations, and gapAnalysis.
 */
export function buildLearnSystemPrompt(): string {
  return `You are an expert developer tool advisor for Autohand, an AI coding agent.

Your task: Analyze a project, audit its existing skills, and recommend the most valuable community skills from the catalog.

## Analysis Steps

1. **Summarize the project** in one sentence (stack, purpose, patterns)
2. **Audit installed skills**: flag any that are:
   - "redundant": overlaps significantly with another installed skill
   - "outdated": no longer relevant to the current project stack
   - "conflicting": contradicts or interferes with another skill
   Only include entries where there is a genuine issue. Empty array if all skills are fine.
3. **Rank catalog skills** by relevance (0-100):
   - Language/framework match (40 pts)
   - Pattern relevance (30 pts)
   - Gap filling — addresses what installed skills don't cover (20 pts)
   - Specificity (10 pts)
4. **Gap analysis**: if no catalog skill scores above 60, describe the most impactful missing capability in 1-2 sentences. Set to null if good matches exist.

## Rules
- Do NOT inflate scores — a React skill scores 0 for a Rust project
- Do NOT recommend skills that duplicate already-installed ones
- Return ALL catalog skills with their scores, even low ones — the client filters by threshold
- Be honest — if the catalog is poor for this project, say so in gapAnalysis

## Response Format
Return ONLY a JSON object:
{
  "projectSummary": "...",
  "audit": [{ "skill": "name", "status": "redundant|outdated|conflicting", "reason": "..." }],
  "recommendations": [{ "slug": "id", "score": 0-100, "reason": "..." }],
  "gapAnalysis": "..." | null
}`;
}

/**
 * User prompt for Phase 1 — dynamic project context for the LLM.
 */
export function buildLearnUserPrompt(
  analysis: ProjectAnalysis,
  installedSkills: SkillDefinition[],
  registrySkills: GitHubCommunitySkill[],
): string {
  const parts: string[] = [];

  // --- Project Analysis section ---
  parts.push('# Project Analysis');
  parts.push(`**Project:** ${analysis.projectName}`);
  parts.push(`**Languages:** ${analysis.languages.length > 0 ? analysis.languages.join(', ') : 'none detected'}`);
  parts.push(`**Frameworks:** ${analysis.frameworks.length > 0 ? analysis.frameworks.join(', ') : 'none detected'}`);
  parts.push(`**Patterns:** ${analysis.patterns.length > 0 ? analysis.patterns.join(', ') : 'none detected'}`);
  parts.push(`**Package Manager:** ${analysis.packageManager ?? 'unknown'}`);
  parts.push(`**Has Tests:** ${analysis.hasTests ? 'Yes' : 'No'}`);
  parts.push(`**Has CI/CD:** ${analysis.hasCI ? 'Yes' : 'No'}`);

  if (analysis.dependencies.length > 0) {
    const topDeps = analysis.dependencies.slice(0, 30);
    parts.push(`**Key Dependencies:** ${topDeps.join(', ')}`);
  }

  parts.push('');

  // --- Installed Skills section ---
  parts.push('# Currently Installed Skills');
  if (installedSkills.length === 0) {
    parts.push('No skills currently installed.');
  } else {
    for (const skill of installedSkills) {
      parts.push(`- **${skill.name}**: ${skill.description} [source: ${skill.source}]`);
    }
  }

  parts.push('');

  // --- Registry Skills catalog section ---
  parts.push('# Available Community Skills Catalog');
  if (registrySkills.length === 0) {
    parts.push('No community skills available in the catalog.');
  } else {
    const skillWord = registrySkills.length === 1 ? 'community skill' : 'community skills';
    parts.push(`${registrySkills.length} ${skillWord} available.`);

    // Show only skills that match the project's languages/frameworks
    const projectLanguages = new Set(analysis.languages.map((l) => l.toLowerCase()));
    const projectFrameworks = new Set(analysis.frameworks.map((f) => f.toLowerCase()));

    const relevant = registrySkills.filter((skill) => {
      const skillLangs = (skill.languages ?? []).map((l) => l.toLowerCase());
      const skillFw = (skill.frameworks ?? []).map((f) => f.toLowerCase());
      return (
        skillLangs.some((l) => projectLanguages.has(l)) ||
        skillFw.some((f) => projectFrameworks.has(f))
      );
    });

    if (relevant.length > 0) {
      parts.push('');
      parts.push(`## Matching Skills (${relevant.length} match project stack)`);
      for (const skill of relevant.slice(0, 15)) {
        const tags = skill.tags?.join(', ') ?? '';
        const languages = skill.languages?.join(', ') ?? '';
        const frameworks = skill.frameworks?.join(', ') ?? '';
        parts.push(
          `- **${skill.id}**: ${skill.description} [category: ${skill.category}] [tags: ${tags}] [languages: ${languages}] [frameworks: ${frameworks}]`,
        );
      }
      if (relevant.length > 15) {
        parts.push(`  ... and ${relevant.length - 15} more matching skills`);
      }
    }

    parts.push('');
    parts.push('Use the `find_agent_skills` tool to search for additional skills by keyword, category, or framework.');
  }

  parts.push('');
  parts.push('Analyze this project, audit installed skills, and rank the catalog.');

  return parts.join('\n');
}

/**
 * System prompt for Phase 2 — custom skill generation when no catalog
 * skills score well.
 */
export function buildLearnGenerationSystemPrompt(): string {
  return `You are an expert at creating Agent Skills for Autohand, an AI coding assistant.

## Your Task
Generate exactly 1 high-quality, actionable skill tailored to this specific project. The skill should address the most impactful gap — something this project clearly needs but no existing community skill covers.

## Skill Quality Guidelines
1. **Clear Purpose**: Solve a specific, recurring problem for this exact stack
2. **Concrete Examples**: Include 2-3 usage examples showing exact prompts
3. **Actionable Steps**: Provide step-by-step workflows, not vague guidance
4. **Tool Awareness**: Specify which tools the skill needs in allowed-tools
5. **Platform Aware**: Use appropriate commands for the detected OS

## Response Format
Return ONLY a JSON object:
{
  "name": "kebab-case-name",
  "description": "1-2 sentences explaining when to use this skill",
  "allowedTools": ["tool1", "tool2"],
  "body": "Full markdown body with sections: overview, ## When to Use, ## How to Use (with example prompts), ## Workflow (numbered steps), ## Tips"
}

Return ONLY the JSON object, no other text.`;
}

/**
 * User prompt for Phase 2 — combines the base project analysis from
 * autoSkill with gap context and low-scoring catalog matches.
 */
export function buildLearnGenerationUserPrompt(
  analysis: ProjectAnalysis,
  gapAnalysis: string | null,
  lowScoringSkills: LearnRecommendation[],
): string {
  const parts: string[] = [];

  // Start with the shared project analysis prompt
  parts.push(buildSkillGenerationPrompt(analysis));
  parts.push('');

  // Gap context section
  parts.push('## Context');
  parts.push('No existing community skills matched well for this project.');

  // Show top 3 closest matches if any
  const topThree = lowScoringSkills.slice(0, 3);
  if (topThree.length > 0) {
    parts.push('The closest matches were:');
    for (const rec of topThree) {
      parts.push(`- **${rec.slug}** (score: ${rec.score}): ${rec.reason}`);
    }
  }

  parts.push('');

  if (gapAnalysis !== null) {
    parts.push(`Gap analysis: ${gapAnalysis}`);
    parts.push('');
  }

  parts.push('Generate a skill that fills the most important gap for this project.');

  return parts.join('\n');
}
