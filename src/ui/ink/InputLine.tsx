/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { Box, Text } from 'ink';

export interface InputLineProps {
  value: string;
  isActive: boolean;
}

export function InputLine({ value, isActive }: InputLineProps) {
  if (!isActive) {
    return null;
  }

  return (
    <Box marginTop={1}>
      <Text color="gray">› </Text>
      <Text>{value}</Text>
      <Text color="cyan">▊</Text>
    </Box>
  );
}
