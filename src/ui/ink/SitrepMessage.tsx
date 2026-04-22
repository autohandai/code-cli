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
  completed: 'green',
  'in-progress': 'yellow',
  blocked: 'red',
} as const;

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
  const { colors } = useTheme();
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? 80;

  const statusColor = STATUS_COLORS[status];
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
        <Text bold color={statusColor}>
          {statusIcon} SITREP
        </Text>
        <Text dimColor> — Status Report</Text>
      </Box>

      {/* Done section */}
      <Box marginTop={1}>
        <Text bold color="cyan">Done: </Text>
        <Text>{done}</Text>
      </Box>

      {/* Files section */}
      {displayFiles.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color="cyan">Files:</Text>
          {displayFiles.map((file, idx) => (
            <Box key={idx} paddingLeft={2}>
              <Text dimColor>• </Text>
              <Text color="blue">{file}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Status and Next */}
      <Box marginTop={1}>
        <Text bold color="cyan">Status: </Text>
        <Text bold color={statusColor}>{status}</Text>
        {next && (
          <>
            <Text dimColor> → </Text>
            <Text dimColor>{next}</Text>
          </>
        )}
      </Box>

      {/* Verification section */}
      {verify && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color="cyan">Verify:</Text>
          <Box paddingLeft={2}>
            <Text dimColor>$ </Text>
            <Text color="magenta">{verify}</Text>
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