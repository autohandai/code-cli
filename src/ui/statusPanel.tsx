/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { Box, Text, render } from 'ink';

export interface StatusPanelProps {
  model: string;
  workspace: string;
  contextPercent: number;
}

function StatusPanel({ model, workspace, contextPercent }: StatusPanelProps) {
  const safePercent = Math.max(0, Math.min(100, contextPercent));
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
      <Text color="magenta">Autohand Status</Text>
      <Text color="gray">model: {model}</Text>
      <Text color="gray">workspace: {workspace}</Text>
      <Text color="gray">context left: {safePercent}% · ESC to cancel · / for commands · @ to mention files</Text>
    </Box>
  );
}

export function startStatusPanel(initial: StatusPanelProps) {
  const instance = render(<StatusPanel {...initial} />);
  return {
    update(next: StatusPanelProps) {
      instance.rerender(<StatusPanel {...next} />);
    },
    stop() {
      instance.unmount();
    }
  };
}
