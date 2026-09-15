/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import type {
  LoadedConfig,
  StatusSectionConfig,
} from '../../types.js';
import type { AgentUILineExtensions } from '../../ui/ink/AgentUI.js';
import type { LineExtension, LineSegment } from '../../ui/ink/StatusLine.js';
import { resolveStatusBarConfig } from './StatusBarConfig.js';
import { resolveStatusLineGitLabel, type StatusLineGitLabelHost } from './AgentContextRuntime.js';
import { emojiForProject } from '../../ui/statusbar/sessionEmoji.js';
import {
  formatGitLabelSegment,
  formatPullRequestSegment,
  formatSessionDiffStats,
} from './StatusLineSettings.js';
import type { SessionDiffStats } from '../SessionDiffStatsTracker.js';

// ── Types ─────────────────────────────────────────────────────────────────

export interface StatusBarRenderData {
  workspaceRoot?: string;
  homeDir?: string;
  gitLabel?: string;
  gitAhead?: number;
  gitBehind?: number;
  dirtyCount?: number;
  worktreeName?: string;
  pullRequestNumber?: number | string | null;
  model?: string;
  providerLabel?: string;
  planLabel?: string;
  interactionMode?: string;
  contextPercentLeft?: number;
  contextTokens?: { used: number; total: number };
  sessionTokensUsed?: number;
  sessionTokenUsageUnavailable?: boolean;
  sessionDiffStats?: SessionDiffStats;
  sessionHasFileChanges?: boolean;
  agentCount?: number;
  mcpConnected?: number;
  mcpTotal?: number;
  mcpFailed?: number;
  taskPending?: number;
  taskTotal?: number;
  researchIter?: number;
  researchMax?: number;
  researchBest?: string;
  sessionCost?: string;
  clock?: string;
  commandHint?: string;
  peerCount?: number;
}

export interface StatusBarRenderHost extends StatusLineGitLabelHost {
  runtime?: { workspaceRoot?: string; config?: LoadedConfig };
  getInteractionMode?: () => string;
}

// ── Section text builders ─────────────────────────────────────────────────

function buildProjectSegment(data: StatusBarRenderData): string {
  const root = data.workspaceRoot;
  if (!root) return '';
  const emoji = emojiForProject(root);
  const name = path.basename(root);
  return `${emoji} ${name}`;
}

function buildGitSegment(data: StatusBarRenderData): string {
  const label = formatGitLabelSegment(data.gitLabel);
  return label ? '⎇ ' + label : '';
}

function buildGitAheadSegment(data: StatusBarRenderData): string {
  const n = data.gitAhead ?? 0;
  return n > 0 ? `↑${n}` : '';
}

function buildGitBehindSegment(data: StatusBarRenderData): string {
  const n = data.gitBehind ?? 0;
  return n > 0 ? `↓${n}` : '';
}

function buildDirtySegment(data: StatusBarRenderData): string {
  const n = data.dirtyCount ?? 0;
  return n > 0 ? `✗${n}` : '';
}

function buildWorktreeSegment(data: StatusBarRenderData): string {
  return data.worktreeName ?? '';
}

function buildPrSegment(data: StatusBarRenderData): string {
  if (!data.pullRequestNumber) return '';
  return formatPullRequestSegment(data.pullRequestNumber);
}

function buildModelSegment(data: StatusBarRenderData): string {
  const model = data.model;
  if (!model || model === 'unconfigured') return '';
  return model;
}

function emojiForProvider(provider: string | undefined): string {
  if (!provider) return '⚡';
  const p = provider.toLowerCase();
  if (p.includes('openai')) return '🤖';
  if (p.includes('anthropic') || p.includes('claude')) return '🧠';
  if (p.includes('google') || p.includes('gemini')) return '🔍';
  if (p.includes('openrouter')) return '🌐';
  if (p.includes('ollama') || p.includes('local')) return '🏠';
  if (p.includes('autohand')) return '⚡';
  return '⚡';
}

function buildProviderSegment(data: StatusBarRenderData): string {
  const label = data.providerLabel ?? data.planLabel ?? '';
  return label ? emojiForProvider(label) + ' ' + label : '';
}

function buildModeSegment(data: StatusBarRenderData): string {
  const mode = data.interactionMode;
  if (!mode || mode === 'default') return '';
  const label = mode === 'automode' ? 'AUTO' : mode.toUpperCase();
  return `* ${label}`;
}

function buildContextSegment(data: StatusBarRenderData): string {
  const pct = data.contextPercentLeft;
  if (pct === undefined) return '';
  const used = 100 - Math.max(0, Math.min(100, pct));
  const width = 10;
  const filled = used > 0 ? Math.max(1, Math.round((used / 100) * width)) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function buildTokensSegment(data: StatusBarRenderData): string {
  if (data.sessionTokenUsageUnavailable) return '';
  const tokens = data.sessionTokensUsed ?? 0;
  if (tokens <= 0) return '';
  return '◉ ' + formatCompactTokens(tokens);
}

function buildCostSegment(data: StatusBarRenderData): string {
  return data.sessionCost ?? '';
}

function buildClockSegment(data: StatusBarRenderData): string {
  return data.clock ?? '';
}

function buildAgentsSegment(data: StatusBarRenderData): string {
  const n = data.agentCount ?? 0;
  if (n <= 0) return '';
  return `☻ ${n} ${n === 1 ? 'agent' : 'agents'}`;
}

function buildMcpSegment(data: StatusBarRenderData): string {
  const total = data.mcpTotal ?? 0;
  if (total <= 0) return '';
  const connected = data.mcpConnected ?? 0;
  const failed = data.mcpFailed ?? 0;
  if (failed > 0) {
    return `🔌 ${connected}/${total} ⚠ ${failed} failed`;
  }
  return `🔌 ${connected}/${total}`;
}

function buildDiffSegment(data: StatusBarRenderData): string {
  if (!data.sessionHasFileChanges) return '';
  const stats = data.sessionDiffStats;
  if (!stats) return '';
  const parts = formatSessionDiffStats(stats);
  return parts.join(' · ');
}

function buildResearchSegment(data: StatusBarRenderData): string {
  const iter = data.researchIter;
  if (iter === undefined) return '';
  const max = data.researchMax ?? 0;
  const best = data.researchBest ?? '';
  return `🧪 iter ${iter}/${max} · best ${best}`;
}

function buildTasksSegment(data: StatusBarRenderData): string {
  const total = data.taskTotal ?? 0;
  if (total <= 0) return '';
  const pending = data.taskPending ?? 0;
  if (pending === 0) {
    return `☑ ${total}/${total}`;
  }
  return `☐ ${pending}/${total}`;
}

function buildHintsSegment(data: StatusBarRenderData): string {
  return data.commandHint ?? '';
}

// ── Section → segment mapping ─────────────────────────────────────────────

const SECTION_BUILDERS: Record<string, (data: StatusBarRenderData) => string> = {
  project: buildProjectSegment,
  git: buildGitSegment,
  gitAhead: buildGitAheadSegment,
  gitBehind: buildGitBehindSegment,
  dirty: buildDirtySegment,
  worktree: buildWorktreeSegment,
  pr: buildPrSegment,
  model: buildModelSegment,
  provider: buildProviderSegment,
  mode: buildModeSegment,
  context: buildContextSegment,
  tokens: buildTokensSegment,
  cost: buildCostSegment,
  clock: buildClockSegment,
  agents: buildAgentsSegment,
  mcp: buildMcpSegment,
  diff: buildDiffSegment,
  research: buildResearchSegment,
  tasks: buildTasksSegment,
  hints: buildHintsSegment,
};

// ── Color mapping ─────────────────────────────────────────────────────────

const SECTION_COLORS: Record<string, LineSegment['color'] | undefined> = {
  project: 'accent',
  git: 'success',
  gitAhead: 'success',
  gitBehind: 'warning',
  dirty: 'error',
  worktree: 'success',
  pr: 'muted',
  model: 'text',
  provider: 'muted',
  mode: undefined,
  context: undefined,
  tokens: 'text',
  cost: 'warning',
  clock: 'muted',
  agents: 'accent',
  mcp: 'accent',
  diff: 'text',
  research: 'accent',
  tasks: 'accent',
  hints: 'muted',
};

// ── Token formatting ──────────────────────────────────────────────────────

function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

// ── Main render function ──────────────────────────────────────────────────

/**
 * Build `AgentUILineExtensions` from the resolved status bar config and
 * runtime data. When `layout` is `"classic"`, all enabled sections render on
 * a single help line. When `"two-line"`, line-1 sections render on the help
 * line and line-2 sections render on the status line.
 *
 * Sections with no data (empty text) are hidden — this is stage 1 of the
 * overflow pipeline (context-aware hiding).
 */
export function buildStatusBarExtensions(
  config: LoadedConfig | undefined,
  data: StatusBarRenderData,
): AgentUILineExtensions | undefined {
  const { layout, sections } = resolveStatusBarConfig(config);

  const enabledSections = sections.filter((s) => s.enabled !== false);

  const line1Sections = enabledSections.filter((s) => s.line === 1);
  const line2Sections = enabledSections.filter((s) => s.line === 2);

  const line1Segments = sectionsToSegments(line1Sections, data);
  const line2Segments = sectionsToSegments(line2Sections, data);

  const helpExtension = segmentsToExtension(line1Segments);
  const statusExtension = segmentsToExtension(line2Segments);

  if (layout === 'two-line') {
    return {
      help: helpExtension,
      status: statusExtension,
    };
  }

  // Classic: all enabled sections render on a single help line,
  // regardless of their line assignment. Line 2 sections are appended
  // after line 1 sections in declaration order.
  const allSegments = [...line1Segments, ...line2Segments];
  const allExtension = segmentsToExtension(allSegments);
  return allExtension
    ? { help: allExtension }
    : undefined;
}

/** Sections that should reserve visual space even when temporarily empty. */
const RESERVE_SPACE_SECTIONS = new Set(['model']);

function sectionsToSegments(
  sections: StatusSectionConfig[],
  data: StatusBarRenderData,
): LineSegment[] {
  const segments: LineSegment[] = [];
  for (const section of sections) {
    const builder = SECTION_BUILDERS[section.id];
    if (!builder) continue;
    const text = builder(data);
    const color = SECTION_COLORS[section.id];
    const reserveSpace = RESERVE_SPACE_SECTIONS.has(section.id);

    if (!text || !text.trim()) {
      // Stage 1: context-aware hiding — but reserve space for stable segments
      if (reserveSpace) {
        segments.push({
          id: section.id,
          text: '',
          ...(color ? { color } : {}),
          reserveSpace: true,
        });
      }
      continue;
    }

    segments.push({
      id: section.id,
      text,
      ...(color ? { color } : {}),
    });
  }
  return segments;
}

function segmentsToExtension(segments: LineSegment[]): LineExtension | undefined {
  if (segments.length === 0) return undefined;
  return { segments, replaceDefault: true };
}

// ── Host-based convenience ────────────────────────────────────────────────

/**
 * Build status bar extensions from a host object, extracting available data
 * from the runtime and config. This is the bridge between the agent runtime
 * and the section-based renderer.
 */
export function buildStatusBarExtensionsFromHost(
  host: StatusBarRenderHost,
  extraData?: Partial<StatusBarRenderData>,
): AgentUILineExtensions | undefined {
  const config = host.runtime?.config;
  const workspaceRoot = host.runtime?.workspaceRoot;

  const data: StatusBarRenderData = {
    workspaceRoot,
    gitLabel: resolveStatusLineGitLabel(host),
    interactionMode: host.getInteractionMode?.(),
    ...extraData,
  };

  return buildStatusBarExtensions(config, data);
}
