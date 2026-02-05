/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi } from 'vitest';
import { PermissionManager } from '../src/permissions/PermissionManager.js';

describe('PermissionManager', () => {
  describe('basic permission checks', () => {
    it('allows whitelisted patterns', () => {
      const manager = new PermissionManager({
        settings: {
          whitelist: ['run_command:npm install']
        }
      });

      const result = manager.checkPermission({
        tool: 'run_command',
        command: 'npm',
        args: ['install']
      });

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('whitelisted');
    });

    it('denies blacklisted patterns', () => {
      const manager = new PermissionManager({
        settings: {
          blacklist: ['run_command:rm -rf *']
        }
      });

      const result = manager.checkPermission({
        tool: 'run_command',
        command: 'rm',
        args: ['-rf', '*']
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('blacklisted');
    });

    it('returns default for unknown commands in interactive mode', () => {
      const manager = new PermissionManager({
        settings: { mode: 'interactive' }
      });

      const result = manager.checkPermission({
        tool: 'run_command',
        command: 'echo',
        args: ['hello']
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('default');
    });

    it('allows everything in unrestricted mode', () => {
      const manager = new PermissionManager({
        settings: { mode: 'unrestricted' }
      });

      const result = manager.checkPermission({
        tool: 'delete_path',
        path: '/important/file'
      });

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('mode_unrestricted');
    });

    it('denies everything in restricted mode', () => {
      const manager = new PermissionManager({
        settings: { mode: 'restricted' }
      });

      const result = manager.checkPermission({
        tool: 'run_command',
        command: 'ls'
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('mode_restricted');
    });
  });

  describe('session caching', () => {
    it('caches approved decisions in session', async () => {
      const manager = new PermissionManager({
        settings: { rememberSession: true }
      });

      const context = {
        tool: 'run_command',
        command: 'npm',
        args: ['test']
      };

      await manager.recordDecision(context, true);

      const result = manager.checkPermission(context);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('user_approved');
      expect(result.cached).toBe(true);
    });

    it('caches denied decisions in session', async () => {
      const manager = new PermissionManager({
        settings: { rememberSession: true }
      });

      const context = {
        tool: 'delete_path',
        path: 'important.txt'
      };

      await manager.recordDecision(context, false);

      const result = manager.checkPermission(context);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('user_denied');
      expect(result.cached).toBe(true);
    });
  });

  describe('persistent permissions', () => {
    it('adds approved commands to whitelist', async () => {
      const onPersist = vi.fn();
      const manager = new PermissionManager({
        settings: {},
        onPersist
      });

      await manager.recordDecision({
        tool: 'run_command',
        command: 'npm',
        args: ['install']
      }, true);

      expect(manager.getWhitelist()).toContain('run_command:npm install');
      expect(onPersist).toHaveBeenCalled();
    });

    it('adds denied commands to blacklist', async () => {
      const onPersist = vi.fn();
      const manager = new PermissionManager({
        settings: {},
        onPersist
      });

      await manager.recordDecision({
        tool: 'run_command',
        command: 'rm',
        args: ['-rf', '/']
      }, false);

      expect(manager.getBlacklist()).toContain('run_command:rm -rf /');
      expect(onPersist).toHaveBeenCalled();
    });

    it('calls onPersist callback when recording decisions', async () => {
      const onPersist = vi.fn();
      const manager = new PermissionManager({
        settings: {},
        onPersist
      });

      await manager.recordDecision({
        tool: 'write_file',
        path: 'test.txt'
      }, true);

      expect(onPersist).toHaveBeenCalledWith(
        expect.objectContaining({
          whitelist: expect.arrayContaining(['write_file:test.txt'])
        })
      );
    });

    it('removes items from whitelist', async () => {
      const onPersist = vi.fn();
      const manager = new PermissionManager({
        settings: {
          whitelist: ['run_command:npm test', 'run_command:npm build']
        },
        onPersist
      });

      const removed = await manager.removeFromWhitelist('run_command:npm test');

      expect(removed).toBe(true);
      expect(manager.getWhitelist()).not.toContain('run_command:npm test');
      expect(manager.getWhitelist()).toContain('run_command:npm build');
      expect(onPersist).toHaveBeenCalled();
    });

    it('removes items from blacklist', async () => {
      const onPersist = vi.fn();
      const manager = new PermissionManager({
        settings: {
          blacklist: ['run_command:rm -rf *']
        },
        onPersist
      });

      const removed = await manager.removeFromBlacklist('run_command:rm -rf *');

      expect(removed).toBe(true);
      expect(manager.getBlacklist()).not.toContain('run_command:rm -rf *');
      expect(onPersist).toHaveBeenCalled();
    });
  });

  describe('pattern matching', () => {
    it('matches wildcard patterns', () => {
      const manager = new PermissionManager({
        settings: {
          whitelist: ['run_command:npm *']
        }
      });

      const result = manager.checkPermission({
        tool: 'run_command',
        command: 'npm',
        args: ['install', 'lodash']
      });

      expect(result.allowed).toBe(true);
    });

    it('handles path-based tools', () => {
      const manager = new PermissionManager({
        settings: {
          whitelist: ['delete_path:*.tmp']
        }
      });

      const result = manager.checkPermission({
        tool: 'delete_path',
        path: 'cache.tmp'
      });

      expect(result.allowed).toBe(true);
    });
  });

  describe('getters', () => {
    it('returns copy of whitelist', () => {
      const manager = new PermissionManager({
        settings: {
          whitelist: ['run_command:npm test']
        }
      });

      const whitelist = manager.getWhitelist();
      whitelist.push('something');

      expect(manager.getWhitelist()).toEqual(['run_command:npm test']);
    });

    it('returns copy of blacklist', () => {
      const manager = new PermissionManager({
        settings: {
          blacklist: ['run_command:rm -rf *']
        }
      });

      const blacklist = manager.getBlacklist();
      blacklist.push('something');

      expect(manager.getBlacklist()).toEqual(['run_command:rm -rf *']);
    });

    it('returns settings copy', () => {
      const manager = new PermissionManager({
        settings: {
          mode: 'interactive',
          whitelist: ['test']
        }
      });

      const settings = manager.getSettings();
      expect(settings.mode).toBe('interactive');
      expect(settings.whitelist).toContain('test');
    });
  });
});
