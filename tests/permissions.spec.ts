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
const { SlashCommandHandler } = await import('../src/core/slashCommandHandler.js');
const { SLASH_COMMANDS } = await import('../src/core/slashCommands.js');
const { renderAgentSlashCommandResult } = await import('../src/core/agent/AgentCommandRuntime.js');

const EMPTY_SNAPSHOT = {
  mode: 'interactive',
  rememberSession: true,
  session: { path: '/workspace/.autohand/session-permissions.json', allowList: [], denyList: [] },
  project: { path: '/workspace/.autohand/settings.local.json', allowList: [], denyList: [] },
  user: { path: '/Users/test/.autohand/config.yaml', allowList: [], denyList: [] },
  effective: { path: 'merged', allowList: [], denyList: [] },
};

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
      const output = await permissions({
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

      expect(consoleOutput).toEqual([]);
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
      const output = await permissions({
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

      expect(consoleOutput).toEqual([]);
      expect(output).toContain('No AllowList entries');
      expect(output).toContain('No DenyList entries');
    });
  });

  describe('interactive session', () => {
    function createHandler(overrides: Record<string, unknown> = {}) {
      const onBeforeModal = vi.fn();
      const onAfterModal = vi.fn();
      const context = {
        permissionManager: { getPermissionSnapshot: () => EMPTY_SNAPSHOT },
        config: { configPath: '/Users/test/.autohand/config.yaml' },
        onBeforeModal,
        onAfterModal,
        ...overrides,
      };
      return { handler: new SlashCommandHandler(context as never, SLASH_COMMANDS), onBeforeModal, onAfterModal };
    }

    // Regression: the command printed with console.log while the Ink frame was unmounted for a
    // "modal". A full-screen frame repaints every row on resume, so nothing was left to read.
    it('returns the report as the command result instead of printing around the Ink frame', async () => {
      const { handler, onBeforeModal, onAfterModal } = createHandler();

      const result = await handler.handle('/permissions');

      expect(result).toContain('Permission Settings');
      expect(result).toContain('Effective');
      expect(result).toContain('No AllowList entries');
      expect(consoleOutput).toEqual([]);
      expect(onBeforeModal).not.toHaveBeenCalled();
      expect(onAfterModal).not.toHaveBeenCalled();
    });

    it('lands in the transcript of a running Ink renderer with its layout intact', async () => {
      const { handler } = createHandler();
      const addAssistantMessage = vi.fn();
      const setCommandResult = vi.fn();
      const host = { inkRenderer: { isRunning: () => true, addAssistantMessage, setCommandResult } };

      const result = await handler.handle('/permissions');
      const rendered = renderAgentSlashCommandResult(host as never, '/permissions', result ?? '');

      expect(rendered).toBe(true);
      expect(setCommandResult).not.toHaveBeenCalled();
      expect(addAssistantMessage).toHaveBeenCalledTimes(1);
      const [message, renderMarkdown] = addAssistantMessage.mock.calls[0];
      expect(renderMarkdown).toBe(false);
      expect(message).toContain('Permission Settings');
      expect(message).toContain('  No DenyList entries');
    });
  });
});
