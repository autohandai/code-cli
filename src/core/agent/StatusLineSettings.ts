/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LoadedConfig, StatusLineSettings as ConfigStatusLineSettings } from '../../types.js';
import type { AgentUILineExtensions } from '../../ui/ink/AgentUI.js';
import type { SessionDiffStats } from '../SessionDiffStatsTracker.js';

export const DEFAULT_PULL_REQUEST_NUMBER = 123;

export const STATUS_LINE_SETTING_KEYS = [
  'showContext',
  'showCommandHint',
  'showPullRequest',
  'showSessionLines',
] as const;

export type StatusLineSettingKey = typeof STATUS_LINE_SETTING_KEYS[number];

export const DEFAULT_STATUS_LINE_SETTINGS: Required<ConfigStatusLineSettings> = {
  showContext: true,
  showCommandHint: true,
  showPullRequest: true,
  showSessionLines: false,
};

export function resolveStatusLineSettings(
  settings: ConfigStatusLineSettings | undefined
): Required<ConfigStatusLineSettings> {
  return {
    ...DEFAULT_STATUS_LINE_SETTINGS,
    ...settings,
  };
}

export function isStatusLineSettingKey(value: string): value is StatusLineSettingKey {
  return STATUS_LINE_SETTING_KEYS.includes(value as StatusLineSettingKey);
}

export function getConfigStatusLineSettings(config: LoadedConfig | undefined): Required<ConfigStatusLineSettings> {
  return resolveStatusLineSettings(config?.ui?.statusLine);
}

export function formatPullRequestSegment(pullRequestNumber?: number | string | null): string {
  const normalized = typeof pullRequestNumber === 'string'
    ? pullRequestNumber.trim().replace(/^#/, '')
    : pullRequestNumber;
  const value = normalized || DEFAULT_PULL_REQUEST_NUMBER;
  return `PR #${value}`;
}

export function formatSessionDiffStats(stats: SessionDiffStats | undefined): string[] {
  if (!stats) {
    return [];
  }

  return [
    stats.added > 0 ? `+${stats.added} lines` : '',
    stats.removed > 0 ? `-${stats.removed} lines` : '',
  ].filter(Boolean);
}

export interface FormatStatusLineLeftInput {
  contextPercentLeft: number;
  commandHint: string;
  queueCount: number;
  settings: Required<ConfigStatusLineSettings>;
  planIndicator?: string;
  pullRequestNumber?: number | string | null;
  sessionDiffStats?: SessionDiffStats;
}

export function formatStatusLineLeft(input: FormatStatusLineLeftInput): string {
  const percent = Number.isFinite(input.contextPercentLeft)
    ? Math.max(0, Math.min(100, input.contextPercentLeft))
    : 100;

  const queueStatus = input.queueCount > 0 ? ` ${String.fromCharCode(0xb7)} ${input.queueCount} queued` : '';
  const segments = [
    input.settings.showContext ? `${input.planIndicator ?? ''}${percent}% context left` : (input.planIndicator ?? '').trim(),
    input.settings.showCommandHint ? input.commandHint : '',
    input.settings.showPullRequest ? formatPullRequestSegment(input.pullRequestNumber) : '',
    input.settings.showSessionLines ? formatSessionDiffStats(input.sessionDiffStats).join(` ${String.fromCharCode(0xb7)} `) : '',
  ].filter((segment) => segment.trim().length > 0);

  return `${segments.join(` ${String.fromCharCode(0xb7)} `)}${queueStatus}`;
}

export interface StatusLineExtensionInput {
  settings: Required<ConfigStatusLineSettings>;
  pullRequestNumber?: number | string | null;
  sessionDiffStats?: SessionDiffStats;
}

export function buildStatusLineExtension(input: StatusLineExtensionInput): AgentUILineExtensions | undefined {
  const statusSegments = [
    input.settings.showPullRequest
      ? { id: 'pull-request', text: formatPullRequestSegment(input.pullRequestNumber), color: 'muted' as const }
      : null,
    ...(input.settings.showSessionLines
      ? [
          {
            id: 'session-lines-added',
            text: input.sessionDiffStats && input.sessionDiffStats.added > 0 ? `+${input.sessionDiffStats.added} lines` : '',
            color: 'success' as const,
          },
          {
            id: 'session-lines-removed',
            text: input.sessionDiffStats && input.sessionDiffStats.removed > 0 ? `-${input.sessionDiffStats.removed} lines` : '',
            color: 'error' as const,
          },
        ]
      : []),
  ].filter((segment): segment is NonNullable<typeof segment> => segment !== null);

  if (statusSegments.length === 0) {
    return undefined;
  }

  return {
    status: {
      segments: statusSegments,
    },
  };
}
