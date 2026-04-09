/**
 * Tests for prefix pattern functionality in PermissionManager
 * @license Apache-2.0
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PermissionManager } from '../../src/permissions/PermissionManager.js';
import type { PermissionContext } from '../../src/permissions/types.js';

describe('PermissionManager Prefix Patterns', () => {
  let permissionManager: PermissionManager;
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = '/Users/test/project';
    permissionManager = new PermissionManager({
      settings: {
        mode: 'interactive',
        allowList: [],
        denyList: [],
      },
      workspaceRoot,
    });
  });

  describe('Pattern Creation Utilities', () => {
    it('should create prefix patterns correctly', () => {
      const pattern = PermissionManager.createPrefixPattern('write_file', 'src');
      expect(pattern).toBe('write_file:src:*');
    });

    it('should create workspace patterns correctly', () => {
      const pattern = PermissionManager.createWorkspacePattern('write_file', 'src');
      expect(pattern).toBe('write_file:src/*');
    });

    it('should create tool wildcard patterns correctly', () => {
      const pattern = PermissionManager.createToolWildcardPattern('write_file');
      expect(pattern).toBe('write_file:*');
    });
  });

  describe('Prefix Pattern Matching', () => {
    it('should match tool wildcard patterns', () => {
      permissionManager.addToAllowList('write_file:*');
      
      const context: PermissionContext = {
        tool: 'write_file',
        path: '/any/path/file.txt',
      };

      const decision = permissionManager.checkPermission(context);
      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe('allow_list');
    });

    it('should match prefix patterns with proper boundaries', () => {
      permissionManager.addToAllowList('write_file:src:*');
      
      // Should match exact prefix
      const context1: PermissionContext = {
        tool: 'write_file',
        path: 'src',
      };
      expect(permissionManager.checkPermission(context1).allowed).toBe(true);

      // Should match prefix with space separator
      const context2: PermissionContext = {
        tool: 'write_file',
        command: 'src',
        args: ['build'],
      };
      expect(permissionManager.checkPermission(context2).allowed).toBe(true);

      // Should match prefix with path separator
      const context3: PermissionContext = {
        tool: 'write_file',
        path: 'src/components/Button.tsx',
      };
      expect(permissionManager.checkPermission(context3).allowed).toBe(true);

      // Should not match partial prefix
      const context4: PermissionContext = {
        tool: 'write_file',
        path: 'srcFile.ts',
      };
      expect(permissionManager.checkPermission(context4).allowed).toBe(false);
    });

    it('should match workspace-relative patterns', () => {
      permissionManager.addToAllowList('write_file:src/*');
      
      const context: PermissionContext = {
        tool: 'write_file',
        path: 'src/components/Button.tsx',
      };

      const decision = permissionManager.checkPermission(context);
      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe('allow_list');
    });

    it('should handle multiple workspace directories', () => {
      permissionManager.addToAllowList('write_file:src/*');
      permissionManager.addToAllowList('write_file:tests/*');
      permissionManager.addToAllowList('write_file:docs/*');
      permissionManager.addToAllowList('write_file:utils/*');
      
      // Should match src directory
      const srcContext: PermissionContext = {
        tool: 'write_file',
        path: 'src/utils/helpers.ts',
      };
      expect(permissionManager.checkPermission(srcContext).allowed).toBe(true);

      // Should match tests directory
      const testsContext: PermissionContext = {
        tool: 'write_file',
        path: 'tests/unit/validation.test.ts',
      };
      expect(permissionManager.checkPermission(testsContext).allowed).toBe(true);

      // Should match docs directory
      const docsContext: PermissionContext = {
        tool: 'write_file',
        path: 'docs/api.md',
      };
      expect(permissionManager.checkPermission(docsContext).allowed).toBe(true);

      // Should match utils directory
      const utilsContext: PermissionContext = {
        tool: 'write_file',
        path: 'utils/validation.test.ts',
      };
      expect(permissionManager.checkPermission(utilsContext).allowed).toBe(true);

      // Should not match other directories
      const otherContext: PermissionContext = {
        tool: 'write_file',
        path: 'build/output.js',
      };
      expect(permissionManager.checkPermission(otherContext).allowed).toBe(false);
    });
  });

  describe('Command Prefix Patterns', () => {
    it('should match command prefixes', () => {
      permissionManager.addToAllowList('run_command:npm:*');
      
      const context1: PermissionContext = {
        tool: 'run_command',
        command: 'npm',
        args: ['install'],
      };
      expect(permissionManager.checkPermission(context1).allowed).toBe(true);

      const context2: PermissionContext = {
        tool: 'run_command',
        command: 'npm',
        args: ['run', 'build'],
      };
      expect(permissionManager.checkPermission(context2).allowed).toBe(true);

      const context3: PermissionContext = {
        tool: 'run_command',
        command: 'npm',
      };
      expect(permissionManager.checkPermission(context3).allowed).toBe(true);

      // Should not match different command
      const context4: PermissionContext = {
        tool: 'run_command',
        command: 'yarn',
        args: ['install'],
      };
      expect(permissionManager.checkPermission(context4).allowed).toBe(false);
    });

    it('should handle complex command prefixes', () => {
      permissionManager.addToAllowList('run_command:git:*');
      
      const contexts: PermissionContext[] = [
        {
          tool: 'run_command',
          command: 'git',
          args: ['status'],
        },
        {
          tool: 'run_command',
          command: 'git',
          args: ['add', '.'],
        },
        {
          tool: 'run_command',
          command: 'git',
          args: ['commit', '-m', 'test'],
        },
      ];

      contexts.forEach(context => {
        expect(permissionManager.checkPermission(context).allowed).toBe(true);
      });
    });
  });

  describe('Utility Methods', () => {
    it('should add prefix patterns using utility method', () => {
      permissionManager.addPrefixPattern('write_file', 'src');
      
      const context: PermissionContext = {
        tool: 'write_file',
        path: 'src/components/App.tsx',
      };
      
      const decision = permissionManager.checkPermission(context);
      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe('allow_list');
    });

    it('should add workspace patterns using utility method', () => {
      permissionManager.addWorkspacePattern('write_file', 'utils');
      
      const context: PermissionContext = {
        tool: 'write_file',
        path: 'utils/helper.test.ts',
      };
      
      const decision = permissionManager.checkPermission(context);
      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe('allow_list');
    });

    it('should add tool wildcard patterns using utility method', () => {
      permissionManager.addToolWildcardPattern('read_file');
      
      const context: PermissionContext = {
        tool: 'read_file',
        path: '/any/file/anywhere.txt',
      };
      
      const decision = permissionManager.checkPermission(context);
      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe('allow_list');
    });
  });

  describe('Security and Edge Cases', () => {
    it('should not allow prefix patterns to override security blacklist', () => {
      // Even with allow list, security blacklist should still block
      permissionManager.addToAllowList('write_file:*');
      
      const context: PermissionContext = {
        tool: 'write_file',
        path: '.env',
      };
      
      const decision = permissionManager.checkPermission(context);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe('blacklisted');
    });

    it('should handle empty prefixes gracefully', () => {
      permissionManager.addToAllowList('write_file:*');
      
      const context: PermissionContext = {
        tool: 'write_file',
        path: '',
      };
      
      const decision = permissionManager.checkPermission(context);
      expect(decision.allowed).toBe(true);
    });

    it('should handle special characters in prefixes', () => {
      permissionManager.addToAllowList('write_file:src-*');
      
      const context: PermissionContext = {
        tool: 'write_file',
        path: 'src-components/Button.tsx',
      };
      
      const decision = permissionManager.checkPermission(context);
      expect(decision.allowed).toBe(true);
    });
  });
});
