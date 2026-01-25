/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { looksLikeFilePath, resolvePromptValue, validatePromptContent, SysPromptError } from '../src/utils/sysPrompt.js';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';

describe('sysPrompt utility', () => {
  describe('looksLikeFilePath', () => {
    describe('should detect file paths', () => {
      it('detects relative paths starting with ./', () => {
        expect(looksLikeFilePath('./prompt.txt')).toBe(true);
        expect(looksLikeFilePath('./foo/bar.md')).toBe(true);
      });

      it('detects relative paths starting with ../', () => {
        expect(looksLikeFilePath('../prompt.txt')).toBe(true);
        expect(looksLikeFilePath('../foo/bar.md')).toBe(true);
      });

      it('detects absolute Unix paths', () => {
        expect(looksLikeFilePath('/home/user/prompt.txt')).toBe(true);
        expect(looksLikeFilePath('/etc/config')).toBe(true);
      });

      it('detects home directory paths', () => {
        expect(looksLikeFilePath('~/prompt.txt')).toBe(true);
        expect(looksLikeFilePath('~/.autohand/prompt.md')).toBe(true);
      });

      it('detects Windows absolute paths', () => {
        expect(looksLikeFilePath('C:\\Users\\test\\prompt.txt')).toBe(true);
        expect(looksLikeFilePath('D:/Documents/prompt.md')).toBe(true);
      });

      it('detects prompt file extensions', () => {
        expect(looksLikeFilePath('prompt.txt')).toBe(true);
        expect(looksLikeFilePath('system.md')).toBe(true);
        expect(looksLikeFilePath('custom.prompt')).toBe(true);
        expect(looksLikeFilePath('MY_PROMPT.TXT')).toBe(true);
      });

      it('detects path-like strings without spaces', () => {
        expect(looksLikeFilePath('foo/bar/baz')).toBe(true);
        expect(looksLikeFilePath('src/prompts/system')).toBe(true);
      });
    });

    describe('should detect inline strings', () => {
      it('returns false for multi-line strings', () => {
        expect(looksLikeFilePath('You are a helpful\nassistant')).toBe(false);
        expect(looksLikeFilePath('Line 1\nLine 2\nLine 3')).toBe(false);
      });

      it('returns false for plain text without path indicators', () => {
        expect(looksLikeFilePath('You are a helpful assistant')).toBe(false);
        expect(looksLikeFilePath('Be concise and clear')).toBe(false);
        expect(looksLikeFilePath('Hello world')).toBe(false);
      });

      it('returns false for empty or null values', () => {
        expect(looksLikeFilePath('')).toBe(false);
        expect(looksLikeFilePath('   ')).toBe(false);
        expect(looksLikeFilePath(null as any)).toBe(false);
        expect(looksLikeFilePath(undefined as any)).toBe(false);
      });

      it('returns false for strings with special characters', () => {
        expect(looksLikeFilePath('Use @mentions and #hashtags')).toBe(false);
        expect(looksLikeFilePath('Write clean, efficient code')).toBe(false);
      });
    });
  });

  describe('resolvePromptValue', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sysprompt-test-'));
    });

    afterEach(async () => {
      await fs.remove(tempDir);
    });

    describe('inline strings', () => {
      it('returns inline string as-is', async () => {
        const result = await resolvePromptValue('You are a helpful assistant');
        expect(result).toBe('You are a helpful assistant');
      });

      it('handles multi-line inline strings', async () => {
        const input = 'Line 1\nLine 2\nLine 3';
        const result = await resolvePromptValue(input);
        expect(result).toBe(input);
      });

      it('trims whitespace from inline strings', async () => {
        const result = await resolvePromptValue('  Hello world  ');
        expect(result).toBe('Hello world');
      });

      it('throws on empty value', async () => {
        await expect(resolvePromptValue('')).rejects.toThrow(SysPromptError);
        await expect(resolvePromptValue('   ')).rejects.toThrow(SysPromptError);
      });
    });

    describe('file reading', () => {
      it('reads content from valid file', async () => {
        const filePath = path.join(tempDir, 'prompt.txt');
        await fs.writeFile(filePath, 'Custom system prompt content');

        const result = await resolvePromptValue(filePath);
        expect(result).toBe('Custom system prompt content');
      });

      it('reads content from .md file', async () => {
        const filePath = path.join(tempDir, 'system.md');
        await fs.writeFile(filePath, '# System Prompt\n\nBe helpful.');

        const result = await resolvePromptValue(filePath);
        expect(result).toBe('# System Prompt\n\nBe helpful.');
      });

      it('reads content from .prompt file', async () => {
        const filePath = path.join(tempDir, 'custom.prompt');
        await fs.writeFile(filePath, 'Specialized instructions');

        const result = await resolvePromptValue(filePath);
        expect(result).toBe('Specialized instructions');
      });

      it('handles relative paths with cwd option', async () => {
        const filePath = path.join(tempDir, 'prompt.txt');
        await fs.writeFile(filePath, 'Content from relative path');

        const result = await resolvePromptValue('./prompt.txt', { cwd: tempDir });
        expect(result).toBe('Content from relative path');
      });

      it('handles nested directory paths', async () => {
        const nestedDir = path.join(tempDir, 'prompts', 'system');
        await fs.ensureDir(nestedDir);
        const filePath = path.join(nestedDir, 'main.txt');
        await fs.writeFile(filePath, 'Nested prompt content');

        const result = await resolvePromptValue(filePath);
        expect(result).toBe('Nested prompt content');
      });

      it('handles unicode content', async () => {
        const filePath = path.join(tempDir, 'unicode.txt');
        const unicodeContent = 'Hello\nPrimer\n\u2705';
        await fs.writeFile(filePath, unicodeContent, 'utf-8');

        const result = await resolvePromptValue(filePath);
        expect(result).toBe(unicodeContent);
      });

      it('treats non-existent file paths as inline strings', async () => {
        // A path-like string that doesn't exist is treated as inline
        const result = await resolvePromptValue('./nonexistent.txt');
        expect(result).toBe('./nonexistent.txt');
      });
    });

    describe('error handling', () => {
      it('throws on empty file', async () => {
        const filePath = path.join(tempDir, 'empty.txt');
        await fs.writeFile(filePath, '');

        await expect(resolvePromptValue(filePath)).rejects.toThrow('Prompt file is empty');
      });

      it('throws on whitespace-only file', async () => {
        const filePath = path.join(tempDir, 'whitespace.txt');
        await fs.writeFile(filePath, '   \n\t\n   ');

        await expect(resolvePromptValue(filePath)).rejects.toThrow('Prompt file is empty');
      });

      it('throws on directory path', async () => {
        const dirPath = path.join(tempDir, 'subdir');
        await fs.ensureDir(dirPath);

        await expect(resolvePromptValue(dirPath)).rejects.toThrow('Path is a directory');
      });

      it('throws on file exceeding size limit', async () => {
        const filePath = path.join(tempDir, 'large.txt');
        // Create a file larger than 1MB
        const largeContent = 'x'.repeat(1024 * 1024 + 1);
        await fs.writeFile(filePath, largeContent);

        await expect(resolvePromptValue(filePath)).rejects.toThrow('exceeds maximum size');
      });
    });

    describe('home directory expansion', () => {
      it('expands ~ to home directory', async () => {
        // Create a file in the home directory for testing
        const homeFile = path.join(os.homedir(), '.autohand-test-prompt.txt');

        try {
          await fs.writeFile(homeFile, 'Home directory content');
          const result = await resolvePromptValue('~/.autohand-test-prompt.txt');
          expect(result).toBe('Home directory content');
        } finally {
          await fs.remove(homeFile);
        }
      });
    });
  });

  describe('validatePromptContent', () => {
    it('returns true for valid content', () => {
      expect(validatePromptContent('Valid prompt content')).toBe(true);
      expect(validatePromptContent('Multi\nline\ncontent')).toBe(true);
    });

    it('throws on empty content', () => {
      expect(() => validatePromptContent('')).toThrow(SysPromptError);
      expect(() => validatePromptContent('   ')).toThrow(SysPromptError);
    });

    it('throws on null/undefined', () => {
      expect(() => validatePromptContent(null as any)).toThrow(SysPromptError);
      expect(() => validatePromptContent(undefined as any)).toThrow(SysPromptError);
    });

    it('throws on content exceeding size limit', () => {
      const largeContent = 'x'.repeat(1024 * 1024 + 1);
      expect(() => validatePromptContent(largeContent)).toThrow('exceeds maximum size');
    });
  });
});
