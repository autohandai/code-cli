/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { EventEmitter } from 'node:events';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mock child_process
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn()
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
  const mockedSpawn = spawn as Mock;

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

  describe('executeShellCommandAsync', () => {
    let executeShellCommandAsync: typeof import('../../src/ui/shellCommand.js').executeShellCommandAsync;

    beforeEach(async () => {
      const module = await import('../../src/ui/shellCommand.js');
      executeShellCommandAsync = module.executeShellCommandAsync;
    });

    it('should execute asynchronously and return stdout', async () => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: Mock;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();

      mockedSpawn.mockReturnValue(child);

      const promise = executeShellCommandAsync('ls -la');
      child.stdout.emit('data', Buffer.from('async output\n'));
      child.emit('close', 0, null);

      const result = await promise;

      expect(mockedSpawn).toHaveBeenCalledWith('ls -la', {
        cwd: process.cwd(),
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      expect(result).toEqual({ success: true, output: 'async output\n' });
    });

    it('should return stderr when async command fails', async () => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: Mock;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();

      mockedSpawn.mockReturnValue(child);

      const promise = executeShellCommandAsync('npx serve .');
      child.stderr.emit('data', Buffer.from('serve failed'));
      child.emit('close', 1, null);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('serve failed');
    });

    it('streams stdout and stderr chunks while the command is running', async () => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: Mock;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();

      mockedSpawn.mockReturnValue(child);

      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      const promise = executeShellCommandAsync('bun run proof', undefined, undefined, {
        onStdout: (chunk) => stdoutChunks.push(chunk),
        onStderr: (chunk) => stderrChunks.push(chunk),
      });

      child.stdout.emit('data', Buffer.from('step 1\n'));
      child.stderr.emit('data', Buffer.from('warn\n'));
      child.stdout.emit('data', Buffer.from('step 2\n'));
      child.emit('close', 0, null);

      const result = await promise;

      expect(stdoutChunks).toEqual(['step 1\n', 'step 2\n']);
      expect(stderrChunks).toEqual(['warn\n']);
      expect(result).toEqual({ success: true, output: 'step 1\nstep 2\n' });
    });
  });

  describe('executeInteractiveShellCommand', () => {
    let executeInteractiveShellCommand: typeof import('../../src/ui/shellCommand.js').executeInteractiveShellCommand;

    beforeEach(async () => {
      const module = await import('../../src/ui/shellCommand.js');
      executeInteractiveShellCommand = module.executeInteractiveShellCommand;
    });

    it('runs with inherited stdio for interactive terminal handoff', async () => {
      const child = new EventEmitter() as EventEmitter & {
        once: EventEmitter['once'];
      };
      mockedSpawn.mockReturnValue(child);

      const promise = executeInteractiveShellCommand('bun run typecheck');
      child.emit('close', 0, null);

      const result = await promise;

      expect(mockedSpawn).toHaveBeenCalledWith('bun run typecheck', {
        cwd: process.cwd(),
        shell: true,
        stdio: 'inherit',
      });
      expect(result).toEqual({ success: true, output: '' });
    });

    it('returns non-zero exit codes as errors', async () => {
      const child = new EventEmitter();
      mockedSpawn.mockReturnValue(child);

      const promise = executeInteractiveShellCommand('bun run lint');
      child.emit('close', 2, null);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Command failed with exit code 2');
    });
  });

  describe('executeStreamingShellCommand', () => {
    let shellCommandModule: typeof import('../../src/ui/shellCommand.js');
    const originalStdoutIsTTY = process.stdout.isTTY;
    const originalStdinIsTTY = process.stdin.isTTY;

    beforeEach(async () => {
      shellCommandModule = await import('../../src/ui/shellCommand.js');
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    });

    afterEach(() => {
      shellCommandModule.setNodePtyLoaderForTests();
      Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true });
    });

    it('prefers a PTY when available and streams PTY output', async () => {
      let dataHandler: ((data: string) => void) | undefined;
      let exitHandler: ((event: { exitCode: number }) => void) | undefined;
      const ptyProcess = {
        onData: (handler: (data: string) => void) => {
          dataHandler = handler;
          return { dispose: vi.fn() };
        },
        onExit: (handler: (event: { exitCode: number }) => void) => {
          exitHandler = handler;
          return { dispose: vi.fn() };
        },
        kill: vi.fn(),
      };

      const loadSpy = vi.fn().mockResolvedValue({
        spawn: vi.fn().mockReturnValue(ptyProcess),
      } as any);
      shellCommandModule.setNodePtyLoaderForTests(loadSpy);

      const promise = shellCommandModule.executeStreamingShellCommand('bun run proof', process.cwd(), {
        onStdout: vi.fn(),
        onStderr: vi.fn(),
        preferPty: true,
        columns: 120,
        rows: 40,
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      dataHandler?.('line 1\r\nline 2\r\n');
      exitHandler?.({ exitCode: 0 });

      const result = await promise;

      expect(loadSpy).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.output).toContain('line 1');
      expect(result.output).toContain('line 2');
    });

    it('falls back to async shell execution when PTY is unavailable', async () => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: Mock;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();

      mockedSpawn.mockReturnValue(child);

      const loadSpy = vi.fn().mockResolvedValue(null);
      shellCommandModule.setNodePtyLoaderForTests(loadSpy);

      const promise = shellCommandModule.executeStreamingShellCommand('bun run lint', process.cwd(), {
        preferPty: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      child.stdout.emit('data', Buffer.from('fallback\n'));
      child.emit('close', 0, null);

      const result = await promise;

      expect(loadSpy).toHaveBeenCalledTimes(1);
      expect(mockedSpawn).toHaveBeenCalled();
      expect(result).toEqual({ success: true, output: 'fallback\n' });
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

  describe('shell suggestions', () => {
    let getPrimaryShellCommandSuggestion: typeof import('../../src/ui/shellCommand.js').getPrimaryShellCommandSuggestion;

    beforeEach(async () => {
      const module = await import('../../src/ui/shellCommand.js');
      getPrimaryShellCommandSuggestion = module.getPrimaryShellCommandSuggestion;
    });

    it('treats trailing space as next-argument context', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autohand-shell-suggest-'));
      fs.writeFileSync(path.join(tempDir, 'source.txt'), 'x');
      fs.mkdirSync(path.join(tempDir, 'dest-dir'), { recursive: true });

      const suggestion = getPrimaryShellCommandSuggestion('! cp source.txt ', { cwd: tempDir });
      expect(suggestion).toContain('! cp source.txt');
      expect(suggestion).toContain('dest-dir/');

      fs.rmSync(tempDir, { recursive: true, force: true });
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
