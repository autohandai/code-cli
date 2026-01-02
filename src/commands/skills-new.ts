/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Skills new command - Generate a new skill from description using LLM
 */
import path from 'node:path';
import fs from 'fs-extra';
import chalk from 'chalk';
import { safePrompt } from '../utils/prompt.js';
import type { LLMProvider } from '../providers/LLMProvider.js';
import type { SkillsRegistry } from '../skills/SkillsRegistry.js';
import { AUTOHAND_PATHS } from '../constants.js';
import { isValidSkillName } from '../skills/types.js';

export const metadata = {
  command: '/skills new',
  description: 'create a new skill from a description',
  implemented: true,
  prd: 'prd/skills_feature.md'
};

interface SkillsNewContext {
  llm: LLMProvider;
  skillsRegistry: SkillsRegistry;
  workspaceRoot: string;
}

type StorageLevel = 'project' | 'user';

const SIMILARITY_THRESHOLD = 0.9;

export async function createSkill(ctx: SkillsNewContext): Promise<string | null> {
  const { llm, skillsRegistry } = ctx;

  if (!skillsRegistry) {
    console.log(chalk.red('Skills registry not available.'));
    return null;
  }

  // Step 1: Get skill name and description from user
  const answers = await safePrompt<{ name: string; description: string }>([
    {
      type: 'input',
      name: 'name',
      message: 'Skill name (lowercase, hyphens allowed)',
      validate: (val: unknown) => {
        if (typeof val !== 'string' || !val.trim()) {
          return 'Name is required';
        }
        if (!isValidSkillName(val.trim())) {
          return 'Name must be lowercase alphanumeric with hyphens only (max 64 chars)';
        }
        return true;
      }
    },
    {
      type: 'input',
      name: 'description',
      message: 'Describe what this skill should help with',
      validate: (val: unknown) => {
        if (typeof val !== 'string' || !val.trim()) {
          return 'Description is required';
        }
        if (val.length > 1024) {
          return 'Description must be 1024 characters or less';
        }
        return true;
      }
    }
  ]);

  if (!answers) {
    console.log(chalk.gray('Cancelled.'));
    return null;
  }

  const name = answers.name.trim().toLowerCase();
  const description = answers.description.trim();

  if (!name) {
    console.log(chalk.gray('Canceled: no name provided.'));
    return null;
  }

  // Step 1b: Ask where to save the skill
  const storageResult = await safePrompt<{ level: StorageLevel }>({
    type: 'select',
    name: 'level',
    message: 'Where should this skill be saved?',
    choices: [
      { name: 'project', message: `Project level (.autohand/skills/) - specific to this project` },
      { name: 'user', message: `User level (~/.autohand/skills/) - available in all projects` }
    ]
  });

  if (!storageResult) {
    console.log(chalk.gray('Cancelled.'));
    return null;
  }

  const storageLevel = storageResult.level;

  // Step 2: Check for existing skill with same name
  if (skillsRegistry.hasSkill(name)) {
    console.log(chalk.yellow(`A skill named "${name}" already exists.`));
    const result = await safePrompt<{ overwrite: boolean }>({
      type: 'confirm',
      name: 'overwrite',
      message: 'Do you want to overwrite it?',
      initial: false
    });

    if (!result || !result.overwrite) {
      console.log(chalk.gray('Canceled.'));
      return null;
    }
  }

  // Step 3: Check for similar skills using Jaccard similarity
  const similar = skillsRegistry.findSimilar(description, SIMILARITY_THRESHOLD);
  if (similar.length > 0) {
    console.log(chalk.yellow('\nFound similar existing skill(s):'));
    for (const match of similar.slice(0, 3)) {
      console.log(chalk.gray(`  - ${match.skill.name}: ${match.skill.description}`));
      console.log(chalk.gray(`    Similarity: ${(match.score * 100).toFixed(0)}%`));
    }
    console.log();

    const result = await safePrompt<{ proceed: string }>({
      type: 'select',
      name: 'proceed',
      message: 'How would you like to proceed?',
      choices: [
        { name: 'continue', message: 'Continue creating new skill' },
        { name: 'use', message: `Use existing skill "${similar[0].skill.name}" instead` },
        { name: 'cancel', message: 'Cancel' }
      ]
    });

    if (!result || result.proceed === 'cancel') {
      console.log(chalk.gray('Canceled.'));
      return null;
    }

    if (result.proceed === 'use') {
      const existingSkill = similar[0].skill;
      skillsRegistry.activateSkill(existingSkill.name);
      console.log(chalk.green(`✓ Activated existing skill: ${existingSkill.name}`));
      return `Activated existing skill "${existingSkill.name}".`;
    }
  }

  // Step 4: Generate skill content using LLM
  console.log(chalk.cyan('\nGenerating skill content...'));

  const prompt = buildPrompt(name, description);
  let content: string;

  try {
    const completion = await llm.complete({
      messages: [
        {
          role: 'system',
          content: `You are an expert at creating Agent Skills (SKILL.md files).
Generate a complete SKILL.md file with proper YAML frontmatter and markdown body.
The skill should provide clear, actionable instructions that an AI agent can follow.
Focus on practical workflows and step-by-step guidance.
Output only the raw markdown content, no code fences.`
        },
        { role: 'user', content: prompt }
      ],
      maxTokens: 1500
    });
    content = completion.content.trim();
  } catch (error) {
    console.error(chalk.red(`Failed to generate skill: ${(error as Error).message}`));
    return null;
  }

  // Step 5: Preview and confirm
  console.log();
  console.log(chalk.bold('Preview:'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(content.length > 800 ? content.slice(0, 800) + '\n...(truncated)' : content);
  console.log(chalk.gray('─'.repeat(50)));
  console.log();

  const confirmResult = await safePrompt<{ confirm: boolean }>({
    type: 'confirm',
    name: 'confirm',
    message: 'Save this skill?',
    initial: true
  });

  if (!confirmResult || !confirmResult.confirm) {
    console.log(chalk.gray('Canceled.'));
    return null;
  }

  // Step 6: Save the skill
  const baseDir = storageLevel === 'project'
    ? path.join(ctx.workspaceRoot, '.autohand', 'skills')
    : AUTOHAND_PATHS.skills;
  const skillDir = path.join(baseDir, name);
  const skillPath = path.join(skillDir, 'SKILL.md');

  try {
    await fs.ensureDir(skillDir);
    await fs.writeFile(skillPath, content + '\n', 'utf8');
    console.log(chalk.green(`✓ Saved new skill to ${skillPath}`));

    // Reload the skill into the registry
    const success = await skillsRegistry.saveSkill(name, content);
    if (success) {
      // Optionally activate the new skill
      const activateResult = await safePrompt<{ activate: boolean }>({
        type: 'confirm',
        name: 'activate',
        message: 'Activate this skill now?',
        initial: true
      });

      if (activateResult?.activate) {
        skillsRegistry.activateSkill(name);
        console.log(chalk.green(`✓ Skill "${name}" is now active.`));
      }
    }
  } catch (error) {
    console.error(chalk.red(`Failed to save skill: ${(error as Error).message}`));
    return null;
  }

  return `Created new skill: ${name}`;
}

function buildPrompt(name: string, description: string): string {
  return `Create a SKILL.md file for a skill named "${name}".

Description: ${description}

The file must have:
1. YAML frontmatter with:
   - name: ${name}
   - description: A clear one-line description (max 100 chars)
   - Optional: license, compatibility, allowed-tools

2. Markdown body with:
   - A heading with the skill name
   - Clear purpose statement
   - Step-by-step workflow or instructions
   - Best practices or tips
   - Example usage if applicable

Make the instructions practical and actionable for an AI coding agent.
Keep the total content concise but complete (200-400 words in body).

Output format:
---
name: ${name}
description: <description here>
---

# <Title>

<body content here>`;
}
