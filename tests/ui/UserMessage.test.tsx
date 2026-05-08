/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { UserMessage } from '../../src/ui/ink/UserMessage.js';
import { ThemeProvider } from '../../src/ui/theme/ThemeContext.js';
import { I18nProvider } from '../../src/ui/i18n/index.js';
import { Theme } from '../../src/ui/theme/Theme.js';
import { COLOR_TOKENS, type ResolvedColors } from '../../src/ui/theme/types.js';

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function renderWithProviders(element: React.ReactElement) {
  const colors = createMockColors({
    userMessageBg: '#9e9e9e',
    userMessageText: '#f5f5f5',
  });
  const theme = new Theme('user-message-test', colors, 'truecolor');

  return render(
    <I18nProvider>
      <ThemeProvider theme={theme}>
        {element}
      </ThemeProvider>
    </I18nProvider>
  );
}

function createMockColors(overrides: Partial<ResolvedColors> = {}): ResolvedColors {
  const base: ResolvedColors = {} as ResolvedColors;
  for (const token of COLOR_TOKENS) {
    base[token] = '#ffffff';
  }
  return { ...base, ...overrides };
}

describe('UserMessage', () => {
  describe('normal messages', () => {
    it('renders short messages with full background', () => {
      const { lastFrame } = renderWithProviders(<UserMessage>Hello world</UserMessage>);
      const output = lastFrame();
      expect(output).toContain('Hello world');
    });

    it('applies the background to the row container instead of only the text', () => {
      const { lastFrame } = renderWithProviders(<UserMessage>Hello world</UserMessage>);
      const output = lastFrame();

      expect(stripAnsi(output)).toContain(' Hello world');
      expect(output).toContain('\u001b[48;2;158;158;158m');
      expect(output).toContain('\u001b[38;2;245;245;245m');
    });

    it('renders painted vertical padding above and below the message text', () => {
      const { lastFrame } = renderWithProviders(<UserMessage>Hello world</UserMessage>);
      const plainLines = stripAnsi(lastFrame()).split('\n');
      const messageIndex = plainLines.findIndex((line) => line.includes('Hello world'));

      expect(messageIndex).toBeGreaterThan(0);
      expect(plainLines[messageIndex - 1]).toMatch(/^\s+$/);
      expect(plainLines[messageIndex + 1]).toMatch(/^\s+$/);
    });

    it('renders queued messages with prefix', () => {
      const { lastFrame } = renderWithProviders(<UserMessage isQueued>Test message</UserMessage>);
      const output = lastFrame();
      expect(output).toContain('(queued)');
      expect(output).toContain('Test message');
    });
  });

  describe('large text handling', () => {
    it('collapses text with more than 15 lines', () => {
      const largeText = Array(20).fill('Line of text').join('\n');
      const { lastFrame } = renderWithProviders(<UserMessage>{largeText}</UserMessage>);
      const output = lastFrame();
      
      // Should show compact box, not all lines
      expect(output).toContain('Text');
      expect(output).toContain('20 lines');
      expect(output).toContain('collapsed for readability');
    });

    it('collapses text with more than 1500 characters', () => {
      const largeText = 'x'.repeat(2000);
      const { lastFrame } = renderWithProviders(<UserMessage>{largeText}</UserMessage>);
      const output = lastFrame();
      
      // Should show compact box
      expect(output).toContain('Text');
      expect(output).toContain('collapsed for readability');
    });

    it('detects code blocks', () => {
      const codeBlock = '```javascript\n' + Array(20).fill('const x = 1;').join('\n') + '\n```';
      const { lastFrame } = renderWithProviders(<UserMessage>{codeBlock}</UserMessage>);
      const output = lastFrame();
      
      expect(output).toContain('Code block');
    });

    it('detects JSON content', () => {
      const json = JSON.stringify({ data: Array(50).fill({ key: 'value' }) }, null, 2);
      const { lastFrame } = renderWithProviders(<UserMessage>{json}</UserMessage>);
      const output = lastFrame();
      
      expect(output).toContain('JSON');
    });

    it('detects stack traces', () => {
      const stackTrace = `Error: Something went wrong
    at Function.execute (file.js:10:15)
    at Object.<anonymous> (file.js:20:5)
    at Module._compile (module.js:653:30)
    ${Array(15).fill('    at someFunction (another.js:5:10)').join('\n')}`;
      
      const { lastFrame } = renderWithProviders(<UserMessage>{stackTrace}</UserMessage>);
      const output = lastFrame();
      
      expect(output).toContain('Stack trace');
    });

    it('detects log output', () => {
      const logs = Array(20).fill('[2024-01-15 10:30:45] [INFO] Processing request').join('\n');
      const { lastFrame } = renderWithProviders(<UserMessage>{logs}</UserMessage>);
      const output = lastFrame();
      
      expect(output).toContain('Log output');
    });

    it('detects diff/patch content', () => {
      const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,5 +1,5 @@
${Array(20).fill('+ new line').join('\n')}`;
      
      const { lastFrame } = renderWithProviders(<UserMessage>{diff}</UserMessage>);
      const output = lastFrame();
      
      expect(output).toContain('Diff');
    });

    it('shows byte size for large content', () => {
      const largeText = 'x'.repeat(5000);
      const { lastFrame } = renderWithProviders(<UserMessage>{largeText}</UserMessage>);
      const output = lastFrame();
      
      expect(output).toContain('KB');
    });

    it('shows queued indicator in collapsed view', () => {
      const largeText = Array(20).fill('Line of text').join('\n');
      const { lastFrame } = renderWithProviders(<UserMessage isQueued>{largeText}</UserMessage>);
      const output = lastFrame();
      
      expect(output).toContain('(queued)');
    });
  });

  describe('truncation for medium messages', () => {
    it('truncates messages between 5 and 15 lines with ellipsis', () => {
      const mediumText = Array(10).fill('Line of text here').join('\n');
      const { lastFrame } = renderWithProviders(<UserMessage>{mediumText}</UserMessage>);
      const output = lastFrame();
      
      // Should show truncated with ...
      expect(output).toContain('...');
    });
  });
});
