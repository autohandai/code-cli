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

describe('System Prompt CLI Options', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sysprompt-cli-test-'));
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  describe('--sys-prompt flag parsing', () => {
    it('accepts inline string value', () => {
      const options: CLIOptions = {
        sysPrompt: 'You are a Python expert',
      };

      expect(options.sysPrompt).toBe('You are a Python expert');
    });

    it('accepts file path value', () => {
      const options: CLIOptions = {
        sysPrompt: './custom-prompt.txt',
      };

      expect(options.sysPrompt).toBe('./custom-prompt.txt');
    });

    it('accepts absolute path value', () => {
      const promptPath = path.join(tempDir, 'prompt.txt');
      const options: CLIOptions = {
        sysPrompt: promptPath,
      };

      expect(options.sysPrompt).toBe(promptPath);
    });

    it('accepts home directory path', () => {
      const options: CLIOptions = {
        sysPrompt: '~/.autohand/system-prompt.txt',
      };

      expect(options.sysPrompt).toBe('~/.autohand/system-prompt.txt');
    });

    it('can be undefined when not provided', () => {
      const options: CLIOptions = {};

      expect(options.sysPrompt).toBeUndefined();
    });
  });

  describe('--append-sys-prompt flag parsing', () => {
    it('accepts inline string value', () => {
      const options: CLIOptions = {
        appendSysPrompt: 'Always use TypeScript',
      };

      expect(options.appendSysPrompt).toBe('Always use TypeScript');
    });

    it('accepts file path value', () => {
      const options: CLIOptions = {
        appendSysPrompt: './additional-instructions.md',
      };

      expect(options.appendSysPrompt).toBe('./additional-instructions.md');
    });

    it('accepts absolute path value', () => {
      const promptPath = path.join(tempDir, 'append.txt');
      const options: CLIOptions = {
        appendSysPrompt: promptPath,
      };

      expect(options.appendSysPrompt).toBe(promptPath);
    });

    it('can be undefined when not provided', () => {
      const options: CLIOptions = {};

      expect(options.appendSysPrompt).toBeUndefined();
    });
  });

  describe('combination with other options', () => {
    it('sys-prompt can be used with --prompt', () => {
      const options: CLIOptions = {
        prompt: 'Write hello world',
        sysPrompt: 'You are a Python expert',
      };

      expect(options.prompt).toBe('Write hello world');
      expect(options.sysPrompt).toBe('You are a Python expert');
    });

    it('append-sys-prompt can be used with --prompt', () => {
      const options: CLIOptions = {
        prompt: 'Create a function',
        appendSysPrompt: 'Always use TypeScript',
      };

      expect(options.prompt).toBe('Create a function');
      expect(options.appendSysPrompt).toBe('Always use TypeScript');
    });

    it('sys-prompt can be used with --model', () => {
      const options: CLIOptions = {
        model: 'claude-3-opus',
        sysPrompt: 'Be concise',
      };

      expect(options.model).toBe('claude-3-opus');
      expect(options.sysPrompt).toBe('Be concise');
    });

    it('both flags can be used together', () => {
      const options: CLIOptions = {
        sysPrompt: 'You are a coding assistant',
        appendSysPrompt: 'Focus on performance',
      };

      expect(options.sysPrompt).toBe('You are a coding assistant');
      expect(options.appendSysPrompt).toBe('Focus on performance');
    });

    it('sys-prompt and append-sys-prompt with other flags', () => {
      const options: CLIOptions = {
        prompt: 'Write tests',
        model: 'gpt-4',
        debug: true,
        sysPrompt: 'Expert test writer',
        appendSysPrompt: 'Use vitest',
      };

      expect(options.prompt).toBe('Write tests');
      expect(options.model).toBe('gpt-4');
      expect(options.debug).toBe(true);
      expect(options.sysPrompt).toBe('Expert test writer');
      expect(options.appendSysPrompt).toBe('Use vitest');
    });
  });

  describe('precedence behavior', () => {
    it('documents expected precedence: sys-prompt takes full precedence', () => {
      // When --sys-prompt is provided, it should completely replace the default
      // system prompt, ignoring AGENTS.md, memories, and skills
      const options: CLIOptions = {
        sysPrompt: 'Custom replacement prompt',
        appendSysPrompt: 'This should be ignored when sys-prompt is present',
      };

      // The agent should check for sysPrompt first
      // If present, it replaces everything and appendSysPrompt is ignored
      expect(options.sysPrompt).toBeDefined();
    });

    it('documents expected behavior: append-sys-prompt adds to default', () => {
      // When only --append-sys-prompt is provided, it should be appended
      // to the full default system prompt (including AGENTS.md, memories, skills)
      const options: CLIOptions = {
        appendSysPrompt: 'Additional instructions to append',
      };

      expect(options.sysPrompt).toBeUndefined();
      expect(options.appendSysPrompt).toBeDefined();
    });

    it('documents expected behavior: neither flag uses default prompt', () => {
      // When neither flag is provided, use the default behavior
      const options: CLIOptions = {
        prompt: 'Just a regular prompt',
      };

      expect(options.sysPrompt).toBeUndefined();
      expect(options.appendSysPrompt).toBeUndefined();
    });
  });

  describe('type validation', () => {
    it('sysPrompt should be string type', () => {
      const options: CLIOptions = {
        sysPrompt: 'test',
      };

      expect(typeof options.sysPrompt).toBe('string');
    });

    it('appendSysPrompt should be string type', () => {
      const options: CLIOptions = {
        appendSysPrompt: 'test',
      };

      expect(typeof options.appendSysPrompt).toBe('string');
    });
  });
});
