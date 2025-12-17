/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import fs from 'fs-extra';
import chalk from 'chalk';
import enquirer from 'enquirer';
import type { LLMProvider } from '../providers/LLMProvider.js';
import { AUTOHAND_PATHS } from '../constants.js';

export const metadata = {
  command: '/agents new',
  description: 'create a new sub-agent from a description',
  implemented: true,
  prd: 'prd/sub_agents_architecture.md'
};

interface Context {
  llm: LLMProvider;
}

export async function createAgent(ctx: Context): Promise<string | null> {
  const answers = await enquirer.prompt<{ name: string; description: string }>([
    {
      type: 'input',
      name: 'name',
      message: 'Agent name (e.g., Researcher, QA Tester)',
      validate: (val: unknown) => (typeof val === 'string' && val.trim() ? true : 'Name is required')
    },
    {
      type: 'input',
      name: 'description',
      message: 'Briefly describe what the agent should do'
    }
  ]);

  const name = answers.name.trim();
  const description = answers.description.trim();
  if (!name) {
    console.log(chalk.gray('Canceled: no name provided.'));
    return null;
  }

  const filename = await ensureUniqueFilename(name);
  const filePath = path.join(getAgentsDir(), filename);

  const prompt = buildPrompt(name, description);
  let content: string;
  try {
    const completion = await ctx.llm.complete({
      messages: [
        {
          role: 'system',
          content:
            'You generate concise markdown definitions for sub-agents. Output only markdown with no code fences. Keep it short but complete.'
        },
        { role: 'user', content: prompt }
      ],
      maxTokens: 600
    });
    content = completion.content.trim();
  } catch (error) {
    console.error(chalk.red(`Failed to generate agent: ${(error as Error).message}`));
    return null;
  }

  try {
    await fs.ensureDir(getAgentsDir());
    await fs.writeFile(filePath, content + '\n', 'utf8');
    console.log(chalk.green(`Saved new agent to ${filePath}`));
  } catch (error) {
    console.error(chalk.red(`Failed to save agent: ${(error as Error).message}`));
    return null;
  }

  return null;
}

function buildPrompt(name: string, description: string): string {
  return [
    `Create a sub-agent markdown file for "${name}".`,
    description ? `Agent description: ${description}` : '',
    'Structure it as:',
    '# <Name>',
    '## Purpose',
    '## Operating Mode (bullet list)',
    '## Tools (bullet list; mention existing CLI tools and constraints briefly)',
    '## Output Contract (what to return to main agent)',
    'Be concise, 120-160 words total.'
  ]
    .filter(Boolean)
    .join('\n');
}

function getAgentsDir(): string {
  return AUTOHAND_PATHS.agents;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent';
}

async function ensureUniqueFilename(name: string): Promise<string> {
  const base = slugify(name);
  const dir = getAgentsDir();
  let candidate = `${base}.md`;
  let counter = 1;
  while (await fs.pathExists(path.join(dir, candidate))) {
    candidate = `${base}-${counter}.md`;
    counter += 1;
  }
  return candidate;
}
