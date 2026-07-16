/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import type { SessionMessage } from '../session/types.js';

export const DEEP_RESEARCH_RUN_MARKER = 'AUTOHAND_DEEP_RESEARCH_RUN_ID';
export const DEEP_RESEARCH_STATUS_PATH = path.join('.autohand', 'research', 'status.json');

export type DeepResearchRunStatus = 'queued' | 'running' | 'incomplete' | 'completed';

export interface DeepResearchRun {
  id: string;
  topic: string;
  reportPath: string;
  status: DeepResearchRunStatus;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
  sessionId?: string;
  blockers: string[];
}

export interface DeepResearchTaskProgress {
  total: number;
  completed: number;
  inProgress: string[];
  pending: number;
}

export interface DeepResearchProgress {
  tasks: DeepResearchTaskProgress;
  totalToolCalls: number;
  searches: number;
  pagesFetched: number;
  repositoriesChecked: number;
  failedToolResults: number;
  currentTool?: string;
  lastActivityAt?: string;
}

export interface StartDeepResearchRunOptions {
  workspaceRoot: string;
  topic: string;
  reportPath: string;
  sessionId?: string;
}

export interface FinalizeDeepResearchRunOptions {
  workspaceRoot: string;
  runId: string;
  turnSucceeded: boolean;
  qualityPassed: boolean;
  finalResponse: string;
  messages: SessionMessage[];
}

export interface DeepResearchStatusOptions {
  workspaceRoot: string;
  messages?: SessionMessage[];
  totalTokensUsed?: number;
  tokenUsageStatus?: 'actual' | 'unavailable';
  contextPercentLeft?: number;
}

interface RecordedToolCall {
  id?: string;
  tool: string;
  args: Record<string, unknown>;
}

interface ResearchTask {
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export async function startDeepResearchRun(
  options: StartDeepResearchRunOptions,
): Promise<DeepResearchRun> {
  const now = new Date().toISOString();
  const run: DeepResearchRun = {
    id: randomUUID(),
    topic: options.topic,
    reportPath: options.reportPath,
    status: 'queued',
    queuedAt: now,
    updatedAt: now,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    blockers: [],
  };
  await writeDeepResearchRun(options.workspaceRoot, run);
  return run;
}

export async function readDeepResearchRun(workspaceRoot: string): Promise<DeepResearchRun | null> {
  const statusPath = path.join(workspaceRoot, DEEP_RESEARCH_STATUS_PATH);
  if (!(await fs.pathExists(statusPath))) {
    return null;
  }

  try {
    const value: unknown = await fs.readJson(statusPath);
    return isDeepResearchRun(value) ? value : null;
  } catch {
    return null;
  }
}

export async function markDeepResearchRunStarted(
  workspaceRoot: string,
  runId: string,
): Promise<DeepResearchRun | null> {
  const run = await readDeepResearchRun(workspaceRoot);
  if (!run || run.id !== runId || run.status === 'completed') {
    return null;
  }

  const now = new Date().toISOString();
  const running: DeepResearchRun = {
    ...run,
    status: 'running',
    startedAt: run.startedAt ?? now,
    completedAt: undefined,
    updatedAt: now,
    blockers: [],
  };
  await writeDeepResearchRun(workspaceRoot, running);
  return running;
}

export function extractDeepResearchRunId(instruction: string): string | null {
  const match = instruction.match(new RegExp(`${DEEP_RESEARCH_RUN_MARKER}:\\s*([a-f0-9-]+)`, 'i'));
  return match?.[1] ?? null;
}

export function getDeepResearchProgress(
  run: DeepResearchRun,
  messages: SessionMessage[],
): DeepResearchProgress {
  const relevantMessages = messages.filter((message) => isMessageFromRun(message, run));
  const calls = relevantMessages.flatMap(readToolCalls);
  const resultIds = new Set(
    relevantMessages
      .filter((message) => message.role === 'tool' && typeof message.tool_call_id === 'string')
      .map((message) => message.tool_call_id as string),
  );
  const latestTasks = findLatestTasks(calls);
  const currentCall = [...calls]
    .reverse()
    .find((call) => call.id && !resultIds.has(call.id));
  const lastActivityAt = relevantMessages
    .map((message) => message.timestamp)
    .filter((timestamp) => Number.isFinite(Date.parse(timestamp)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];

  return {
    tasks: {
      total: latestTasks.length,
      completed: latestTasks.filter((task) => task.status === 'completed').length,
      inProgress: latestTasks
        .filter((task) => task.status === 'in_progress')
        .map((task) => task.title),
      pending: latestTasks.filter((task) => task.status === 'pending').length,
    },
    totalToolCalls: calls.length,
    searches: calls.filter((call) => call.tool === 'web_search').length,
    pagesFetched: calls.filter((call) => call.tool === 'fetch_url').length,
    repositoriesChecked: calls.filter((call) => call.tool === 'web_repo').length,
    failedToolResults: relevantMessages.filter(isFailedToolResult).length,
    ...(currentCall ? { currentTool: currentCall.tool } : {}),
    ...(lastActivityAt ? { lastActivityAt } : {}),
  };
}

export async function formatDeepResearchStatus(
  options: DeepResearchStatusOptions,
): Promise<string> {
  const run = await readDeepResearchRun(options.workspaceRoot);
  if (!run) {
    return 'No deep research run found. Start one with /deep-research <topic>.';
  }

  const progress = getDeepResearchProgress(run, options.messages ?? []);
  const reportPath = safeReportPath(options.workspaceRoot, run.reportPath);
  const reportStat = reportPath && await fs.pathExists(reportPath)
    ? await fs.stat(reportPath)
    : null;
  const elapsedEnd = run.completedAt ? Date.parse(run.completedAt) : Date.now();
  const elapsedStart = Date.parse(run.startedAt ?? run.queuedAt);
  const lines = [
    'Deep research status',
    `State: ${formatRunStatus(run.status)}`,
    `Topic: ${run.topic}`,
    `Elapsed: ${formatDuration(Math.max(0, elapsedEnd - elapsedStart))}`,
  ];

  if (progress.lastActivityAt) {
    lines.push(`Last activity: ${formatAge(Date.now() - Date.parse(progress.lastActivityAt))}`);
  }

  if (progress.tasks.total > 0) {
    lines.push(
      `Progress: ${progress.tasks.completed}/${progress.tasks.total} completed · `
      + `${progress.tasks.inProgress.length} in progress · ${progress.tasks.pending} pending`,
    );
    if (progress.tasks.inProgress.length > 0) {
      lines.push(`Current: ${progress.tasks.inProgress.join('; ')}`);
    }
  } else {
    lines.push('Progress: No task plan recorded yet.');
  }

  lines.push(
    `Activity: ${formatCount(progress.searches, 'search', 'searches')} · `
    + `${formatCount(progress.pagesFetched, 'page fetched', 'pages fetched')} · `
    + `${formatCount(progress.repositoriesChecked, 'repository checked', 'repositories checked')} · `
    + `${formatCount(progress.totalToolCalls, 'tool call', 'tool calls')} · `
    + `${formatCount(progress.failedToolResults, 'failed tool result', 'failed tool results')}`,
  );
  if (progress.currentTool) {
    lines.push(`Current tool: ${progress.currentTool}`);
  }

  lines.push(
    reportStat
      ? `Report: ${run.reportPath} (${formatBytes(reportStat.size)})`
      : `Report: ${run.reportPath} (not written yet)`,
  );

  if (options.tokenUsageStatus === 'unavailable') {
    lines.push('Tokens: unavailable');
  } else if (options.totalTokensUsed !== undefined) {
    lines.push(`Tokens: ${Math.max(0, Math.round(options.totalTokensUsed)).toLocaleString('en-US')}`);
  }
  if (options.contextPercentLeft !== undefined) {
    const percent = Math.max(0, Math.min(100, Math.round(options.contextPercentLeft)));
    lines.push(`Context remaining: ${percent}%`);
  }

  if (run.blockers.length > 0) {
    lines.push('Blockers:');
    lines.push(...run.blockers.map((blocker) => `- ${blocker}`));
  }

  return lines.join('\n');
}

export async function finalizeDeepResearchRun(
  options: FinalizeDeepResearchRunOptions,
): Promise<{ completed: boolean; blockers: string[] }> {
  const run = await readDeepResearchRun(options.workspaceRoot);
  if (!run || run.id !== options.runId) {
    return { completed: false, blockers: ['The deep research run could not be found.'] };
  }

  const blockers: string[] = [];
  if (!options.turnSucceeded) {
    blockers.push('The research turn did not finish successfully.');
  }
  if (!options.qualityPassed) {
    blockers.push('Project quality checks failed.');
  }

  const progress = getDeepResearchProgress(run, options.messages);
  if (progress.tasks.total === 0) {
    blockers.push('No research task plan was recorded.');
  } else if (progress.tasks.completed !== progress.tasks.total) {
    blockers.push(
      `Research tasks remain unfinished (${progress.tasks.completed} of ${progress.tasks.total} completed).`,
    );
  }

  blockers.push(...await validateReport(options.workspaceRoot, run.reportPath));
  const now = new Date().toISOString();
  const completed = blockers.length === 0;
  await writeDeepResearchRun(options.workspaceRoot, {
    ...run,
    status: completed ? 'completed' : 'incomplete',
    completedAt: completed ? now : undefined,
    updatedAt: now,
    blockers,
  });

  return { completed, blockers };
}

async function validateReport(workspaceRoot: string, reportPath: string): Promise<string[]> {
  const absolutePath = safeReportPath(workspaceRoot, reportPath);
  if (!absolutePath) {
    return ['The report path is outside .autohand/research/.'];
  }
  if (!(await fs.pathExists(absolutePath))) {
    return ['The report has not been written.'];
  }

  const content = await fs.readFile(absolutePath, 'utf8');
  const blockers: string[] = [];
  const requiredSections: Array<[RegExp, string]> = [
    [/^#\s+\S+/m, 'a title'],
    [/^##\s+Summary\b/im, 'a Summary section'],
    [/^##\s+Findings\b/im, 'a Findings section'],
    [/^##\s+Open questions(?:\s*\/\s*uncertainty)?\b/im, 'an Open questions / uncertainty section'],
    [/^##\s+Sources\b/im, 'a Sources section'],
  ];
  for (const [pattern, label] of requiredSections) {
    if (!pattern.test(content)) {
      blockers.push(`The report is missing ${label}.`);
    }
  }

  const findingsContent = content.split(/^##\s+Sources\b/im)[0] ?? content;
  const citedNumbers = new Set(
    [...findingsContent.matchAll(/\[(\d+)\]/g)].map((match) => match[1]),
  );
  if (citedNumbers.size < 2) {
    blockers.push('The report needs at least two inline source citations.');
  }

  const sourcesContent = content.split(/^##\s+Sources\b/im)[1] ?? '';
  const sourceLines = sourcesContent
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:\d+[.)]|\[\d+\])\s+.*https?:\/\//i.test(line));
  if (sourceLines.length < 2) {
    blockers.push('The Sources section needs at least two numbered URLs.');
  }

  return blockers;
}

function readToolCalls(message: SessionMessage): RecordedToolCall[] {
  if (!Array.isArray(message.toolCalls)) {
    return [];
  }

  return message.toolCalls.flatMap((value: unknown) => {
    if (!value || typeof value !== 'object') {
      return [];
    }
    const record = value as Record<string, unknown>;
    const fn = record.function && typeof record.function === 'object'
      ? record.function as Record<string, unknown>
      : null;
    const tool = typeof record.tool === 'string'
      ? record.tool
      : typeof fn?.name === 'string'
        ? fn.name
        : null;
    if (!tool) {
      return [];
    }

    return [{
      ...(typeof record.id === 'string' ? { id: record.id } : {}),
      tool,
      args: parseToolArgs(record.args ?? fn?.arguments),
    }];
  });
}

function parseToolArgs(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function findLatestTasks(calls: RecordedToolCall[]): ResearchTask[] {
  const todoCall = [...calls].reverse().find((call) => call.tool === 'todo_write');
  const tasks = todoCall?.args.tasks;
  if (!Array.isArray(tasks)) {
    return [];
  }

  return tasks.flatMap((value: unknown) => {
    if (!value || typeof value !== 'object') {
      return [];
    }
    const task = value as Record<string, unknown>;
    const title = typeof task.title === 'string'
      ? task.title
      : typeof task.content === 'string'
        ? task.content
        : null;
    const status = task.status;
    if (!title || (status !== 'pending' && status !== 'in_progress' && status !== 'completed')) {
      return [];
    }
    return [{ title, status }];
  });
}

function isMessageFromRun(message: SessionMessage, run: DeepResearchRun): boolean {
  const messageTime = Date.parse(message.timestamp);
  const runTime = Date.parse(run.queuedAt);
  return !Number.isFinite(messageTime) || !Number.isFinite(runTime) || messageTime >= runTime;
}

function isFailedToolResult(message: SessionMessage): boolean {
  if (message.role !== 'tool') {
    return false;
  }
  return /\b(error|failed|failure|not found|denied|timed out|unable to)\b/i.test(message.content);
}

function safeReportPath(workspaceRoot: string, reportPath: string): string | null {
  const researchRoot = path.resolve(workspaceRoot, '.autohand', 'research');
  const absolutePath = path.resolve(workspaceRoot, reportPath);
  const relative = path.relative(researchRoot, absolutePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? absolutePath
    : null;
}

async function writeDeepResearchRun(workspaceRoot: string, run: DeepResearchRun): Promise<void> {
  const statusPath = path.join(workspaceRoot, DEEP_RESEARCH_STATUS_PATH);
  await fs.ensureDir(path.dirname(statusPath));
  const tempPath = `${statusPath}.${randomUUID()}.tmp`;
  await fs.writeJson(tempPath, run, { spaces: 2 });
  await fs.move(tempPath, statusPath, { overwrite: true });
}

function isDeepResearchRun(value: unknown): value is DeepResearchRun {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const run = value as Record<string, unknown>;
  return typeof run.id === 'string'
    && typeof run.topic === 'string'
    && typeof run.reportPath === 'string'
    && (run.status === 'queued' || run.status === 'running' || run.status === 'incomplete' || run.status === 'completed')
    && typeof run.queuedAt === 'string'
    && typeof run.updatedAt === 'string'
    && Array.isArray(run.blockers)
    && run.blockers.every((blocker) => typeof blocker === 'string');
}

function formatRunStatus(status: DeepResearchRunStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatAge(ageMs: number): string {
  const duration = formatDuration(Math.max(0, ageMs));
  return ageMs < 1000 ? 'just now' : `${duration} ago`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
