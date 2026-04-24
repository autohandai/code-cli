/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tool-output compression (head/tail truncation with metadata preservation).
 * Extracted from contextManager.ts for composability.
 */
import type { LLMMessage } from '../../types.js';
import { estimateMessageTokens } from './tokenizer.js';
import { extractMessageMetadata } from './priority.js';

/**
 * Compress a verbose tool output while preserving key information.
 * Uses head/tail truncation with metadata preservation.
 */
export function compressToolOutput(message: LLMMessage, maxLength = 500): LLMMessage {
  if (message.role !== 'tool' || !message.content) {
    return message;
  }

  const content = message.content;
  if (content.length <= maxLength) {
    return message;
  }

  const metadata = extractMessageMetadata(message);
  const originalTokens = estimateMessageTokens(message);

  // For file reads, keep first and last parts
  const headLength = Math.floor(maxLength * 0.6);
  const tailLength = Math.floor(maxLength * 0.3);
  const head = content.slice(0, headLength);
  const tail = content.slice(-tailLength);

  const compressedContent = [
    head,
    `\n\n... [${content.length - headLength - tailLength} characters compressed] ...\n\n`,
    tail,
    metadata.files ? `\n\n[Files: ${metadata.files.join(', ')}]` : '',
  ].join('');

  return {
    ...message,
    content: compressedContent,
    metadata: {
      ...metadata,
      originalTokens,
      isCompressed: true,
    },
  };
}
