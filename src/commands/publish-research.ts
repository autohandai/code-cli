/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SlashCommand, SlashCommandContext } from '../core/slashCommandTypes.js';

export const metadata: SlashCommand = {
  command: '/publish-research',
  description: 'validate, preview, and publish a saved research report',
  implemented: true,
};

export async function publishResearch(
  ctx: SlashCommandContext,
  args: string[] = [],
): Promise<string> {
  const reportPath = args.join(' ').trim();
  if (!reportPath) {
    return [
      'Usage: /publish-research <path>',
      '',
      'Example: /publish-research .autohand/research/topic-agent-testing.md',
    ].join('\n');
  }
  if (ctx.isNonInteractive || !ctx.requestResearchPublication) {
    return [
      'Research publication requires an interactive terminal and explicit confirmation.',
      `Local report: ${reportPath}`,
    ].join('\n');
  }
  return ctx.requestResearchPublication(reportPath);
}
