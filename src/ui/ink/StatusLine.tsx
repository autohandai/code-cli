/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { memo, type ReactNode } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useTheme } from '../theme/ThemeContext.js';
import { useTranslation } from '../i18n/index.js';
import type { Theme } from '../theme/Theme.js';

export type LineSegmentColor =
  | 'text'
  | 'muted'
  | 'accent'
  | 'success'
  | 'warning'
  | 'error'
  | 'dim';

export interface LineSegment {
  id: string;
  text: string;
  color?: LineSegmentColor;
  visible?: boolean;
}

export interface LineExtension {
  segments?: LineSegment[];
  replaceDefault?: boolean;
  hiddenDefaultSegmentIds?: string[];
  separator?: string;
}

export interface StatusLineProps {
  isWorking: boolean;
  status: string;
  elapsed?: string;
  tokens?: string;
  queueCount?: number;
  /** Context percentage remaining (0-100) */
  contextPercent?: number;
  /** Total tokens used (for display like "45K/128K") */
  contextTokens?: { used: number; total: number };
  /** Current LLM provider key (e.g. 'openai', 'openrouter') */
  provider?: string;
  /** Current LLM model name */
  model?: string;
  /** Optional extension points for status-line text segments. */
  lineExtension?: LineExtension;
}

function normalizeSegmentText(segment: LineSegment): string {
  return typeof segment.text === 'string' ? segment.text : String(segment.text ?? '');
}

export function resolveLineSegments(
  defaults: LineSegment[],
  extension?: LineExtension
): { segments: LineSegment[]; separator: string } {
  const extensionSegments = extension?.segments ?? [];
  const hiddenDefaultSegmentIds = new Set(extension?.hiddenDefaultSegmentIds ?? []);
  const visibleDefaults = defaults.filter((segment) => !hiddenDefaultSegmentIds.has(segment.id));
  const segments = extension?.replaceDefault
    ? extensionSegments
    : [...visibleDefaults, ...extensionSegments];

  return {
    segments: segments.filter((segment) =>
      segment.visible !== false && normalizeSegmentText(segment).trim().length > 0
    ),
    separator: extension?.separator ?? ' · ',
  };
}

export function formatLineSegments(
  defaults: LineSegment[],
  extension?: LineExtension
): string {
  const { segments, separator } = resolveLineSegments(defaults, extension);
  return segments.map((segment) => normalizeSegmentText(segment)).join(separator);
}

export function mergeLineExtensions(
  ...extensions: Array<LineExtension | undefined>
): LineExtension | undefined {
  const active = extensions.filter((extension): extension is LineExtension => extension !== undefined);
  if (active.length === 0) {
    return undefined;
  }
  const separator = [...active].reverse().find((extension) => extension.separator !== undefined)?.separator;

  return {
    replaceDefault: active.some((extension) => extension.replaceDefault),
    hiddenDefaultSegmentIds: Array.from(new Set(active.flatMap((extension) => extension.hiddenDefaultSegmentIds ?? []))),
    segments: active.flatMap((extension) => extension.segments ?? []),
    separator,
  };
}

function getSegmentToken(color?: LineSegmentColor): Parameters<Theme['fg']>[0] {
  switch (color) {
    case 'accent':
      return 'accent';
    case 'success':
      return 'success';
    case 'warning':
      return 'warning';
    case 'error':
      return 'error';
    case 'dim':
      return 'dim';
    case 'muted':
      return 'muted';
    case 'text':
    default:
      return 'text';
  }
}

function renderLineSegments(
  segments: LineSegment[],
  separator: string,
  theme: Theme
): ReactNode[] {
  return segments.flatMap((segment, index) => {
    const nodes: ReactNode[] = [];
    if (index > 0) {
      nodes.push(<Text key={`${segment.id}:sep`}>{theme.fg('muted', separator)}</Text>);
    }
    nodes.push(
      <Text key={segment.id}>{theme.fg(getSegmentToken(segment.color), normalizeSegmentText(segment))}</Text>
    );
    return nodes;
  });
}

function buildStatusSegments(
  status: string,
  elapsed: string | undefined,
  tokens: string | undefined,
  queueCount: number,
  cancelHint: string
): LineSegment[] {
  const metrics = [elapsed, tokens].filter((part): part is string => Boolean(part));
  return [
    { id: 'status', text: status },
    {
      id: 'metrics',
      text: metrics.length > 0 ? `(${metrics.join(' · ')})` : '',
      color: 'muted',
    },
    {
      id: 'queue',
      text: queueCount > 0 ? `[${queueCount} queued]` : '',
      color: 'accent',
    },
    { id: 'cancel', text: cancelHint, color: 'muted' },
  ];
}

function StatusLineComponent({
  isWorking,
  status,
  elapsed,
  tokens,
  queueCount = 0,
  lineExtension,
}: StatusLineProps) {
  const { colors, theme } = useTheme();
  const { t } = useTranslation();
  const defaultSegments = isWorking
    ? buildStatusSegments(status, elapsed, tokens, queueCount, t('ui.escToCancel'))
    : [];
  const { segments, separator } = resolveLineSegments(defaultSegments, lineExtension);

  // Always render to maintain stable layout - show placeholder when not working
  // and no custom status segments were supplied.
  if (!isWorking && segments.length === 0) {
    return (
      <Box height={1}>
        <Text color={colors.dim}> </Text>
      </Box>
    );
  }

  return (
    <Box>
      {isWorking && (
        <>
          <Text color={colors.accent}>
            <Spinner type="dots" />
          </Text>
          <Text> </Text>
        </>
      )}
      {renderLineSegments(segments, separator, theme)}
    </Box>
  );
}

/**
 * Memoized StatusLine - prevents unnecessary re-renders
 * Note: We don't memoize too strictly since spinner animation needs updates
 */
export const StatusLine = memo(StatusLineComponent, (prev, next) => {
  // Don't skip re-render when working (spinner needs animation updates)
  if (prev.isWorking || next.isWorking) {
    // Only skip if all values are identical
    return prev.isWorking === next.isWorking &&
           prev.status === next.status &&
           prev.elapsed === next.elapsed &&
           prev.tokens === next.tokens &&
           prev.queueCount === next.queueCount &&
           prev.contextPercent === next.contextPercent &&
           prev.contextTokens?.used === next.contextTokens?.used &&
           prev.contextTokens?.total === next.contextTokens?.total &&
           prev.provider === next.provider &&
           prev.model === next.model &&
           prev.lineExtension === next.lineExtension;
  }
  // When both are not working, can safely skip
  return prev.lineExtension === next.lineExtension;
});
