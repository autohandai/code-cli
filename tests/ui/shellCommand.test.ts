/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { isImmediateCommand, isShellCommand, parseShellCommand } from '../src/ui/shellCommand.js';

describe('isImmediateCommand', () => {
  describe('shell commands', () => {
    it('should return true for shell commands starting with !', () => {
      expect(isImmediateCommand('!ls')).toBe(true);
      expect(isImmediateCommand('! git status')).toBe(true);
      expect(isImmediateCommand('  !npm test  ')).toBe(true);
    });

    it('should return false for ! alone', () => {
      expect(isImmediateCommand('!')).toBe(false);
      expect(isImmediateCommand('  !  ')).toBe(false);
    });
  });

  describe('slash commands', () => {
    it('should return true for valid slash commands', () => {
      expect(isImmediateCommand('/help')).toBe(true);
      expect(isImmediateCommand('/model')).toBe(true);
      expect(isImmediateCommand('/quit')).toBe(true);
      expect(isImmediateCommand('  /exit  ')).toBe(true);
    });

    it('should return false for / alone', () => {
      expect(isImmediateCommand('/')).toBe(false);
      expect(isImmediateCommand('  /  ')).toBe(false);
    });
  });

  describe('file paths starting with /', () => {
    it('should return false for macOS screenshot paths', () => {
      // This is the exact format macOS Terminal pastes when you take a screenshot
      expect(isImmediateCommand('/var/folders/t1/2g8dxmj56vqd9qx_f0h1xs7r0000gn/T/TemporaryItems/NSIRD_screencaptureui_tW95AB/Screenshot 2025-01-15 at 10.30.45 AM.png')).toBe(false);
    });

    it('should return false for common Unix path prefixes', () => {
      expect(isImmediateCommand('/Users/igor/test.png')).toBe(false);
      expect(isImmediateCommand('/home/user/file.txt')).toBe(false);
      expect(isImmediateCommand('/tmp/screenshot.png')).toBe(false);
      expect(isImmediateCommand('/var/log/app.log')).toBe(false);
      expect(isImmediateCommand('/opt/homebrew/bin/node')).toBe(false);
      expect(isImmediateCommand('/etc/hosts')).toBe(false);
      expect(isImmediateCommand('/usr/local/bin/bun')).toBe(false);
    });

    it('should return false for paths with file extensions', () => {
      expect(isImmediateCommand('/path/to/file.png')).toBe(false);
      expect(isImmediateCommand('/path/to/file.jpg')).toBe(false);
      expect(isImmediateCommand('/path/to/file.txt')).toBe(false);
      expect(isImmediateCommand('/path/to/file.md')).toBe(false);
    });

    it('should return false for paths with nested slashes', () => {
      expect(isImmediateCommand('/a/b/c')).toBe(false);
      expect(isImmediateCommand('/some/nested/path')).toBe(false);
    });
  });

  describe('regular text', () => {
    it('should return false for regular text', () => {
      expect(isImmediateCommand('hello world')).toBe(false);
      expect(isImmediateCommand('fix the bug')).toBe(false);
      expect(isImmediateCommand('')).toBe(false);
      expect(isImmediateCommand('   ')).toBe(false);
    });
  });
});

describe('isShellCommand', () => {
  it('should return true for shell commands', () => {
    expect(isShellCommand('!ls')).toBe(true);
    expect(isShellCommand('!git status')).toBe(true);
  });

  it('should return false for non-shell commands', () => {
    expect(isShellCommand('ls')).toBe(false);
    expect(isShellCommand('/help')).toBe(false);
    expect(isShellCommand('!')).toBe(false);
  });
});

describe('parseShellCommand', () => {
  it('should parse shell commands correctly', () => {
    expect(parseShellCommand('!ls')).toBe('ls');
    expect(parseShellCommand('!git status')).toBe('git status');
    expect(parseShellCommand('  !npm test  ')).toBe('npm test');
  });

  it('should return empty string for non-shell commands', () => {
    expect(parseShellCommand('ls')).toBe('');
    expect(parseShellCommand('/help')).toBe('');
  });
});