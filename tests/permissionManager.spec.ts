/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { PermissionManager } from '../src/permissions/PermissionManager.js';

describe('PermissionManager', () => {
  let tempWorkspaceRoot: string;

  beforeEach(async () => {
    tempWorkspaceRoot = path.join(
      os.tmpdir(),
      `autohand-permissions-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await fs.ensureDir(tempWorkspaceRoot);
  });

  afterEach(async () => {
    await fs.remove(tempWorkspaceRoot);
  });

  describe('basic permission checks', () => {
    it('allows allowList patterns', () => {
      const manager = new PermissionManager({
        settings: {
          allowList: ['run_command:npm install']
        }
      });

      const result = manager.checkPermission({
        tool: 'run_command',
        command: 'npm',
        args: ['install']
      });

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('allow_list');
    });

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
      expect(result.reason).toBe('allow_list');
    });

    it('denies denyList patterns', () => {
      const manager = new PermissionManager({
        settings: {
          denyList: ['run_command:rm -rf *']
        }
      });

      const result = manager.checkPermission({
        tool: 'run_command',
        command: 'rm',
        args: ['-rf', '*']
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('deny_list');
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
      expect(result.reason).toBe('deny_list');
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
    it('adds approved commands to the allowList', async () => {
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

      expect(manager.getAllowList()).toContain('run_command:npm install');
      expect(onPersist).toHaveBeenCalled();
    });

    it('adds denied commands to the denyList', async () => {
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

      expect(manager.getDenyList()).toContain('run_command:rm -rf /');
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
          allowList: expect.arrayContaining(['write_file:test.txt'])
        })
      );
    });

    it('removes items from the allowList', async () => {
      const onPersist = vi.fn();
      const manager = new PermissionManager({
        settings: {
          allowList: ['run_command:npm test', 'run_command:npm build']
        },
        onPersist
      });

      const removed = await manager.removeFromAllowList('run_command:npm test');

      expect(removed).toBe(true);
      expect(manager.getAllowList()).not.toContain('run_command:npm test');
      expect(manager.getAllowList()).toContain('run_command:npm build');
      expect(onPersist).toHaveBeenCalled();
    });

    it('removes items from the denyList', async () => {
      const onPersist = vi.fn();
      const manager = new PermissionManager({
        settings: {
          denyList: ['run_command:rm -rf *']
        },
        onPersist
      });

      const removed = await manager.removeFromDenyList('run_command:rm -rf *');

      expect(removed).toBe(true);
      expect(manager.getDenyList()).not.toContain('run_command:rm -rf *');
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

    it('matches workspace-relative subdirectory patterns like src/core/*', () => {
      const manager = new PermissionManager({
        settings: {
          allowList: ['write_file:src/core/*']
        },
        workspaceRoot: '/project'
      });

      // Should match files in src/core/
      const result = manager.checkPermission({
        tool: 'write_file',
        path: 'src/core/agent.ts'
      });

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('allow_list');
    });

    it('matches nested subdirectory patterns like src/core/utils/*', () => {
      const manager = new PermissionManager({
        settings: {
          allowList: ['write_file:src/core/utils/*']
        },
        workspaceRoot: '/project'
      });

      const result = manager.checkPermission({
        tool: 'write_file',
        path: 'src/core/utils/helpers.ts'
      });

      expect(result.allowed).toBe(true);
    });

    it('does NOT match files outside the subdirectory pattern', () => {
      const manager = new PermissionManager({
        settings: {
          allowList: ['write_file:src/core/*']
        },
        workspaceRoot: '/project'
      });

      // Should NOT match files in src/other/
      const result = manager.checkPermission({
        tool: 'write_file',
        path: 'src/other/file.ts'
      });

      expect(result.allowed).toBe(false);
    });
  });

  describe('directory trust — approve once for a directory', () => {
    it('approving a file write also whitelists the parent directory', async () => {
      const onPersist = vi.fn();
      const manager = new PermissionManager({
        settings: {},
        onPersist,
      });

      // User approves writing tests/foo.test.ts
      await manager.recordDecision(
        { tool: 'write_file', path: '/project/tests/foo.test.ts' },
        true,
      );

      // Now a different file in the same directory should be auto-approved
      const result = manager.checkPermission({
        tool: 'write_file',
        path: '/project/tests/bar.test.ts',
      });

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('allow_list');
    });

    it('directory trust does NOT extend to parent directories', async () => {
      const manager = new PermissionManager({ settings: {} });

      await manager.recordDecision(
        { tool: 'write_file', path: '/project/tests/unit/foo.test.ts' },
        true,
      );

      // Sibling directory should NOT be auto-approved
      const result = manager.checkPermission({
        tool: 'write_file',
        path: '/project/src/index.ts',
      });

      expect(result.allowed).toBe(false);
    });

    it('directory trust does NOT apply to denied decisions', async () => {
      const manager = new PermissionManager({ settings: {} });

      await manager.recordDecision(
        { tool: 'write_file', path: '/project/tests/foo.test.ts' },
        false,
      );

      // Same directory, different file — should NOT be auto-denied at directory level
      // (only the exact file is blacklisted)
      const result = manager.checkPermission({
        tool: 'write_file',
        path: '/project/tests/bar.test.ts',
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('default'); // Not blacklisted, just not whitelisted
    });

    it('directory trust does NOT apply to command-based tools', async () => {
      const manager = new PermissionManager({ settings: {} });

      await manager.recordDecision(
        { tool: 'run_command', command: 'npm', args: ['test'] },
        true,
      );

      // Different npm command should NOT be auto-approved via directory wildcard
      const result = manager.checkPermission({
        tool: 'run_command',
        command: 'npm',
        args: ['install', 'malicious-pkg'],
      });

      // Exact match fails because args differ — should fall through to default
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('default');
    });

    it('directory trust scopes to the same tool type', async () => {
      const manager = new PermissionManager({ settings: {} });

      await manager.recordDecision(
        { tool: 'write_file', path: '/project/tests/foo.test.ts' },
        true,
      );

      // delete_path in the same directory should NOT be auto-approved
      const result = manager.checkPermission({
        tool: 'delete_path',
        path: '/project/tests/bar.test.ts',
      });

      expect(result.allowed).toBe(false);
    });
  });

  describe('getters', () => {
    it('returns copy of allowList', () => {
      const manager = new PermissionManager({
        settings: {
          allowList: ['run_command:npm test']
        }
      });

      const allowList = manager.getAllowList();
      allowList.push('something');

      expect(manager.getAllowList()).toEqual(['run_command:npm test']);
    });

    it('returns copy of denyList', () => {
      const manager = new PermissionManager({
        settings: {
          denyList: ['run_command:rm -rf *']
        }
      });

      const denyList = manager.getDenyList();
      denyList.push('something');

      expect(manager.getDenyList()).toEqual(['run_command:rm -rf *']);
    });

    it('returns copy of whitelist', () => {
      const manager = new PermissionManager({
        settings: {
          allowList: ['run_command:npm test']
        }
      });

      const whitelist = manager.getWhitelist();
      whitelist.push('something');

      expect(manager.getWhitelist()).toEqual(['run_command:npm test']);
    });

    it('returns copy of blacklist', () => {
      const manager = new PermissionManager({
        settings: {
          denyList: ['run_command:rm -rf *']
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
          allowList: ['test']
        }
      });

      const settings = manager.getSettings();
      expect(settings.mode).toBe('interactive');
      expect(settings.allowList).toContain('test');
      settings.allowList?.push('other');

      const fresh = manager.getSettings();
      expect(fresh.mode).toBe('interactive');
      expect(fresh.allowList).toEqual(['test']);
    });
  });

  describe('structured prompt decisions', () => {
    it('stores allow-once decisions in the project session permission file', async () => {
      const manager = new PermissionManager({
        settings: {},
        workspaceRoot: tempWorkspaceRoot,
      });

      await manager.initLocalSettings();
      await manager.applyPromptDecision(
        { tool: 'run_command', command: 'git status' },
        { decision: 'allow_session' },
      );

      const reloaded = new PermissionManager({
        settings: {},
        workspaceRoot: tempWorkspaceRoot,
      });
      await reloaded.initLocalSettings();

      const result = reloaded.checkPermission({
        tool: 'run_command',
        command: 'git status',
      });

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('session_allow_list');
    });

    it('stores project-scoped persistent approvals in settings.local.json', async () => {
      const onPersist = vi.fn();
      const manager = new PermissionManager({
        settings: {},
        workspaceRoot: tempWorkspaceRoot,
        onPersist,
      });

      await manager.initLocalSettings();
      await manager.applyPromptDecision(
        { tool: 'write_file', path: '/project/src/example.ts' },
        { decision: 'allow_always_project' },
      );

      expect(manager.getAllowList()).toHaveLength(0);
      expect(onPersist).not.toHaveBeenCalled();

      const reloaded = new PermissionManager({
        settings: {},
        workspaceRoot: tempWorkspaceRoot,
      });
      await reloaded.initLocalSettings();

      const result = reloaded.checkPermission({
        tool: 'write_file',
        path: '/project/src/example.ts',
      });

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('project_allow_list');
    });

    it('stores user-scoped persistent denials in the denyList', async () => {
      const onPersist = vi.fn();
      const manager = new PermissionManager({
        settings: {},
        workspaceRoot: tempWorkspaceRoot,
        onPersist,
      });

      await manager.applyPromptDecision(
        { tool: 'run_command', command: 'npm publish' },
        { decision: 'deny_always_user' },
      );

      expect(manager.getDenyList()).toContain('run_command:npm publish');
      expect(onPersist).toHaveBeenCalledWith(
        expect.objectContaining({
          denyList: expect.arrayContaining(['run_command:npm publish']),
        })
      );
    });

    it('returns a permission snapshot grouped by session, project, user, and effective scopes', async () => {
      const manager = new PermissionManager({
        settings: {
          allowList: ['run_command:npm test'],
          denyList: ['run_command:npm publish'],
        },
        workspaceRoot: tempWorkspaceRoot,
      });

      await manager.initLocalSettings();
      await manager.applyPromptDecision(
        { tool: 'run_command', command: 'git status' },
        { decision: 'allow_session' },
      );

      const snapshot = manager.getPermissionSnapshot('/tmp/config.json');

      expect(snapshot.user.path).toBe('/tmp/config.json');
      expect(snapshot.user.allowList).toContain('run_command:npm test');
      expect(snapshot.session.allowList).toContain('run_command:git status');
      expect(snapshot.project.path).toContain('.autohand/settings.local.json');
      expect(snapshot.effective.allowList).toEqual(
        expect.arrayContaining(['run_command:npm test', 'run_command:git status'])
      );
    });
  });
});
