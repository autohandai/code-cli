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
import type { LoadedConfig, PermissionMode, ProviderName, ProviderSettings, ReasoningEffort } from '../types.js';
import { createCommandTheme } from './commandTheme.js';
import { formatAccount } from './accountDisplay.js';

export const USAGE_V2_FLAG = 'usage_v2';

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
  description: 'Show model, provider, context, and usage limits',
  implemented: true,
};

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

export async function usage(ctx: SlashCommandContext): Promise<string> {
  if (!isUsageV2Enabled(ctx)) {
    return 'The /usage dashboard is behind usage_v2. Run /features enable usage_v2, then /usage again. No restart required.';
  }

  await ctx.trackFeatureActivation?.(USAGE_V2_FLAG, {
    provider: ctx.provider,
    model: ctx.model,
  });

  return formatUsageDashboard(gatherUsageDashboardData(ctx));
}
