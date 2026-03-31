/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import type { SlashCommandContext } from '../core/slashCommandTypes.js';

export const metadata = {
  command: '/pr-review',
  description: 'review a pull request using gh metadata and diff context',
  implemented: true,
};

type PrReviewCommandContext = SlashCommandContext;

function buildPrompt(workspaceRoot: string, prSelector: string, additionalFocus: string): string {
  const ghViewCommand = prSelector ? `gh pr view ${prSelector}` : 'gh pr view <number>';
  const ghDiffCommand = prSelector ? `gh pr diff ${prSelector}` : 'gh pr diff <number>';

  const parts = [
    'You are a staff-level pull request reviewer.',
    '',
    '## Pull Request Review Target',
    `Workspace: ${workspaceRoot}`,
    prSelector ? `PR selector: ${prSelector}` : 'PR selector: not provided',
    '',
    '## Review Workflow',
    '1. Confirm this is a GitHub repository and that the GitHub CLI is available.',
    '2. If no PR selector is provided, run `gh pr list` and choose the most relevant open pull request before continuing.',
    `3. Run \`${ghViewCommand}\` to gather PR metadata, changed files, title, base branch, and status.`,
    `4. Run \`${ghDiffCommand}\` to inspect the actual patch before reviewing.`,
    '5. Use repository tools such as `read_file`, `find`, `git_diff`, and `git_status` to inspect the touched code paths in detail.',
    '',
    '## Review Output',
    'Deliver findings first, ordered by severity, with concrete file references when possible.',
    'Focus on correctness, regressions, missing tests, performance, security, and maintainability.',
    'Keep the summary brief and only include it after the findings.',
  ];

  if (additionalFocus) {
    parts.push('', '## Additional Focus', additionalFocus);
  }

  return parts.join('\n');
}

export async function prReview(ctx: PrReviewCommandContext, args: string[] = []): Promise<string | null> {
  const [firstArg, ...restArgs] = args;
  const prSelector = firstArg?.trim() ?? '';
  const additionalFocus = restArgs.join(' ').trim();
  const prompt = buildPrompt(ctx.workspaceRoot, prSelector, additionalFocus);

  if (ctx.isNonInteractive || !ctx.queueInstruction) {
    return prompt;
  }

  ctx.queueInstruction(prompt);
  console.log(chalk.cyan('\n  Starting pull request review...'));
  if (prSelector) {
    console.log(chalk.gray(`  PR selector: ${prSelector}`));
  }
  if (additionalFocus) {
    console.log(chalk.gray(`  Focus: ${additionalFocus}`));
  }
  console.log(chalk.gray('  Gathering GitHub metadata and diff context before reviewing.\n'));
  return null;
}
