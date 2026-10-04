/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { Box, Text, useWindowSize } from 'ink';
import { formatAssistantMarkdown } from '../../terminalMarkdown.js';

/**
 * Assistant text rendered as terminal markdown, or as written when
 * `ui.renderMarkdown` is off. The preference is read on every render.
 */
export function MarkdownText({ content }: { content: string }): React.ReactElement {
  const { columns } = useWindowSize();
  const width = Math.max(1, Math.min(columns, 100));
  return <Box width="100%" maxWidth={width}><Text>{formatAssistantMarkdown(content, { width })}</Text></Box>;
}
