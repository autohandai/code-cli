/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { execSync } from 'node:child_process';

// Mock child_process
vi.mock('node:child_process', () => ({
  execSync: vi.fn()
}));

// Mock chalk to avoid ANSI codes in tests
vi.mock('chalk', () => ({
  default: {
    red: (str: string) => `[RED]${str}[/RED]`,
    gray: (str: string) => `[GRAY]${str}[/GRAY]`,
    cyan: (str: string) => str,
    green: (str: string) => str,
    yellow: (str: string) => str,
    bold: (str: string) => str,
    dim: (str: string) => str
  }
}));

describe('Shell Command Feature', () => {
  const mockedExecSync = execSync as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('executeShellCommand', () => {
    // Import the function after mocks are set up
    let executeShellCommand: typeof import('../../src/ui/shellCommand.js').executeShellCommand;

    beforeEach(async () => {
      const module = await import('../../src/ui/shellCommand.js');
      executeShellCommand = module.executeShellCommand;
    });

    it('should execute a valid shell command and return stdout', () => {
      mockedExecSync.mockReturnValue('file1.txt\nfile2.txt\n');

      const result = executeShellCommand('ls -la');

      expect(mockedExecSync).toHaveBeenCalledWith('ls -la', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd(),
        timeout: 30000
      });
      expect(result.success).toBe(true);
      expect(result.output).toBe('file1.txt\nfile2.txt\n');
      expect(result.error).toBeUndefined();
    });

    it('should handle command with no output', () => {
      mockedExecSync.mockReturnValue('');

      const result = executeShellCommand('echo -n ""');

      expect(result.success).toBe(true);
      expect(result.output).toBe('');
    });

    it('should return error when command fails with stderr', () => {
      const error = new Error('Command failed') as Error & { stderr: string };
      error.stderr = 'ls: cannot access /nonexistent: No such file or directory';
      mockedExecSync.mockImplementation(() => {
        throw error;
      });

      const result = executeShellCommand('ls /nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('ls: cannot access /nonexistent: No such file or directory');
    });

    it('should return error message when command fails without stderr', () => {
      const error = new Error('Command timed out');
      mockedExecSync.mockImplementation(() => {
        throw error;
      });

      const result = executeShellCommand('sleep 100');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Command timed out');
    });

    it('should trim whitespace from command', () => {
      mockedExecSync.mockReturnValue('output');

      executeShellCommand('  git status  ');

      expect(mockedExecSync).toHaveBeenCalledWith('git status', expect.any(Object));
    });

    it('should use specified working directory', () => {
      mockedExecSync.mockReturnValue('');

      executeShellCommand('pwd', '/custom/path');

      expect(mockedExecSync).toHaveBeenCalledWith('pwd', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: '/custom/path',
        timeout: 30000
      });
    });

    it('should use custom timeout when specified', () => {
      mockedExecSync.mockReturnValue('');

      executeShellCommand('long-running-command', undefined, 60000);

      expect(mockedExecSync).toHaveBeenCalledWith('long-running-command', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd(),
        timeout: 60000
      });
    });
  });

  describe('isShellCommand', () => {
    let isShellCommand: typeof import('../../src/ui/shellCommand.js').isShellCommand;

    beforeEach(async () => {
      const module = await import('../../src/ui/shellCommand.js');
      isShellCommand = module.isShellCommand;
    });

    it('should return true for input starting with !', () => {
      expect(isShellCommand('!ls')).toBe(true);
      expect(isShellCommand('! git status')).toBe(true);
      expect(isShellCommand('!  pwd')).toBe(true);
    });

    it('should return false for input not starting with !', () => {
      expect(isShellCommand('ls')).toBe(false);
      expect(isShellCommand('/help')).toBe(false);
      expect(isShellCommand('@file.ts')).toBe(false);
      expect(isShellCommand('hello!')).toBe(false);
      expect(isShellCommand('echo "!"')).toBe(false);
    });

    it('should return false for empty input', () => {
      expect(isShellCommand('')).toBe(false);
      expect(isShellCommand('   ')).toBe(false);
    });

    it('should return false for just exclamation mark', () => {
      expect(isShellCommand('!')).toBe(false);
      expect(isShellCommand('!  ')).toBe(false);
    });
  });

  describe('parseShellCommand', () => {
    let parseShellCommand: typeof import('../../src/ui/shellCommand.js').parseShellCommand;

    beforeEach(async () => {
      const module = await import('../../src/ui/shellCommand.js');
      parseShellCommand = module.parseShellCommand;
    });

    it('should extract command from input with ! prefix', () => {
      expect(parseShellCommand('!ls -la')).toBe('ls -la');
      expect(parseShellCommand('! git status')).toBe('git status');
      expect(parseShellCommand('!  pwd  ')).toBe('pwd');
    });

    it('should return empty string for invalid input', () => {
      expect(parseShellCommand('')).toBe('');
      expect(parseShellCommand('!')).toBe('');
      expect(parseShellCommand('!  ')).toBe('');
      expect(parseShellCommand('ls')).toBe('');
    });
  });

  describe('Shell command timeout', () => {
    let executeShellCommand: typeof import('../../src/ui/shellCommand.js').executeShellCommand;

    beforeEach(async () => {
      const module = await import('../../src/ui/shellCommand.js');
      executeShellCommand = module.executeShellCommand;
    });

    it('should default to 30 second timeout', () => {
      mockedExecSync.mockReturnValue('');

      executeShellCommand('test');

      expect(mockedExecSync).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ timeout: 30000 })
      );
    });

    it('should handle timeout error gracefully', () => {
      const error = new Error('ETIMEDOUT') as Error & { code: string };
      error.code = 'ETIMEDOUT';
      mockedExecSync.mockImplementation(() => {
        throw error;
      });

      const result = executeShellCommand('sleep 100');

      expect(result.success).toBe(false);
      expect(result.error).toContain('ETIMEDOUT');
    });
  });
});

describe('Shell Command i18n', () => {
  it('should have commandHint translation with ! for terminal', async () => {
    // Import the English locale to verify the translation exists
    const enLocale = await import('../../src/i18n/locales/en.json');

    expect(enLocale.default.ui.commandHint).toContain('!');
    expect(enLocale.default.ui.commandHint).toContain('terminal');
  });
});
