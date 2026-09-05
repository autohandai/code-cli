/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fse from 'fs-extra';
import type { SlashCommandContext } from '../core/slashCommandTypes.js';
import {
  REVIEW_KINDS,
  buildReviewInstruction,
  formatReviewHelp,
  parseReviewArguments,
  type ReviewRequest,
} from '../review/reviewRequest.js';

export const metadata = {
  command: '/review',
  description: 'run the Autohand review workflow against changes, code, architecture, security, performance, or history',
  implemented: true,
  subcommands: REVIEW_KINDS.map((kind) => ({
    name: kind,
    description: `${kind} review`,
  })),
};

type ReviewCommandContext = SlashCommandContext;

export type ReviewCommandResolution =
  | { type: 'instruction'; request: ReviewRequest; instruction: string }
  | { type: 'output'; output: string };

type ReviewArgumentsResolution =
  | { type: 'request'; request: ReviewRequest }
  | { type: 'output'; output: string };

const REVIEW_EXECUTION_GUIDANCE = [
  'Autohand Review requires an execution surface.',
  'Use /review in an interactive, ACP, or JSON-RPC session, or run "autohand review" for one-shot non-interactive output.',
].join(' ');

const FALLBACK_SPECIALIST_INSTRUCTIONS = [
  '# Autohand Review',
  '',
  'Conduct a read-only, evidence-led code and architecture review. Report only concrete risks with precise evidence, impact, remediation, and verification.',
  '',
  '### Executive view',
  'Explain the verdict and decisions in plain language.',
  '',
  '### Technical findings',
  'Prioritize reproducible findings by severity and confidence.',
  '',
  '### Forensic appendix',
  'Record repository state, scope, provenance, hypotheses, and blind spots.',
  '',
  '### Evidence boundary',
  'State what the inspection proves and does not prove.',
].join('\n');

function stripFrontmatter(content: string): string {
  const bodyMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\s*([\s\S]*)$/);
  return bodyMatch ? bodyMatch[1].trim() : content.trim();
}

async function loadSpecialistInstructions(): Promise<string> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(moduleDir, '../agents/builtin/autohand-review.md'),
    path.resolve(moduleDir, 'agents/builtin/autohand-review.md'),
  ];

  for (const candidate of candidates) {
    try {
      return stripFrontmatter(await fse.readFile(candidate, 'utf-8'));
    } catch {
      continue;
    }
  }
  return FALLBACK_SPECIALIST_INSTRUCTIONS;
}

export async function resolveReviewCommand(
  workspaceRoot: string,
  args: readonly string[] = [],
): Promise<ReviewCommandResolution> {
  const resolution = resolveReviewArguments(args);
  if (resolution.type === 'output') return resolution;

  return {
    type: 'instruction',
    request: resolution.request,
    instruction: await buildReviewCommandInstruction(workspaceRoot, resolution.request),
  };
}

function resolveReviewArguments(args: readonly string[]): ReviewArgumentsResolution {
  const parsed = parseReviewArguments(args);
  if (!parsed.ok) {
    return {
      type: 'output',
      output: `${parsed.error}\n\n${formatReviewHelp()}`,
    };
  }
  if ('help' in parsed) {
    return { type: 'output', output: formatReviewHelp() };
  }

  return { type: 'request', request: parsed.request };
}

export async function buildReviewCommandInstruction(
  workspaceRoot: string,
  request: ReviewRequest,
): Promise<string> {
  const specialistInstructions = await loadSpecialistInstructions();
  return buildReviewInstruction({
    request,
    workspaceRoot,
    specialistInstructions,
  });
}

export async function review(ctx: ReviewCommandContext, args: string[] = []): Promise<string | null> {
  const resolution = resolveReviewArguments(args);
  if (resolution.type === 'output') return resolution.output;

  if (ctx.isNonInteractive || !ctx.queueInstruction) {
    return REVIEW_EXECUTION_GUIDANCE;
  }

  const instruction = await buildReviewCommandInstruction(ctx.workspaceRoot, resolution.request);
  ctx.queueInstruction(instruction, {
    kind: 'review-lifecycle',
    request: resolution.request,
    surface: 'interactive',
  });
  console.log(chalk.cyan('\n  Starting Autohand Review...'));
  console.log(chalk.gray(
    `  ${resolution.request.kind} · ${resolution.request.audience} audience · read-only`,
  ));
  if (resolution.request.target) {
    console.log(chalk.gray(`  Target: ${resolution.request.target}`));
  }
  if (resolution.request.focus) {
    console.log(chalk.gray(`  Focus: ${resolution.request.focus}`));
  }
  console.log();
  return null;
}
