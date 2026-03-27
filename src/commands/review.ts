/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import fse from 'fs-extra';
import type { SlashCommandContext } from '../core/slashCommandTypes.js';

export const metadata = {
  command: '/review',
  description: 'staff-level code review with 10 actionable findings',
  implemented: true,
};

type ReviewCommandContext = SlashCommandContext;

export async function review(ctx: ReviewCommandContext, args: string[] = []): Promise<string | null> {
  const userInstructions = args.join(' ').trim();

  // Load the bundled code-reviewer skill
  const skillPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../skills/builtin/code-reviewer/SKILL.md',
  );

  let skillBody = '';
  try {
    const content = await fse.readFile(skillPath, 'utf-8');
    // Strip YAML frontmatter
    const bodyMatch = content.match(/^---[\s\S]*?---\s*([\s\S]*)$/);
    skillBody = bodyMatch ? bodyMatch[1].trim() : content;
  } catch {
    skillBody =
      'Perform a thorough code review analyzing architecture, security, performance, error handling, and maintainability.';
  }

  // Build the review prompt that combines skill instructions + user intent
  const parts = [
    skillBody,
    '',
    '## Review Target',
    `Workspace: ${ctx.workspaceRoot}`,
  ];

  if (userInstructions) {
    parts.push('', '## Additional Focus', userInstructions);
  }

  parts.push(
    '',
    '## Instructions',
    'Start the review now. Use the available tools (read_file, find, list_tree, git_status, git_diff) to gather context, then deliver your 10-dimension review.',
  );

  return parts.join('\n');
}
