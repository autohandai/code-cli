/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fse from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SlashCommand, SlashCommandContext } from '../core/slashCommandTypes.js';
import {
  DEEP_RESEARCH_RUN_MARKER,
  formatDeepResearchStatus,
  readDeepResearchRun,
  startDeepResearchRun,
} from '../deepResearch/session.js';

export const metadata: SlashCommand = {
  command: '/deep-research',
  description: 'research a topic deeply and save a cited project report',
  implemented: true,
  subcommands: [
    { name: 'status', description: 'show vital progress for the active deep research run' },
  ],
};

export const aliasMetadata: SlashCommand = {
  command: '/deep-search',
  description: 'alias for /deep-research',
  implemented: true,
  subcommands: metadata.subcommands,
};

const MAX_COLLISION_ATTEMPTS = 1000;

export function slugifyResearchTopic(topic: string): string {
  const slug = topic
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return slug || 'research';
}

export async function resolveAvailableResearchReportPath(
  workspaceRoot: string,
  topic: string
): Promise<string> {
  const researchDir = path.join(workspaceRoot, '.autohand', 'research');
  await fse.ensureDir(researchDir);

  const slug = slugifyResearchTopic(topic);
  for (let index = 1; index <= MAX_COLLISION_ATTEMPTS; index += 1) {
    const suffix = index === 1 ? '' : `-${index}`;
    const candidate = path.join(researchDir, `topic-${slug}${suffix}.md`);
    if (!(await fse.pathExists(candidate))) {
      return candidate;
    }
  }

  return path.join(researchDir, `topic-${slug}-${Date.now()}.md`);
}

export async function deepResearch(
  ctx: SlashCommandContext,
  args: string[] = []
): Promise<string | null> {
  if (args[0]?.toLowerCase() === 'status') {
    return getDeepResearchStatus(ctx);
  }

  const topic = args.join(' ').trim();
  if (!topic) {
    return [
      'Usage: /deep-research <topic> | /deep-research status',
      '',
      'Example: /deep-research Hermes self evolving and DSPy',
      '',
      'Provide a topic or question so Autohand can research it and save a cited report under .autohand/research/.',
    ].join('\n');
  }

  const existingRun = await readDeepResearchRun(ctx.workspaceRoot);
  if (existingRun?.status === 'queued' || existingRun?.status === 'running') {
    return [
      `Deep research is already ${existingRun.status}: ${existingRun.topic}`,
      'Use /deep-research status to inspect its progress.',
    ].join('\n');
  }

  const reportPath = await resolveAvailableResearchReportPath(ctx.workspaceRoot, topic);
  const projectRelativeReportPath = toProjectRelativePath(ctx.workspaceRoot, reportPath);
  const currentSession = ctx.currentSession ?? ctx.sessionManager?.getCurrentSession() ?? undefined;
  const run = await startDeepResearchRun({
    workspaceRoot: ctx.workspaceRoot,
    topic,
    reportPath: projectRelativeReportPath,
    sessionId: currentSession?.metadata.sessionId,
  });
  const skillBody = await loadDeepResearchSkillBody();
  const prompt = buildDeepResearchPrompt({
    topic,
    projectRelativeReportPath,
    skillBody,
    runId: run.id,
  });

  if (ctx.isNonInteractive || !ctx.queueInstruction) {
    return prompt;
  }

  const activated = ctx.skillsRegistry?.activateSkill('deep-research') ?? false;
  ctx.queueInstruction(prompt);

  return [
    'Deep research started.',
    activated
      ? 'The built-in $deep-research skill is active for this run.'
      : 'The bundled deep-research instructions were queued for this run.',
    `Report target: ${projectRelativeReportPath}`,
    'Status: /deep-research status (alias: /deep-search status)',
  ].join('\n');
}

function buildDeepResearchPrompt(options: {
  topic: string;
  projectRelativeReportPath: string;
  skillBody: string;
  runId: string;
}): string {
  return [
    options.skillBody,
    '',
    '## Runtime Identity',
    `${DEEP_RESEARCH_RUN_MARKER}: ${options.runId}`,
    '- Keep this run identifier unchanged so the CLI can audit progress and completion.',
    '',
    '## Research Topic',
    options.topic,
    '',
    '## Autohand Runtime Contract',
    '- Use `todo_write` to track the research phases and visible progress.',
    '- Use `web_search` for discovery and `fetch_url` to read primary or high-quality sources.',
    '- Use `tool_search` if agent, task, or parallel research tools are available and the topic benefits from delegation.',
    '- Use `read_file` only for relevant local project context.',
    '- Use `write_file` to save the completed report.',
    '',
    '## Report Persistence Contract',
    `- Save the final report at exactly \`${options.projectRelativeReportPath}\`.`,
    '- Create `.autohand/research/` first if it does not exist.',
    '- Do not overwrite a different research report path. The slash command has already selected an available filename.',
    '- The report must be self-contained markdown with inline citations and a numbered Sources section.',
    '',
    '## Completion Contract',
    '- Do not stop until the research question is answered with cited evidence or clearly bounded uncertainty.',
    '- Do not stop until the report has been written with `write_file`.',
    `- In the final answer, include the exact line: Research saved: ${options.projectRelativeReportPath}`,
    '- Make the saved report useful for the next user prompt by including a clear title, Summary, Findings, Open questions/uncertainty, and Sources.',
  ].join('\n');
}

async function getDeepResearchStatus(ctx: SlashCommandContext): Promise<string> {
  const run = await readDeepResearchRun(ctx.workspaceRoot);
  const currentSession = ctx.currentSession ?? ctx.sessionManager?.getCurrentSession() ?? undefined;
  const messages = run
    && currentSession
    && (!run.sessionId || run.sessionId === currentSession.metadata.sessionId)
    ? currentSession.getMessages()
    : [];

  return formatDeepResearchStatus({
    workspaceRoot: ctx.workspaceRoot,
    messages,
    totalTokensUsed: ctx.getTotalTokensUsed?.(),
    tokenUsageStatus: ctx.getTokenUsageStatus?.(),
    contextPercentLeft: ctx.getContextPercentLeft?.(),
  });
}

async function loadDeepResearchSkillBody(): Promise<string> {
  const skillPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../skills/builtin/deep-research/SKILL.md',
  );

  try {
    const content = await fse.readFile(skillPath, 'utf-8');
    const bodyMatch = content.match(/^---[\s\S]*?---\s*([\s\S]*)$/);
    return bodyMatch ? bodyMatch[1].trim() : content.trim();
  } catch {
    return [
      'Conduct iterative, multi-source deep research on the requested topic.',
      'Scope the question, gather evidence with web search and fetch tools, cross-check facts, and produce a cited markdown report.',
    ].join('\n');
  }
}

function toProjectRelativePath(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).split(path.sep).join('/');
}
