/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PermissionManager } from '../src/permissions/PermissionManager.js';

// Mock safePrompt
var mockSafePrompt = vi.fn();
vi.mock('../src/utils/prompt.js', () => ({
  safePrompt: (...args: unknown[]) => mockSafePrompt(...args),
}));

vi.mock('chalk', () => ({
  default: {
    bold: { cyan: (s: string) => s, green: (s: string) => s, red: (s: string) => s },
    gray: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
  },
}));

const { permissions, metadata } = await import('../src/commands/permissions.js');

describe('/permissions command', () => {
  let consoleOutput: string[];
  let originalConsoleLog: typeof console.log;

  beforeEach(() => {
    consoleOutput = [];
    originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => {
      consoleOutput.push(args.join(' '));
    };
    vi.clearAllMocks();
    mockSafePrompt.mockResolvedValue(null); // default: user exits
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  describe('metadata', () => {
    it('exports correct command metadata', () => {
      expect(metadata.command).toBe('/permissions');
      expect(metadata.implemented).toBe(true);
    });
  });

  describe('display', () => {
    it('always shows mode and rememberSession even when lists are empty', async () => {
      const manager = new PermissionManager({
        settings: { mode: 'interactive', rememberSession: true },
      });

      await permissions({ permissionManager: manager });

      const output = consoleOutput.join('\n');
      expect(output).toContain('interactive');
      expect(output).toContain('Remember');
    });

    it('shows message when no whitelist/blacklist entries exist', async () => {
      const manager = new PermissionManager({ settings: {} });

      await permissions({ permissionManager: manager });

      const output = consoleOutput.join('\n');
      expect(output).toContain('No saved permissions');
    });

    it('displays whitelist items', async () => {
      const manager = new PermissionManager({
        settings: { whitelist: ['run_command:npm test', 'run_command:npm build'] },
      });

      mockSafePrompt.mockResolvedValueOnce({ action: 'done' });

      await permissions({ permissionManager: manager });

      const output = consoleOutput.join('\n');
      expect(output).toContain('npm test');
      expect(output).toContain('npm build');
    });

    it('displays blacklist items', async () => {
      const manager = new PermissionManager({
        settings: { blacklist: ['run_command:rm -rf *'] },
      });

      mockSafePrompt.mockResolvedValueOnce({ action: 'done' });

      await permissions({ permissionManager: manager });

      const output = consoleOutput.join('\n');
      expect(output).toContain('rm -rf');
    });

    it('shows current mode', async () => {
      const manager = new PermissionManager({
        settings: { mode: 'unrestricted' },
      });

      await permissions({ permissionManager: manager });

      const output = consoleOutput.join('\n');
      expect(output).toContain('unrestricted');
    });
  });

  describe('remove actions', () => {
    it('removes item from whitelist when selected', async () => {
      const onPersist = vi.fn();
      const manager = new PermissionManager({
        settings: { whitelist: ['run_command:npm test', 'run_command:npm build'] },
        onPersist,
      });

      mockSafePrompt
        .mockResolvedValueOnce({ action: 'remove_approved' })
        .mockResolvedValueOnce({ pattern: 'run_command:npm test' });

      await permissions({ permissionManager: manager });

      expect(manager.getWhitelist()).not.toContain('run_command:npm test');
      expect(manager.getWhitelist()).toContain('run_command:npm build');
    });

    it('clears all permissions when confirmed', async () => {
      const onPersist = vi.fn();
      const manager = new PermissionManager({
        settings: {
          whitelist: ['run_command:npm test'],
          blacklist: ['delete_path:important.txt'],
        },
        onPersist,
      });

      mockSafePrompt
        .mockResolvedValueOnce({ action: 'clear_all' })
        .mockResolvedValueOnce({ confirm: true });

      await permissions({ permissionManager: manager });

      expect(manager.getWhitelist()).toHaveLength(0);
      expect(manager.getBlacklist()).toHaveLength(0);
    });
  });
});
