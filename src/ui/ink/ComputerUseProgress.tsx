import React, { memo } from 'react';
import { Box, Text } from 'ink';
import type { ComputerUseStep } from '../../computer/computerUseOutput.js';

const SYMBOLS: Record<ComputerUseStep['status'], string> = {
  running: '›', done: '✓', unverified: '?', failed: '×', cancelled: '–',
};

export const ComputerUseProgress = memo(function ComputerUseProgress({ steps }: { steps: ComputerUseStep[] }) {
  if (steps.length === 0) return null;
  const visible = steps.slice(-12);
  const earlier = steps.slice(0, -12);
  const unresolved = earlier.filter(step => step.status !== 'done').length;
  return <Box flexDirection="column">
    <Text bold>Computer Use</Text>
    {earlier.length > 0 && <Text dimColor>{earlier.length} earlier steps{unresolved ? ` · ${unresolved} incomplete or unverified` : ''}</Text>}
    {visible.map((step, index) => <Text key={step.id} wrap="truncate-end">
      <Text dimColor>{index === visible.length - 1 ? '└─' : '├─'} </Text>
      {SYMBOLS[step.status]} {step.label}{step.detail ? ` · ${step.detail}` : ''}
    </Text>)}
  </Box>;
});
