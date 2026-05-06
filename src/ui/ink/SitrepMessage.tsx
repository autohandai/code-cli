/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * SitrepMessage - Renders task completion status reports with distinctive styling
 */
import React, { memo, useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import type { ColorToken } from '../theme/types.js';

export interface SitrepMessageProps {
  /** The summary of what was done */
  done: string;
  /** List of files that were modified/created */
  files?: string[];
  /** Current status */
  status: 'completed' | 'in-progress' | 'blocked';
  /** What happens next */
  next?: string;
  /** Optional verification commands */
  verify?: string;
}

/**
 * Status color mapping
 */
const STATUS_COLORS = {
  completed: 'success',
  'in-progress': 'warning',
  blocked: 'error',
} as const satisfies Record<SitrepMessageProps['status'], ColorToken>;

const STATUS_ICONS = {
  completed: '✓',
  'in-progress': '◐',
  blocked: '✗',
} as const;

/**
 * SitrepMessage displays a task completion status report.
 * Uses distinctive styling to stand out from regular assistant messages.
 *
 * Features:
 * - Colored status indicator
 * - Structured layout with icons
 * - File list with bullet points
 * - Verification commands section
 */
function SitrepMessageComponent({ done, files, status, next, verify }: SitrepMessageProps) {
  const { colors, theme } = useTheme();
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? 80;

  const statusToken = STATUS_COLORS[status];
  const statusColor = colors[statusToken];
  const statusIcon = STATUS_ICONS[status];

  // Truncate long file paths if needed
  const maxFileWidth = Math.max(20, terminalWidth - 6);
  const displayFiles = useMemo(() => {
    if (!files || files.length === 0) return [];
    return files.map(f => {
      if (f.length > maxFileWidth) {
        return '...' + f.slice(-(maxFileWidth - 3));
      }
      return f;
    });
  }, [files, maxFileWidth]);

  return (
    <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor={statusColor} paddingX={1}>
      {/* Header with status */}
      <Box>
        <Text bold>{theme.fg(statusToken, `${statusIcon} SITREP`)}</Text>
        <Text>{theme.fg('muted', ' — Status Report')}</Text>
      </Box>

      {/* Done section */}
      <Box marginTop={1}>
        <Text bold>{theme.fg('accent', 'Done: ')}</Text>
        <Text>{done}</Text>
      </Box>

      {/* Files section */}
      {displayFiles.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>{theme.fg('accent', 'Files:')}</Text>
          {displayFiles.map((file, idx) => (
            <Box key={idx} paddingLeft={2}>
              <Text>{theme.fg('muted', '• ')}</Text>
              <Text>{theme.fg('mdLink', file)}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Status and Next */}
      <Box marginTop={1}>
        <Text bold>{theme.fg('accent', 'Status: ')}</Text>
        <Text bold>{theme.fg(statusToken, status)}</Text>
        {next && (
          <>
            <Text>{theme.fg('muted', ' → ')}</Text>
            <Text>{theme.fg('muted', next)}</Text>
          </>
        )}
      </Box>

      {/* Verification section */}
      {verify && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>{theme.fg('accent', 'Verify:')}</Text>
          <Box paddingLeft={2}>
            <Text>{theme.fg('muted', '$ ')}</Text>
            <Text>{theme.fg('mdCode', verify)}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

/**
 * Memoized SitrepMessage - only re-renders when props change
 */
export const SitrepMessage = memo(SitrepMessageComponent);

/**
 * Parse SITREP text from assistant response
 * Returns parsed props or null if not a valid SITREP
 */
export function parseSitrepText(text: string): SitrepMessageProps | null {
  const lines = text.split('\n');
  let done = '';
  let files: string[] = [];
  let status: SitrepMessageProps['status'] = 'completed';
  let next = '';
  let verify = '';

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip the SITREP: header
    if (trimmed === 'SITREP:' || trimmed.startsWith('## SITREP')) continue;
    
    // Parse Done
    if (trimmed.startsWith('- Done:') || trimmed.startsWith('Done:')) {
      done = trimmed.replace(/^- Done:\s*/, '').replace(/^Done:\s*/, '');
      continue;
    }
    
    // Parse Files (comma-separated list)
    if (trimmed.startsWith('- Files:') || trimmed.startsWith('Files:')) {
      const filesStr = trimmed.replace(/^- Files:\s*/, '').replace(/^Files:\s*/, '');
      if (filesStr && !filesStr.startsWith('[')) {
        // Split by comma and trim each file path
        files = filesStr.split(',').map(f => f.trim()).filter(f => f.length > 0);
      }
      continue;
    }
    
    // Parse file list items (bullet points after Files:)
    if (trimmed.startsWith('- ') && !trimmed.startsWith('- Done') && !trimmed.startsWith('- Files') && !trimmed.startsWith('- Status') && !trimmed.startsWith('- Next') && !trimmed.startsWith('- Verify')) {
      const file = trimmed.slice(2).trim();
      if (file && !file.startsWith('[')) {
        files.push(file);
      }
      continue;
    }
    
    // Parse Status
    if (trimmed.startsWith('- Status:') || trimmed.startsWith('Status:')) {
      const statusStr = trimmed.replace(/^- Status:\s*/, '').replace(/^Status:\s*/, '').toLowerCase();
      if (statusStr.includes('completed')) status = 'completed';
      else if (statusStr.includes('in-progress') || statusStr.includes('in progress')) status = 'in-progress';
      else if (statusStr.includes('blocked')) status = 'blocked';
      continue;
    }
    
    // Parse Next
    if (trimmed.startsWith('- Next:') || trimmed.startsWith('Next:')) {
      next = trimmed.replace(/^- Next:\s*/, '').replace(/^Next:\s*/, '');
      continue;
    }
    
    // Parse Verify
    if (trimmed.startsWith('- Verify:') || trimmed.startsWith('Verify:') || trimmed.startsWith('How to verify:')) {
      verify = trimmed.replace(/^- Verify:\s*/, '').replace(/^Verify:\s*/, '').replace(/^How to verify:\s*/, '');
      continue;
    }
  }

  // Return null if we didn't parse anything meaningful
  if (!done && files.length === 0) {
    return null;
  }

  return { done, files, status, next: next || undefined, verify: verify || undefined };
}
