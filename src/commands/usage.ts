/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getProviderConfig } from '../config.js';
import { getFeatureState } from '../features/featureRegistry.js';
import { getContextWindow as inferContextWindow } from '../core/context/tokenizer.js';
import type { SlashCommandContext } from '../core/slashCommandTypes.js';
import type { SessionMetadata } from '../session/types.js';
import type { LoadedConfig, PermissionMode, ProviderName, ProviderSettings, ReasoningEffort } from '../types.js';
import { createCommandTheme } from './commandTheme.js';
import { formatAccount } from './accountDisplay.js';

export const USAGE_V2_FLAG = 'usage_v2';
export const CLI_USAGE_V2_FLAG = 'cli_usage_v2';

type UsageActivityPeriod = 'daily' | 'weekly' | 'monthly';

interface UsageActivityBucket {
  key: string;
  date: Date;
  tokens: number;
  sessions: number;
}

interface UsageActivityData {
  period: UsageActivityPeriod;
  rangeLabel: string;
  lifetimeTokens: number;
  peakTokens: number;
  currentStreakDays: number;
  longestStreakDays: number;
  longestTaskMs: number;
  buckets: Map<string, UsageActivityBucket>;
  maxBucketTokens: number;
  generatedAt: Date;
}

export interface UsageLimitRow {
  label: string;
  percentLeft?: number;
  used?: number;
  limit?: number;
  resetLabel?: string;
  unavailableReason?: string;
}

export interface UsageDashboardData {
  model: string;
  provider: ProviderName | string;
  directory: string;
  permissions: string;
  agentsFile: string;
  account: string;
  sessionId: string;
  contextPercentLeft: number;
  contextWindow: number;
  contextTokensUsed: number;
  tokenUsageStatus: 'actual' | 'unavailable';
  reasoningEffort?: ReasoningEffort;
  usageLimits: UsageLimitRow[];
}

export const metadata = {
  command: '/usage',
  description: 'Show token activity by day, week, or month',
  implemented: true,
  subcommands: [
    { name: 'daily', description: 'Show daily token activity for the last 12 months' },
    { name: 'weekly', description: 'Show weekly token activity for the last 52 weeks' },
    { name: 'monthly', description: 'Show monthly token activity for the last 12 months' },
  ],
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatPath(value: string): string {
  const home = os.homedir();
  if (value === home) {
    return '~';
  }
  if (value.startsWith(`${home}${path.sep}`)) {
    return `~${value.slice(home.length)}`;
  }
  return value;
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return '0';
  }

  if (value >= 1_000_000_000) {
    const billions = value / 1_000_000_000;
    return `${Number.isInteger(billions) ? billions.toFixed(0) : billions.toFixed(1)}B`;
  }

  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(1)}M`;
  }

  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `${Number.isInteger(thousands) ? thousands.toFixed(0) : thousands.toFixed(1)}K`;
  }

  return String(Math.round(value));
}

function formatPermissionMode(mode?: PermissionMode): string {
  switch (mode ?? 'interactive') {
    case 'interactive':
      return 'Workspace (on-request)';
    case 'unrestricted':
      return 'Workspace (full access)';
    case 'restricted':
      return 'Read-only (restricted)';
    case 'external':
      return 'External approval';
  }
}

function resolveProviderSettings(config: LoadedConfig | undefined, provider: ProviderName | undefined): ProviderSettings | undefined {
  if (!config || !provider) {
    return undefined;
  }
  return getProviderConfig(config, provider) ?? undefined;
}

function resolveActiveProvider(ctx: SlashCommandContext): ProviderName {
  return ctx.config?.provider ?? ctx.provider ?? 'openrouter';
}

function resolveActiveModel(ctx: SlashCommandContext, provider: ProviderName): string {
  const settings = resolveProviderSettings(ctx.config, provider);
  return settings?.model ?? ctx.model;
}

function resolveReasoningEffort(config: LoadedConfig | undefined, provider: ProviderName | undefined): ReasoningEffort | undefined {
  return resolveProviderSettings(config, provider)?.reasoningEffort;
}

function resolveContextWindow(ctx: SlashCommandContext, provider: ProviderName, model: string): number {
  const settings = resolveProviderSettings(ctx.config, provider);
  return ctx.getContextWindow?.()
    ?? settings?.contextWindow
    ?? inferContextWindow(model, settings?.contextWindow);
}

function resolveContextTokensUsed(ctx: SlashCommandContext, contextWindow: number, percentLeft: number): number {
  const reported = ctx.getTotalTokensUsed?.();
  if (typeof reported === 'number' && Number.isFinite(reported) && reported > 0) {
    return Math.round(reported);
  }
  return Math.round(contextWindow * ((100 - percentLeft) / 100));
}

function resolveAgentsFile(workspaceRoot: string): string {
  return fs.existsSync(path.join(workspaceRoot, 'AGENTS.md')) ? 'AGENTS.md' : 'none';
}

function resolveAccount(config?: LoadedConfig): string {
  const account = formatAccount(config, '');
  if (account) {
    return account;
  }

  if (config?.openai?.authMode === 'chatgpt' && config.openai.chatgptAuth?.accountId) {
    return `ChatGPT account ${config.openai.chatgptAuth.accountId}`;
  }

  return 'not signed in';
}

function isUsageV2Enabled(ctx: SlashCommandContext): boolean {
  const localDefault = ctx.config
    ? getFeatureState(ctx.config, USAGE_V2_FLAG)?.enabled ?? false
    : false;
  return ctx.isFeatureEnabled?.(USAGE_V2_FLAG, localDefault) ?? localDefault;
}

function isCliUsageV2Enabled(ctx: SlashCommandContext): boolean {
  const localDefault = ctx.config
    ? getFeatureState(ctx.config, CLI_USAGE_V2_FLAG)?.enabled ?? true
    : true;
  return ctx.isFeatureEnabled?.(CLI_USAGE_V2_FLAG, localDefault) ?? localDefault;
}

function parseUsagePeriod(args: readonly string[] = []): UsageActivityPeriod {
  const value = args[0]?.toLowerCase();
  if (value === 'weekly' || value === 'week') return 'weekly';
  if (value === 'monthly' || value === 'month') return 'monthly';
  return 'daily';
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function isoDay(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

function weekStart(date: Date): Date {
  const day = startOfUtcDay(date);
  return addDays(day, -day.getUTCDay());
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function bucketKeyForDate(date: Date, period: UsageActivityPeriod): string {
  switch (period) {
    case 'weekly':
      return isoDay(weekStart(date));
    case 'monthly':
      return monthKey(date);
    case 'daily':
      return isoDay(date);
  }
}

function bucketDateForKey(key: string, period: UsageActivityPeriod): Date {
  if (period === 'monthly') {
    const [year, month] = key.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, 1));
  }
  return new Date(`${key}T00:00:00.000Z`);
}

function rangeLabelForPeriod(period: UsageActivityPeriod): string {
  switch (period) {
    case 'weekly':
      return 'last 52 weeks';
    case 'monthly':
      return 'last 12 months';
    case 'daily':
      return 'last 12 months';
  }
}

function sessionTokens(metadata: SessionMetadata, currentSessionId: string | undefined, liveTokens: number): number {
  const persisted = metadata.usage?.totalTokens;
  const usageTokens = typeof persisted === 'number' && Number.isFinite(persisted) && persisted > 0
    ? persisted
    : 0;
  const currentTokens = metadata.sessionId === currentSessionId && liveTokens > usageTokens ? liveTokens : 0;
  if (usageTokens > 0 || currentTokens > 0) {
    return Math.max(usageTokens, currentTokens);
  }

  return Math.max(0, metadata.messageCount) * 1_000;
}

function sessionDurationMs(metadata: SessionMetadata, now: Date): number {
  const start = Date.parse(metadata.createdAt);
  const end = Date.parse(metadata.closedAt ?? metadata.lastActiveAt) || now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return 0;
  }
  return end - start;
}

function calculateStreaks(days: Set<string>, today: Date): { current: number; longest: number } {
  let current = 0;
  let cursor = startOfUtcDay(today);
  while (days.has(isoDay(cursor))) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  let longest = 0;
  let run = 0;
  let previous: Date | null = null;
  for (const key of [...days].sort()) {
    const date = new Date(`${key}T00:00:00.000Z`);
    if (previous && isoDay(addDays(previous, 1)) === key) {
      run += 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    previous = date;
  }

  return { current, longest };
}

async function listProjectSessions(ctx: SlashCommandContext): Promise<SessionMetadata[]> {
  try {
    return await ctx.sessionManager.listSessions({ project: ctx.workspaceRoot });
  } catch {
    return [];
  }
}

export async function gatherUsageActivityData(
  ctx: SlashCommandContext,
  period: UsageActivityPeriod,
  generatedAt = new Date(),
): Promise<UsageActivityData> {
  const sessions = await listProjectSessions(ctx);
  const currentSessionId = ctx.sessionManager.getCurrentSession()?.metadata.sessionId;
  const liveTokens = ctx.getTotalTokensUsed?.() ?? 0;
  const buckets = new Map<string, UsageActivityBucket>();
  const activeDays = new Set<string>();
  let lifetimeTokens = 0;
  let longestTaskMs = 0;

  for (const session of sessions) {
    const createdAt = new Date(session.createdAt);
    if (!Number.isFinite(createdAt.getTime())) {
      continue;
    }

    const tokens = sessionTokens(session, currentSessionId, liveTokens);
    lifetimeTokens += tokens;
    activeDays.add(isoDay(createdAt));
    longestTaskMs = Math.max(longestTaskMs, sessionDurationMs(session, generatedAt));

    const key = bucketKeyForDate(createdAt, period);
    const existing = buckets.get(key) ?? {
      key,
      date: bucketDateForKey(key, period),
      tokens: 0,
      sessions: 0,
    };
    existing.tokens += tokens;
    existing.sessions += 1;
    buckets.set(key, existing);
  }

  const maxBucketTokens = Math.max(0, ...[...buckets.values()].map((bucket) => bucket.tokens));
  const streaks = calculateStreaks(activeDays, generatedAt);

  return {
    period,
    rangeLabel: rangeLabelForPeriod(period),
    lifetimeTokens,
    peakTokens: maxBucketTokens,
    currentStreakDays: streaks.current,
    longestStreakDays: streaks.longest,
    longestTaskMs,
    buckets,
    maxBucketTokens,
    generatedAt,
  };
}

export function gatherUsageDashboardData(ctx: SlashCommandContext): UsageDashboardData {
  const provider = resolveActiveProvider(ctx);
  const model = resolveActiveModel(ctx, provider);
  const contextPercentLeft = clampPercent(ctx.getContextPercentLeft?.() ?? 100);
  const contextWindow = resolveContextWindow(ctx, provider, model);
  const currentSession = ctx.sessionManager.getCurrentSession();
  const usageLimits = ctx.getUsageLimits?.() ?? [];

  return {
    model,
    provider,
    directory: formatPath(ctx.workspaceRoot),
    permissions: formatPermissionMode(ctx.config?.permissions?.mode),
    agentsFile: resolveAgentsFile(ctx.workspaceRoot),
    account: resolveAccount(ctx.config),
    sessionId: currentSession?.metadata.sessionId ?? 'none',
    contextPercentLeft,
    contextWindow,
    contextTokensUsed: resolveContextTokensUsed(ctx, contextWindow, contextPercentLeft),
    tokenUsageStatus: ctx.getTokenUsageStatus?.() ?? 'actual',
    reasoningEffort: resolveReasoningEffort(ctx.config, provider as ProviderName),
    usageLimits,
  };
}

function formatProgressBar(percentLeft: number, width = 24): string {
  const emptySlots = Math.round((percentLeft / 100) * width);
  const usedSlots = width - emptySlots;
  return `[${'█'.repeat(emptySlots)}${'░'.repeat(usedSlots)}]`;
}

function formatInfoRow(label: string, value: string, labelWidth: number): string {
  const theme = createCommandTheme();
  return `${theme.muted(label.padEnd(labelWidth))} ${value}`;
}

function formatModel(data: UsageDashboardData): string {
  if (!data.reasoningEffort) {
    return data.model;
  }
  return `${data.model} ${createCommandTheme().muted(`(reasoning ${data.reasoningEffort})`)}`;
}

function formatContextSummary(data: UsageDashboardData): string {
  const used = formatCompactNumber(data.contextTokensUsed);
  const window = formatCompactNumber(data.contextWindow);
  const suffix = data.tokenUsageStatus === 'unavailable' ? ' estimated' : '';
  return `${data.contextPercentLeft}% left ${createCommandTheme().muted(`(${used} used / ${window}${suffix})`)}`;
}

function formatUsageLimitRow(row: UsageLimitRow, labelWidth: number): string {
  if (row.unavailableReason) {
    return formatInfoRow(`${row.label}:`, row.unavailableReason, labelWidth);
  }

  const percent = clampPercent(row.percentLeft ?? 100);
  const reset = row.resetLabel ? createCommandTheme().muted(` (${row.resetLabel})`) : '';
  const usage = typeof row.used === 'number' && typeof row.limit === 'number'
    ? createCommandTheme().muted(` (${formatCompactNumber(row.used)} used / ${formatCompactNumber(row.limit)})`)
    : '';
  return formatInfoRow(`${row.label}:`, `${formatProgressBar(percent)} ${percent}% left${reset}${usage}`, labelWidth);
}

export function formatUsageDashboard(data: UsageDashboardData): string {
  const labelWidth = 24;
  const providerLimitRows = data.usageLimits.length > 0
    ? data.usageLimits
    : [{ label: String(data.provider), unavailableReason: 'not reported by provider' }];

  const lines = [
    formatInfoRow('Model:', formatModel(data), labelWidth),
    formatInfoRow('Provider:', String(data.provider), labelWidth),
    formatInfoRow('Directory:', data.directory, labelWidth),
    formatInfoRow('Permissions:', data.permissions, labelWidth),
    formatInfoRow('Agents.md:', data.agentsFile, labelWidth),
    formatInfoRow('Account:', data.account, labelWidth),
    formatInfoRow('Session:', data.sessionId, labelWidth),
    '',
    formatInfoRow('Context window:', formatContextSummary(data), labelWidth),
    formatInfoRow('', formatProgressBar(data.contextPercentLeft), labelWidth),
    '',
    formatInfoRow('Provider limits:', '', labelWidth).trimEnd(),
    ...providerLimitRows.map((row) => formatUsageLimitRow(row, labelWidth)),
  ];

  return lines.join('\n');
}

function intensityCell(tokens: number, maxTokens: number): string {
  if (tokens <= 0 || maxTokens <= 0) return '·';
  const ratio = tokens / maxTokens;
  if (ratio >= 0.8) return '█';
  if (ratio >= 0.55) return '▓';
  if (ratio >= 0.3) return '▒';
  return '░';
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m';
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatActivitySummary(data: UsageActivityData): string {
  const theme = createCommandTheme();
  return [
    `${theme.muted('Lifetime')} ${theme.warning(formatCompactNumber(data.lifetimeTokens))}`,
    `${theme.muted('Peak')} ${theme.warning(formatCompactNumber(data.peakTokens))}`,
    `${theme.muted('Streak')} ${theme.warning(`${data.currentStreakDays}d`)} ${theme.warning(`(best ${data.longestStreakDays}d)`)}`,
    `${theme.muted('Longest task')} ${theme.warning(formatDuration(data.longestTaskMs))}`,
  ].join(theme.muted(' · '));
}

function renderDailyHeatmap(data: UsageActivityData): string[] {
  const today = startOfUtcDay(data.generatedAt);
  const rangeStart = addDays(today, -364);
  const gridStart = addDays(rangeStart, -rangeStart.getUTCDay());
  const weekStarts: Date[] = [];
  for (let cursor = gridStart; cursor <= today; cursor = addDays(cursor, 7)) {
    weekStarts.push(cursor);
  }

  const monthHeader = `    ${weekStarts.map((week, index) => {
    const next = weekStarts[index - 1];
    if (index === 0 || week.getUTCMonth() !== next?.getUTCMonth()) {
      return MONTH_LABELS[week.getUTCMonth()].padEnd(3, ' ');
    }
    return '   ';
  }).join(' ')}`;

  const rows = WEEKDAY_LABELS.map((label, weekday) => {
    const cells = weekStarts.map((week) => {
      const date = addDays(week, weekday);
      if (date < rangeStart || date > today) return ' ';
      return intensityCell(data.buckets.get(isoDay(date))?.tokens ?? 0, data.maxBucketTokens);
    });
    return `${label}  ${cells.join(' ')}`;
  });

  return [monthHeader, ...rows];
}

function renderLinearHeatmap(data: UsageActivityData): string[] {
  const now = startOfUtcDay(data.generatedAt);
  const keys: string[] = [];

  if (data.period === 'weekly') {
    const end = weekStart(now);
    for (let i = 51; i >= 0; i -= 1) {
      keys.push(isoDay(addDays(end, -i * 7)));
    }
    return [
      '    ' + keys.map((key, index) => index % 4 === 0 ? MONTH_LABELS[bucketDateForKey(key, 'weekly').getUTCMonth()].padEnd(3, ' ') : '   ').join(' '),
      'Wk  ' + keys.map((key) => intensityCell(data.buckets.get(key)?.tokens ?? 0, data.maxBucketTokens)).join(' '),
    ];
  }

  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = 11; i >= 0; i -= 1) {
    keys.push(monthKey(addMonths(end, -i)));
  }
  return [
    '    ' + keys.map((key) => MONTH_LABELS[bucketDateForKey(key, 'monthly').getUTCMonth()].padEnd(3, ' ')).join(' '),
    'Mo  ' + keys.map((key) => intensityCell(data.buckets.get(key)?.tokens ?? 0, data.maxBucketTokens)).join(' '),
  ];
}

function formatPeriodTabs(period: UsageActivityPeriod): string {
  const theme = createCommandTheme();
  return (['daily', 'weekly', 'monthly'] as const)
    .map((candidate) => candidate === period ? theme.warning(candidate) : theme.muted(candidate))
    .join(theme.muted(' · '));
}

function formatUsageActivityDashboard(data: UsageActivityData): string {
  const theme = createCommandTheme();
  const heatmap = data.period === 'daily' ? renderDailyHeatmap(data) : renderLinearHeatmap(data);
  return [
    theme.accent(`/usage ${data.period}`),
    '',
    `${theme.bold('Token activity')}   ${theme.muted(data.rangeLabel)}`,
    formatActivitySummary(data),
    '',
    ...heatmap,
    '',
    `${theme.muted('Less')} · ░ ▒ ▓ █ ${theme.muted('More')}`,
    formatPeriodTabs(data.period),
  ].join('\n');
}

export async function usage(ctx: SlashCommandContext, args: string[] = []): Promise<string> {
  if (isCliUsageV2Enabled(ctx)) {
    const period = parseUsagePeriod(args);
    await ctx.trackFeatureActivation?.(CLI_USAGE_V2_FLAG, {
      provider: ctx.provider,
      model: ctx.model,
      period,
    });
    return formatUsageActivityDashboard(await gatherUsageActivityData(ctx, period));
  }

  if (!isUsageV2Enabled(ctx)) {
    return 'The /usage activity dashboard is behind cli_usage_v2. Run /experiments enable cli_usage_v2, then /usage again. No restart required.';
  }

  await ctx.trackFeatureActivation?.(USAGE_V2_FLAG, {
    provider: ctx.provider,
    model: ctx.model,
  });

  return formatUsageDashboard(gatherUsageDashboardData(ctx));
}
