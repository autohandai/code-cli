/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import * as installer from '../../src/computer/cuaInstaller.js';
import { buildComputerStatusReport, registerComputerCommand } from '../../src/computer/cliCommand.js';

describe('computer status', () => {
  it('does not report macOS MCP readiness without the branded permission host', () => {
    const inspection = {
      status: 'ready' as const,
      path: '/Users/test/.local/bin/cua-driver',
      version: '0.28.2',
      supported: true,
    };

    expect(buildComputerStatusReport(inspection, {
      requireComputerUseHost: true,
      computerUseHostReady: false,
    })).toMatchObject({
      installed: true,
      supported: true,
      mcpReady: false,
      error: 'Autohand Computer Use.app is missing.',
    });
    expect(buildComputerStatusReport(inspection, {
      requireComputerUseHost: true,
      computerUseHostReady: true,
    })).toMatchObject({ mcpReady: true, error: undefined });
  });
});

describe('computer install', () => {
  it('fails npm postinstall when the required component cannot be installed', async () => {
    const originalExitCode = process.exitCode;
    vi.stubEnv('AUTOHAND_INSTALL_COMPUTER_USE', '1');
    vi.spyOn(installer, 'installCuaDriver').mockRejectedValue(new Error('archive unavailable'));
    const output = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      process.exitCode = 0;
      const program = new Command();
      registerComputerCommand(program);
      await program.parseAsync(['computer', 'install', '--postinstall', '--non-interactive'], { from: 'user' });
      expect(process.exitCode).toBe(1);
      expect(output.mock.calls.flat().join(' ')).toContain('autohand computer install');
    } finally {
      process.exitCode = originalExitCode;
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    }
  });
});
