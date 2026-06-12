/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LoadedConfig, StatusLineSettings as ConfigStatusLineSettings } from '../../types.js';
import type { AgentUILineExtensions } from '../../ui/ink/AgentUI.js';
import type { SessionDiffStats } from '../SessionDiffStatsTracker.js';

export const DEFAULT_PULL_REQUEST_NUMBER = 123;
const DEFAULT_WORKSPACE_PATH_LIMIT = 44;
const DEFAULT_GIT_LABEL_LIMIT = 24;

export const STATUS_LINE_SETTING_KEYS = [
  'showProviderModel',
  'showContext',
  'showWorkspacePath',
  'showGitBranch',
  'showCommandHint',
  'showPullRequest',
  'showSessionLines',
  'showQueue',
  'showActiveStatus',
  'showActiveMetrics',
  'showCancelHint',
] as const;

export type StatusLineSettingKey = typeof STATUS_LINE_SETTING_KEYS[number];

export const DEFAULT_STATUS_LINE_SETTINGS: Required<ConfigStatusLineSettings> = {
  showProviderModel: true,
  showContext: true,
  showWorkspacePath: true,
  showGitBranch: true,
  showCommandHint: true,
  showPullRequest: true,
  showSessionLines: false,
  showQueue: true,
  showActiveStatus: true,
  showActiveMetrics: true,
  showCancelHint: true,
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

function truncateMiddle(value: string, limit: number): string {
  if (limit <= 0) {
    return '';
  }
  if (value.length <= limit) {
    return value;
  }
  if (limit === 1) {
    return '…';
  }

  const left = Math.ceil((limit - 1) / 2);
  const right = Math.floor((limit - 1) / 2);
  return `${value.slice(0, left)}…${value.slice(value.length - right)}`;
}

export function formatWorkspacePathSegment(
  workspaceRoot: string | undefined,
  options: { homeDir?: string; limit?: number } = {}
): string {
  const trimmed = workspaceRoot?.trim();
  if (!trimmed) {
    return '';
  }

  const homeDir = options.homeDir?.replace(/\/+$/, '');
  const normalized = homeDir && (trimmed === homeDir || trimmed.startsWith(`${homeDir}/`))
    ? `~${trimmed.slice(homeDir.length)}`
    : trimmed;
  return truncateMiddle(normalized, options.limit ?? DEFAULT_WORKSPACE_PATH_LIMIT);
}

export function formatGitLabelSegment(
  gitLabel: string | undefined,
  options: { limit?: number } = {}
): string {
  const trimmed = gitLabel?.trim();
  if (!trimmed) {
    return '';
  }
  return truncateMiddle(trimmed, options.limit ?? DEFAULT_GIT_LABEL_LIMIT);
}

export interface FormatStatusLineLeftInput {
  contextPercentLeft: number;
  contextStatus?: string;
  commandHint: string;
  queueCount: number;
  settings: Required<ConfigStatusLineSettings>;
  planIndicator?: string;
  workspaceRoot?: string;
  homeDir?: string;
  gitLabel?: string;
  pullRequestNumber?: number | string | null;
  sessionDiffStats?: SessionDiffStats;
  sessionHasFileChanges?: boolean;
}

export function formatStatusLineLeft(input: FormatStatusLineLeftInput): string {
  const percent = Number.isFinite(input.contextPercentLeft)
    ? Math.max(0, Math.min(100, input.contextPercentLeft))
    : 100;
  const contextSegment = input.contextStatus?.trim()
    ? `${input.planIndicator ?? ''}${input.contextStatus.trim()}`
    : `${input.planIndicator ?? ''}${percent}% context left`;
  const sessionDiffSegment = input.settings.showSessionLines && input.sessionHasFileChanges
    ? formatSessionDiffStats(input.sessionDiffStats).join(` ${String.fromCharCode(0xb7)} `)
    : '';
  const workspaceSegment = input.settings.showWorkspacePath
    ? formatWorkspacePathSegment(input.workspaceRoot, { homeDir: input.homeDir })
    : '';
  const gitSegment = input.settings.showGitBranch
    ? formatGitLabelSegment(input.gitLabel)
    : '';

  const queueStatus = input.settings.showQueue && input.queueCount > 0
    ? ` ${String.fromCharCode(0xb7)} ${input.queueCount} queued`
    : '';
  const segments = [
    input.settings.showContext ? contextSegment : (input.planIndicator ?? '').trim(),
    workspaceSegment,
    gitSegment,
    input.settings.showCommandHint ? input.commandHint : '',
    input.settings.showPullRequest ? formatPullRequestSegment(input.pullRequestNumber) : '',
    sessionDiffSegment,
  ].filter((segment) => segment.trim().length > 0);

  return `${segments.join(` ${String.fromCharCode(0xb7)} `)}${queueStatus}`;
}

export interface StatusLineExtensionInput {
  settings: Required<ConfigStatusLineSettings>;
  workspaceRoot?: string;
  homeDir?: string;
  gitLabel?: string;
  pullRequestNumber?: number | string | null;
  sessionDiffStats?: SessionDiffStats;
  sessionHasFileChanges?: boolean;
}

export function buildStatusLineExtension(input: StatusLineExtensionInput): AgentUILineExtensions | undefined {
  const hiddenDefaultSegmentIds = [
    input.settings.showProviderModel ? '' : 'provider',
    input.settings.showContext ? '' : 'context',
    input.settings.showCommandHint ? '' : 'command-hint',
  ].filter(Boolean);
  const hiddenStatusSegmentIds = [
    input.settings.showActiveStatus ? '' : 'status',
    input.settings.showActiveMetrics ? '' : 'metrics',
    input.settings.showQueue ? '' : 'queue',
    input.settings.showCancelHint ? '' : 'cancel',
  ].filter(Boolean);
  const helpSegments = [
    input.settings.showWorkspacePath
      ? {
          id: 'workspace-path',
          text: formatWorkspacePathSegment(input.workspaceRoot, { homeDir: input.homeDir }),
          color: 'success' as const,
        }
      : null,
    input.settings.showGitBranch
      ? {
          id: 'git-branch',
          text: formatGitLabelSegment(input.gitLabel),
          color: 'muted' as const,
        }
      : null,
    input.settings.showPullRequest
      ? { id: 'pull-request', text: formatPullRequestSegment(input.pullRequestNumber), color: 'muted' as const }
      : null,
    ...(input.settings.showSessionLines && input.sessionHasFileChanges
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
  ].filter((segment): segment is NonNullable<typeof segment> =>
    segment !== null && segment.text.trim().length > 0
  );

  if (helpSegments.length === 0 && hiddenDefaultSegmentIds.length === 0) {
    if (hiddenStatusSegmentIds.length === 0) {
      return undefined;
    }
    return {
      status: {
        hiddenDefaultSegmentIds: hiddenStatusSegmentIds,
      },
    };
  }

  if (hiddenStatusSegmentIds.length === 0) {
    return {
      help: {
        hiddenDefaultSegmentIds,
        segments: helpSegments,
      },
    };
  }

  return {
    status: {
      hiddenDefaultSegmentIds: hiddenStatusSegmentIds,
    },
    help: {
      hiddenDefaultSegmentIds,
      segments: helpSegments,
    },
  };
}
