/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('chalk', () => ({
  default: {
    bold: { cyan: (s: string) => s, green: (s: string) => s, red: (s: string) => s },
    gray: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
    cyan: (s: string) => s,
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
    it('shows session, project, user, and effective sections with paths', async () => {
      await permissions({
        permissionManager: {
          getPermissionSnapshot: () => ({
            mode: 'interactive',
            rememberSession: true,
            session: {
              path: '/workspace/.autohand/session-permissions.json',
              allowList: ['run_command:git status'],
              denyList: ['delete_path:/workspace/dist/*'],
            },
            project: {
              path: '/workspace/.autohand/settings.local.json',
              allowList: ['write_file:/workspace/src/*'],
              denyList: [],
            },
            user: {
              path: '/Users/test/.autohand/config.json',
              allowList: ['run_command:npm test'],
              denyList: ['run_command:npm publish'],
            },
            effective: {
              path: 'merged',
              allowList: ['run_command:git status', 'write_file:/workspace/src/*', 'run_command:npm test'],
              denyList: ['delete_path:/workspace/dist/*', 'run_command:npm publish'],
            },
          }),
        } as any,
        configPath: '/Users/test/.autohand/config.json',
      });

      const output = consoleOutput.join('\n');
      expect(output).toContain('Permission Settings');
      expect(output).toContain('Mode: interactive');
      expect(output).toContain('Session');
      expect(output).toContain('Project');
      expect(output).toContain('User');
      expect(output).toContain('Effective');
      expect(output).toContain('/workspace/.autohand/session-permissions.json');
      expect(output).toContain('/workspace/.autohand/settings.local.json');
      expect(output).toContain('/Users/test/.autohand/config.json');
      expect(output).toContain('run_command:git status');
      expect(output).toContain('run_command:npm publish');
    });

    it('shows empty-state messaging per section', async () => {
      await permissions({
        permissionManager: {
          getPermissionSnapshot: () => ({
            mode: 'interactive',
            rememberSession: true,
            session: {
              path: '/workspace/.autohand/session-permissions.json',
              allowList: [],
              denyList: [],
            },
            project: {
              path: '/workspace/.autohand/settings.local.json',
              allowList: [],
              denyList: [],
            },
            user: {
              path: '/Users/test/.autohand/config.yaml',
              allowList: [],
              denyList: [],
            },
            effective: {
              path: 'merged',
              allowList: [],
              denyList: [],
            },
          }),
        } as any,
        configPath: '/Users/test/.autohand/config.yaml',
      });

      const output = consoleOutput.join('\n');
      expect(output).toContain('No AllowList entries');
      expect(output).toContain('No DenyList entries');
    });
  });
});
