/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractMessageMetadata,
  determineMessagePriority,
  compressToolOutput,
  summarizeMessages,
  sortMessagesByPriority,
} from '../src/core/contextManager.js';
import type { LLMMessage } from '../src/types.js';

describe('Context Manager - Smart Summarization', () => {
  describe('extractMessageMetadata', () => {
    it('extracts file paths from message content', () => {
      const message: LLMMessage = {
        role: 'tool',
        content: 'Read file src/index.ts and found exports in lib/utils.js',
      };
      const metadata = extractMessageMetadata(message);
      expect(metadata.files).toContain('src/index.ts');
      expect(metadata.files).toContain('lib/utils.js');
    });

    it('extracts file paths from backticks', () => {
      const message: LLMMessage = {
        role: 'assistant',
        content: 'I will edit `package.json` and `tsconfig.json`',
      };
      const metadata = extractMessageMetadata(message);
      expect(metadata.files).toContain('package.json');
      expect(metadata.files).toContain('tsconfig.json');
    });

    it('detects decision patterns', () => {
      const message: LLMMessage = {
        role: 'assistant',
        content: "I'll use TypeScript for this project because it provides better type safety.",
      };
      const metadata = extractMessageMetadata(message);
      expect(metadata.isDecision).toBe(true);
    });

    it('detects error patterns', () => {
      const message: LLMMessage = {
        role: 'tool',
        content: 'Error: Cannot find module "react"',
      };
      const metadata = extractMessageMetadata(message);
      expect(metadata.isError).toBe(true);
    });

    it('extracts tool names from tool messages', () => {
      const message: LLMMessage = {
        role: 'tool',
        name: 'read_file',
        content: 'File contents here',
      };
      const metadata = extractMessageMetadata(message);
      expect(metadata.tools).toContain('read_file');
    });
  });

  describe('determineMessagePriority', () => {
    it('system messages are critical', () => {
      const message: LLMMessage = { role: 'system', content: 'You are a helpful assistant' };
      expect(determineMessagePriority(message)).toBe('critical');
    });

    it('user messages are high priority', () => {
      const message: LLMMessage = { role: 'user', content: 'Fix the bug in login' };
      expect(determineMessagePriority(message)).toBe('high');
    });

    it('error messages are high priority', () => {
      const message: LLMMessage = { role: 'tool', content: 'TypeError: undefined is not a function' };
      expect(determineMessagePriority(message)).toBe('high');
    });

    it('long tool outputs are low priority', () => {
      const message: LLMMessage = {
        role: 'tool',
        content: 'x'.repeat(3000), // Long content
      };
      expect(determineMessagePriority(message)).toBe('low');
    });

    it('assistant decisions are high priority', () => {
      const message: LLMMessage = {
        role: 'assistant',
        content: "I decided to use React for the frontend.",
      };
      expect(determineMessagePriority(message)).toBe('high');
    });
  });

  describe('compressToolOutput', () => {
    it('does not compress short messages', () => {
      const message: LLMMessage = {
        role: 'tool',
        content: 'Short content',
      };
      const compressed = compressToolOutput(message, 500);
      expect(compressed.content).toBe('Short content');
    });

    it('compresses long messages while preserving head and tail', () => {
      const message: LLMMessage = {
        role: 'tool',
        content: 'START' + 'x'.repeat(2000) + 'END',
      };
      const compressed = compressToolOutput(message, 500);
      expect(compressed.content).toContain('START');
      expect(compressed.content).toContain('END');
      expect(compressed.content).toContain('characters compressed');
      expect(compressed.metadata?.isCompressed).toBe(true);
    });

    it('only compresses tool messages', () => {
      const message: LLMMessage = {
        role: 'assistant',
        content: 'x'.repeat(2000),
      };
      const compressed = compressToolOutput(message, 500);
      expect(compressed.content).toBe(message.content);
    });
  });

  describe('summarizeMessages', () => {
    it('creates summary with user requests', () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: 'Fix the login bug' },
        { role: 'assistant', content: 'I will look into it' },
      ];
      const summary = summarizeMessages(messages);
      expect(summary).toContain('Context Summary');
      expect(summary).toContain('Fix the login bug');
    });

    it('includes files touched', () => {
      const messages: LLMMessage[] = [
        { role: 'tool', name: 'read_file', content: 'Contents of src/auth.ts' },
      ];
      const summary = summarizeMessages(messages);
      expect(summary).toContain('Files touched');
      expect(summary).toContain('src/auth.ts');
    });

    it('includes tools used', () => {
      const messages: LLMMessage[] = [
        { role: 'tool', name: 'read_file', content: 'file contents' },
        { role: 'tool', name: 'write_file', content: 'success' },
      ];
      const summary = summarizeMessages(messages);
      expect(summary).toContain('Tools used');
      expect(summary).toContain('read_file');
      expect(summary).toContain('write_file');
    });
  });

  describe('sortMessagesByPriority', () => {
    it('sorts low priority messages first', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'user' },
        { role: 'tool', content: 'x'.repeat(3000) }, // low priority (long)
        { role: 'assistant', content: 'assistant' },
      ];
      const sorted = sortMessagesByPriority(messages);
      // Index 2 (long tool) should be first in removal order
      expect(sorted[0]).toBe(2);
    });

    it('keeps system messages last in removal order', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'system' },
        { role: 'tool', content: 'short tool' },
      ];
      const sorted = sortMessagesByPriority(messages);
      // System message (index 0) should be last in removal order
      expect(sorted[sorted.length - 1]).toBe(0);
    });
  });
});
