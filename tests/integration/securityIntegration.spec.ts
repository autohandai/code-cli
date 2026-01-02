/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Security Integration Tests - Verifies security layers work together
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PermissionManager, DEFAULT_SECURITY_BLACKLIST } from '../../src/permissions/PermissionManager.js';
import { FileActionManager, FILE_LIMITS } from '../../src/actions/filesystem.js';
import { GIT_SAFETY } from '../../src/actions/git.js';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';

describe('Security Integration', () => {
  let testDir: string;
  let fileManager: FileActionManager;
  let permissionManager: PermissionManager;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-integration-'));
    fileManager = new FileActionManager(testDir);
    permissionManager = new PermissionManager({
      settings: { mode: 'interactive' },
      workspaceRoot: testDir
    });
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  describe('Permission + Filesystem layer interaction', () => {
    it('should have security blacklist check files that filesystem would read', () => {
      // Verify the permission layer would block .env before filesystem reads it
      const result = permissionManager.checkPermission({
        tool: 'read_file',
        path: '.env'
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('blacklisted');
    });

    it('should allow reading normal files through both layers', async () => {
      // First check permission
      const permResult = permissionManager.checkPermission({
        tool: 'read_file',
        path: 'normal.txt'
      });

      // In interactive mode, it should ask (not blacklisted, not whitelisted)
      expect(permResult.reason).not.toBe('blacklisted');

      // Then verify filesystem can read
      await fs.writeFile(path.join(testDir, 'normal.txt'), 'content');
      const content = await fileManager.readFile('normal.txt');
      expect(content).toBe('content');
    });

    it('should protect sensitive files at permission layer before filesystem', () => {
      const sensitiveFiles = [
        '.env',
        '.env.local',
        '.git/config',
        'keys/server.key',
        'certs/cert.pem'
      ];

      for (const file of sensitiveFiles) {
        const result = permissionManager.checkPermission({
          tool: 'read_file',
          path: file
        });

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('blacklisted');
      }
    });
  });

  describe('Git safety + Permission layer interaction', () => {
    it('should have GIT_SAFETY constants aligned with permission patterns', () => {
      // Verify protected branches are defined
      expect(GIT_SAFETY.PROTECTED_BRANCHES).toContain('main');
      expect(GIT_SAFETY.PROTECTED_BRANCHES).toContain('master');

      // Verify git config is in security blacklist
      expect(DEFAULT_SECURITY_BLACKLIST).toContain('read_file:.git/config');
      expect(DEFAULT_SECURITY_BLACKLIST).toContain('write_file:.git/config');
    });

    it('should block dangerous git commands at permission layer', () => {
      const dangerousCommands = [
        { command: 'sudo', args: ['git', 'push', '--force'] },
        { command: 'rm', args: ['-rf', '/'] }
      ];

      for (const cmd of dangerousCommands) {
        const result = permissionManager.checkPermission({
          tool: 'run_command',
          ...cmd
        });

        expect(result.allowed).toBe(false);
      }
    });
  });

  describe('Resource limits across layers', () => {
    it('should enforce FILE_LIMITS for filesystem operations', () => {
      expect(FILE_LIMITS.MAX_READ_SIZE).toBe(10 * 1024 * 1024);
      expect(FILE_LIMITS.MAX_WRITE_SIZE).toBe(50 * 1024 * 1024);
      expect(FILE_LIMITS.MAX_SEARCH_RESULTS).toBe(1000);
    });

    it('should enforce GIT_SAFETY limits', () => {
      expect(GIT_SAFETY.MAX_COMMITS_PER_PUSH).toBe(50);
    });
  });

  describe('Security blacklist immutability', () => {
    it('should not allow bypassing blacklist with unrestricted mode', () => {
      const unrestrictedManager = new PermissionManager({
        settings: { mode: 'unrestricted' }
      });

      const result = unrestrictedManager.checkPermission({
        tool: 'read_file',
        path: '.env'
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('blacklisted');
    });

    it('should not allow bypassing blacklist with whitelist', () => {
      const whitelistManager = new PermissionManager({
        settings: {
          whitelist: ['read_file:.env', 'read_file:*']
        }
      });

      const result = whitelistManager.checkPermission({
        tool: 'read_file',
        path: '.env'
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('blacklisted');
    });
  });

  describe('Path traversal protection', () => {
    it('should block path traversal at filesystem layer', async () => {
      await expect(
        fileManager.readFile('../../../etc/passwd')
      ).rejects.toThrow(/escapes the workspace root/);
    });

    it('should block absolute paths outside workspace', async () => {
      await expect(
        fileManager.readFile('/etc/shadow')
      ).rejects.toThrow(/escapes the workspace root/);
    });
  });

  describe('Defense in depth', () => {
    it('should have multiple layers of protection for SSH keys', () => {
      // Layer 1: Permission blacklist
      const permResult = permissionManager.checkPermission({
        tool: 'read_file',
        path: '/home/user/.ssh/id_rsa'
      });
      expect(permResult.allowed).toBe(false);

      // Layer 2: Pattern variety in blacklist
      expect(DEFAULT_SECURITY_BLACKLIST).toContain('read_file:*/.ssh/*');
      expect(DEFAULT_SECURITY_BLACKLIST).toContain('read_file:*/id_rsa*');
    });

    it('should have multiple layers of protection for cloud credentials', () => {
      // Check AWS
      expect(DEFAULT_SECURITY_BLACKLIST).toContain('read_file:*/.aws/credentials');
      expect(DEFAULT_SECURITY_BLACKLIST).toContain('read_file:*/.aws/config');

      // Verify permission check
      const awsResult = permissionManager.checkPermission({
        tool: 'read_file',
        path: '/home/user/.aws/credentials'
      });
      expect(awsResult.allowed).toBe(false);
    });

    it('should protect environment variables through multiple patterns', () => {
      const envPatterns = [
        'run_command:printenv',
        'run_command:printenv *',
        'run_command:env',
        'run_command:export',
        'run_command:set'
      ];

      for (const pattern of envPatterns) {
        expect(DEFAULT_SECURITY_BLACKLIST).toContain(pattern);
      }
    });
  });

  describe('Error message safety', () => {
    it('should not leak sensitive paths in filesystem errors', async () => {
      try {
        await fileManager.readFile('nonexistent.txt');
      } catch (e: any) {
        // Error should not contain absolute system paths
        expect(e.message).not.toContain('/etc/');
        expect(e.message).not.toContain('/root/');
      }
    });

    it('should sanitize workspace path in error messages', async () => {
      try {
        await fileManager.readFile('../outside.txt');
      } catch (e: any) {
        // Error should mention workspace root, not expose full path
        expect(e.message).toContain('escapes the workspace root');
      }
    });
  });
});
