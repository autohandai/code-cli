/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';

vi.mock('chalk', () => ({
  default: {
    bold: Object.assign((s: string) => s, {
      cyan: (s: string) => s,
      green: (s: string) => s,
      red: (s: string) => s,
    }),
    gray: (s: string) => s,
    cyan: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
  }
}));

vi.mock('../src/config.js', () => ({
  loadConfig: vi.fn(),
  resolveWorkspaceRoot: vi.fn(),
  getProviderConfig: vi.fn(),
  saveConfig: vi.fn(),
  getDefaultConfigPath: vi.fn()
}));

import { loadConfig, resolveWorkspaceRoot } from '../src/config.js';

describe('--permissions display', () => {
  let consoleOutput: string[];
  let originalConsoleLog: typeof console.log;
  let workspaceRoot: string;

  beforeEach(async () => {
    consoleOutput = [];
    originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => {
      consoleOutput.push(args.join(' '));
    };
    workspaceRoot = path.join(
      os.tmpdir(),
      `autohand-display-permissions-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await fs.ensureDir(path.join(workspaceRoot, '.autohand'));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    console.log = originalConsoleLog;
    await fs.remove(workspaceRoot);
  });

  it('renders session, project, user, and effective sections from real permission files', async () => {
    await fs.writeJson(path.join(workspaceRoot, '.autohand', 'settings.local.json'), {
      permissions: {
        allowList: ['write_file:/workspace/src/*'],
        denyList: ['delete_path:/workspace/dist/*'],
      },
      version: 1,
    });
    await fs.writeJson(path.join(workspaceRoot, '.autohand', 'session-permissions.json'), {
      allowList: ['run_command:git status'],
      denyList: [],
      version: 1,
    });

    (loadConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      configPath: '/Users/test/.autohand/config.json',
      permissions: {
        allowList: ['run_command:npm test'],
        denyList: ['run_command:npm publish'],
      },
    });
    (resolveWorkspaceRoot as ReturnType<typeof vi.fn>).mockReturnValue(workspaceRoot);

    const { displayPermissions } = await import('../src/index.js');

    await displayPermissions({});

    const output = consoleOutput.join('\n');
    expect(output).toContain('Autohand Permissions');
    expect(output).toContain('Session');
    expect(output).toContain('Project');
    expect(output).toContain('User');
    expect(output).toContain('Effective');
    expect(output).toContain('session-permissions.json');
    expect(output).toContain('settings.local.json');
    expect(output).toContain('/Users/test/.autohand/config.json');
    expect(output).toContain('run_command:git status');
    expect(output).toContain('run_command:npm publish');
  });
});
