/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

export interface StatusLineProps {
  isWorking: boolean;
  status: string;
  elapsed?: string;
  tokens?: string;
  queueCount?: number;
}

export function StatusLine({ isWorking, status, elapsed, tokens, queueCount = 0 }: StatusLineProps) {
  if (!isWorking) {
    return null;
  }

  return (
    <Box>
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
      <Text> {status}</Text>
      {elapsed && <Text color="gray"> ({elapsed}</Text>}
      {tokens && <Text color="gray"> · {tokens}</Text>}
      {elapsed && <Text color="gray">)</Text>}
      {queueCount > 0 && (
        <Text color="cyan"> [{queueCount} queued]</Text>
      )}
      <Text color="gray"> · esc to cancel</Text>
    </Box>
  );
}
