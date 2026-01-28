/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PermissionManager } from '../src/permissions/PermissionManager.js';
import { permissions, metadata } from '../src/commands/permissions.js';

// Hoist mocks to avoid initialization errors
const { mockShowModal, mockShowInput, mockShowConfirm } = vi.hoisted(() => ({
  mockShowModal: vi.fn(),
  mockShowInput: vi.fn(),
  mockShowConfirm: vi.fn()
}));

// Mock Modal components to avoid interactive prompts in tests
vi.mock('../src/ui/ink/components/Modal.js', () => ({
  showModal: mockShowModal,
  showInput: mockShowInput,
  showConfirm: mockShowConfirm
}));

// Mock chalk to capture output
vi.mock('chalk', () => ({
  default: {
    bold: {
      cyan: (s: string) => s,
      green: (s: string) => s,
      red: (s: string) => s
    },
    gray: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s
  }
}));

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
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  describe('metadata', () => {
    it('exports correct command metadata', () => {
      expect(metadata.command).toBe('/permissions');
      expect(metadata.description).toContain('tool/command approvals');
      expect(metadata.implemented).toBe(true);
    });
  });

  describe('display', () => {
    it('shows message when no permissions exist', async () => {
      const manager = new PermissionManager({ settings: {} });

      mockShowModal.mockResolvedValue({ value: 'done' });

      await permissions({ permissionManager: manager });

      const output = consoleOutput.join('\n');
      expect(output).toContain('No saved permissions yet');
    });

    it('displays whitelist items', async () => {
      const manager = new PermissionManager({
        settings: {
          whitelist: ['run_command:npm test', 'run_command:npm build']
        }
      });

      mockShowModal.mockResolvedValue({ value: 'done' });

      await permissions({ permissionManager: manager });

      const output = consoleOutput.join('\n');
      expect(output).toContain('Approved (Whitelist)');
      expect(output).toContain('npm test');
      expect(output).toContain('npm build');
    });

    it('displays blacklist items', async () => {
      const manager = new PermissionManager({
        settings: {
          blacklist: ['run_command:rm -rf *']
        }
      });

      mockShowModal.mockResolvedValue({ value: 'done' });

      await permissions({ permissionManager: manager });

      const output = consoleOutput.join('\n');
      expect(output).toContain('Denied (Blacklist)');
      expect(output).toContain('rm -rf');
    });

    it('displays both whitelist and blacklist', async () => {
      const manager = new PermissionManager({
        settings: {
          whitelist: ['run_command:npm install'],
          blacklist: ['delete_path:important.txt']
        }
      });

      mockShowModal.mockResolvedValue({ value: 'done' });

      await permissions({ permissionManager: manager });

      const output = consoleOutput.join('\n');
      expect(output).toContain('Approved (Whitelist)');
      expect(output).toContain('npm install');
      expect(output).toContain('Denied (Blacklist)');
      expect(output).toContain('important.txt');
      expect(output).toContain('Total: 1 approved, 1 denied');
    });

    it('shows current mode', async () => {
      const manager = new PermissionManager({
        settings: { mode: 'unrestricted' }
      });

      mockShowModal.mockResolvedValue({ value: 'done' });

      await permissions({ permissionManager: manager });

      const output = consoleOutput.join('\n');
      expect(output).toContain('Mode: unrestricted');
    });
  });

  describe('remove actions', () => {
    it('removes item from whitelist when selected', async () => {
      const onPersist = vi.fn();
      const manager = new PermissionManager({
        settings: {
          whitelist: ['run_command:npm test', 'run_command:npm build']
        },
        onPersist
      });

      // Mock user selecting remove_approved, then selecting the pattern
      mockShowModal
        .mockResolvedValueOnce({ value: 'remove_approved' })
        .mockResolvedValueOnce({ value: 'run_command:npm test' });

      await permissions({ permissionManager: manager });

      expect(manager.getWhitelist()).not.toContain('run_command:npm test');
      expect(manager.getWhitelist()).toContain('run_command:npm build');
      expect(onPersist).toHaveBeenCalled();
    });

    it('removes item from blacklist when selected', async () => {
      const onPersist = vi.fn();
      const manager = new PermissionManager({
        settings: {
          blacklist: ['run_command:rm -rf *']
        },
        onPersist
      });

      mockShowModal
        .mockResolvedValueOnce({ value: 'remove_denied' })
        .mockResolvedValueOnce({ value: 'run_command:rm -rf *' });

      await permissions({ permissionManager: manager });

      expect(manager.getBlacklist()).not.toContain('run_command:rm -rf *');
      expect(onPersist).toHaveBeenCalled();
    });
  });

  describe('clear all', () => {
    it('clears all permissions when confirmed', async () => {
      const onPersist = vi.fn();
      const manager = new PermissionManager({
        settings: {
          whitelist: ['run_command:npm test'],
          blacklist: ['run_command:rm -rf *']
        },
        onPersist
      });

      mockShowModal.mockResolvedValueOnce({ value: 'clear_all' });
      mockShowConfirm.mockResolvedValueOnce(true);

      await permissions({ permissionManager: manager });

      expect(manager.getWhitelist()).toEqual([]);
      expect(manager.getBlacklist()).toEqual([]);
    });

    it('does not clear when not confirmed', async () => {
      const manager = new PermissionManager({
        settings: {
          whitelist: ['run_command:npm test'],
          blacklist: ['run_command:rm -rf *']
        }
      });

      mockShowModal.mockResolvedValueOnce({ value: 'clear_all' });
      mockShowConfirm.mockResolvedValueOnce(false);

      await permissions({ permissionManager: manager });

      expect(manager.getWhitelist()).toContain('run_command:npm test');
      expect(manager.getBlacklist()).toContain('run_command:rm -rf *');
    });
  });

  describe('done action', () => {
    it('returns null when done is selected', async () => {
      const manager = new PermissionManager({
        settings: {
          whitelist: ['run_command:npm test']
        }
      });

      mockShowModal.mockResolvedValue({ value: 'done' });

      const result = await permissions({ permissionManager: manager });

      expect(result).toBeNull();
    });
  });
});
