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

export function resolveLineSegments(
  defaults: LineSegment[],
  extension?: LineExtension
): { segments: LineSegment[]; separator: string } {
  const extensionSegments = extension?.segments ?? [];
  const segments = extension?.replaceDefault
    ? extensionSegments
    : [...defaults, ...extensionSegments];

  return {
    segments: segments.filter((segment) =>
      segment.visible !== false && segment.text.trim().length > 0
    ),
    separator: extension?.separator ?? ' · ',
  };
}

export function formatLineSegments(
  defaults: LineSegment[],
  extension?: LineExtension
): string {
  const { segments, separator } = resolveLineSegments(defaults, extension);
  return segments.map((segment) => segment.text).join(separator);
}

function getSegmentColor(colors: ReturnType<typeof useTheme>['colors'], color?: LineSegmentColor): string | undefined {
  switch (color) {
    case 'accent':
      return colors.accent;
    case 'success':
      return colors.success;
    case 'warning':
      return colors.warning;
    case 'error':
      return colors.error;
    case 'dim':
      return colors.dim;
    case 'muted':
      return colors.muted;
    case 'text':
    default:
      return undefined;
  }
}

function renderLineSegments(
  segments: LineSegment[],
  separator: string,
  colors: ReturnType<typeof useTheme>['colors']
): ReactNode[] {
  return segments.flatMap((segment, index) => {
    const nodes: ReactNode[] = [];
    if (index > 0) {
      nodes.push(<Text key={`${segment.id}:sep`} color={colors.muted}>{separator}</Text>);
    }
    nodes.push(
      <Text key={segment.id} color={getSegmentColor(colors, segment.color)}>
        {segment.text}
      </Text>
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
  const { colors } = useTheme();
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
      {renderLineSegments(segments, separator, colors)}
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
