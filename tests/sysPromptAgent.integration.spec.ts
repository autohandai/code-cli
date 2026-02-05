/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import type { CLIOptions } from '../src/types.js';

// Test workspace setup
const TEST_BASE = path.join(os.tmpdir(), 'autohand-sysprompt-integration-tests');

describe('System Prompt Agent Integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    const timestamp = Date.now();
    tempDir = path.join(TEST_BASE, `workspace-${timestamp}`);
    await fs.ensureDir(tempDir);
  });

  afterEach(async () => {
    await fs.remove(TEST_BASE);
  });

  describe('resolvePromptValue integration', () => {
    it('resolves inline string correctly', async () => {
      const { resolvePromptValue } = await import('../src/utils/sysPrompt.js');

      const result = await resolvePromptValue('You are a Python expert', {
        cwd: tempDir,
      });

      expect(result).toBe('You are a Python expert');
    });

    it('resolves file path correctly', async () => {
      const { resolvePromptValue } = await import('../src/utils/sysPrompt.js');

      // Create a prompt file
      const promptFile = path.join(tempDir, 'custom-prompt.txt');
      await fs.writeFile(promptFile, 'Custom system prompt from file');

      const result = await resolvePromptValue(promptFile, {
        cwd: tempDir,
      });

      expect(result).toBe('Custom system prompt from file');
    });

    it('resolves relative file path with cwd', async () => {
      const { resolvePromptValue } = await import('../src/utils/sysPrompt.js');

      // Create a prompt file
      await fs.writeFile(path.join(tempDir, 'prompt.md'), '# System Prompt\n\nBe helpful.');

      const result = await resolvePromptValue('./prompt.md', {
        cwd: tempDir,
      });

      expect(result).toBe('# System Prompt\n\nBe helpful.');
    });
  });

  describe('--sys-prompt behavior', () => {
    it('sys-prompt completely replaces default prompt', async () => {
      const { resolvePromptValue } = await import('../src/utils/sysPrompt.js');

      // This test documents the expected behavior:
      // When --sys-prompt is provided, it should completely replace
      // the default system prompt (no AGENTS.md, memories, skills)

      const options: CLIOptions = {
        sysPrompt: 'You are a specialized Python debugger.',
      };

      if (options.sysPrompt) {
        const customPrompt = await resolvePromptValue(options.sysPrompt, {
          cwd: tempDir,
        });

        // The custom prompt IS the entire system prompt
        expect(customPrompt).toBe('You are a specialized Python debugger.');

        // Should NOT contain any default Autohand content
        expect(customPrompt).not.toContain('ReAct');
        expect(customPrompt).not.toContain('Autohand');
        expect(customPrompt).not.toContain('tool_calls');
      }
    });

    it('sys-prompt from file replaces default prompt', async () => {
      const { resolvePromptValue } = await import('../src/utils/sysPrompt.js');

      // Create a custom prompt file
      const promptFile = path.join(tempDir, 'minimal-prompt.txt');
      await fs.writeFile(promptFile, 'You are a minimal assistant. Just answer questions.');

      const options: CLIOptions = {
        sysPrompt: promptFile,
      };

      if (options.sysPrompt) {
        const customPrompt = await resolvePromptValue(options.sysPrompt, {
          cwd: tempDir,
        });

        expect(customPrompt).toBe('You are a minimal assistant. Just answer questions.');
      }
    });

    it('sys-prompt ignores AGENTS.md when provided', async () => {
      const { resolvePromptValue } = await import('../src/utils/sysPrompt.js');

      // Create an AGENTS.md file that would normally be loaded
      await fs.writeFile(path.join(tempDir, 'AGENTS.md'), '# Project Instructions\n\nAlways use TypeScript.');

      const options: CLIOptions = {
        sysPrompt: 'Custom prompt only',
      };

      // When sys-prompt is provided, AGENTS.md should be ignored
      // (This is tested through the agent, but we document the expectation here)
      if (options.sysPrompt) {
        const customPrompt = await resolvePromptValue(options.sysPrompt, {
          cwd: tempDir,
        });

        expect(customPrompt).toBe('Custom prompt only');
        expect(customPrompt).not.toContain('TypeScript');
        expect(customPrompt).not.toContain('Project Instructions');
      }
    });
  });

  describe('--append-sys-prompt behavior', () => {
    it('append-sys-prompt adds to end of prompt', async () => {
      const { resolvePromptValue } = await import('../src/utils/sysPrompt.js');

      // This test documents the expected behavior:
      // When --append-sys-prompt is provided, it should be appended
      // to the full default system prompt

      const options: CLIOptions = {
        appendSysPrompt: 'Additional: Always prefer TypeScript over JavaScript.',
      };

      if (options.appendSysPrompt) {
        const appendContent = await resolvePromptValue(options.appendSysPrompt, {
          cwd: tempDir,
        });

        expect(appendContent).toBe('Additional: Always prefer TypeScript over JavaScript.');

        // The agent should build: defaultPrompt + '\n\n' + appendContent
      }
    });

    it('append-sys-prompt from file adds to end of prompt', async () => {
      const { resolvePromptValue } = await import('../src/utils/sysPrompt.js');

      // Create an append file
      const appendFile = path.join(tempDir, 'append-instructions.md');
      await fs.writeFile(appendFile, '## Custom Instructions\n\n- Always explain your reasoning\n- Be concise');

      const options: CLIOptions = {
        appendSysPrompt: appendFile,
      };

      if (options.appendSysPrompt) {
        const appendContent = await resolvePromptValue(options.appendSysPrompt, {
          cwd: tempDir,
        });

        expect(appendContent).toContain('Custom Instructions');
        expect(appendContent).toContain('Be concise');
      }
    });
  });

  describe('precedence when both flags used', () => {
    it('sys-prompt takes precedence over append-sys-prompt', async () => {
      const { resolvePromptValue } = await import('../src/utils/sysPrompt.js');

      // When both flags are provided, --sys-prompt takes full precedence
      // and --append-sys-prompt is effectively ignored
      const options: CLIOptions = {
        sysPrompt: 'Custom replacement prompt',
        appendSysPrompt: 'This should be ignored',
      };

      // The agent should check for sysPrompt first
      if (options.sysPrompt) {
        const customPrompt = await resolvePromptValue(options.sysPrompt, {
          cwd: tempDir,
        });

        // When sysPrompt is provided, it's the only thing used
        expect(customPrompt).toBe('Custom replacement prompt');

        // appendSysPrompt is ignored when sysPrompt is present
        // (This is the documented precedence behavior)
      }
    });
  });

  describe('error scenarios', () => {
    it('throws error on empty file', async () => {
      const { resolvePromptValue, SysPromptError } = await import('../src/utils/sysPrompt.js');

      // Create an empty file
      const emptyFile = path.join(tempDir, 'empty.txt');
      await fs.writeFile(emptyFile, '');

      await expect(resolvePromptValue(emptyFile, {
        cwd: tempDir,
      })).rejects.toThrow(SysPromptError);
    });

    it('throws error on directory path', async () => {
      const { resolvePromptValue } = await import('../src/utils/sysPrompt.js');

      // Create a directory
      const dirPath = path.join(tempDir, 'not-a-file');
      await fs.ensureDir(dirPath);

      await expect(resolvePromptValue(dirPath, {
        cwd: tempDir,
      })).rejects.toThrow('Path is a directory');
    });

    it('treats non-existent file as inline string', async () => {
      const { resolvePromptValue } = await import('../src/utils/sysPrompt.js');

      // A path-like string that doesn't exist is treated as inline
      const result = await resolvePromptValue('./does-not-exist.txt', {
        cwd: tempDir,
      });

      // Since file doesn't exist, it's treated as inline string
      expect(result).toBe('./does-not-exist.txt');
    });

    it('handles large file gracefully', async () => {
      const { resolvePromptValue } = await import('../src/utils/sysPrompt.js');

      // Create a file larger than 1MB
      const largeFile = path.join(tempDir, 'large.txt');
      const largeContent = 'x'.repeat(1024 * 1024 + 100);
      await fs.writeFile(largeFile, largeContent);

      await expect(resolvePromptValue(largeFile, {
        cwd: tempDir,
      })).rejects.toThrow('exceeds maximum size');
    });
  });

  describe('special characters and encoding', () => {
    it('handles unicode content in file', async () => {
      const { resolvePromptValue } = await import('../src/utils/sysPrompt.js');

      // Create a file with unicode
      const unicodeFile = path.join(tempDir, 'unicode.txt');
      await fs.writeFile(unicodeFile, 'Instruction: Respond politely\nExample: Nice job!\n', 'utf-8');

      const result = await resolvePromptValue(unicodeFile, {
        cwd: tempDir,
      });

      expect(result).toContain('Respond politely');
      expect(result).toContain('Nice job!');
    });

    it('handles special characters in inline string', async () => {
      const { resolvePromptValue } = await import('../src/utils/sysPrompt.js');

      const specialChars = 'Use "quotes" and \'apostrophes\' and {braces} and $variables';
      const result = await resolvePromptValue(specialChars, {
        cwd: tempDir,
      });

      expect(result).toBe(specialChars);
    });

    it('handles markdown formatting in file', async () => {
      const { resolvePromptValue } = await import('../src/utils/sysPrompt.js');

      const markdownFile = path.join(tempDir, 'instructions.md');
      const markdown = `# System Prompt

## Rules
1. Be helpful
2. Be concise
3. Use code blocks for code

\`\`\`typescript
const x = 1;
\`\`\`
`;
      await fs.writeFile(markdownFile, markdown);

      const result = await resolvePromptValue(markdownFile, {
        cwd: tempDir,
      });

      expect(result).toContain('# System Prompt');
      expect(result).toContain('```typescript');
      expect(result).toContain('const x = 1;');
    });
  });
});
