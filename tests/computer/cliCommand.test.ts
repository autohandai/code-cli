/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import * as host from '../../src/computer/autohandComputerUse.js';
import * as driver from '../../src/computer/cuaDriver.js';
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

describe('computer doctor readiness', () => {
  it.runIf(process.platform === 'darwin')('reports missing permissions as not ready with recovery guidance', async () => {
    const previous = process.exitCode;
    vi.spyOn(driver, 'resolveCuaDriverPath').mockReturnValue('/fixture/cua-driver');
    vi.spyOn(driver, 'inspectCuaDriver').mockResolvedValue({ status: 'ready', path: '/fixture/cua-driver', version: '0.28.2', supported: true });
    vi.spyOn(host, 'resolveAutohandComputerUseHostPath').mockReturnValue('/fixture/Autohand Computer Use.app/Contents/MacOS/AutohandComputerUse');
    vi.spyOn(host, 'inspectAutohandComputerUsePermissions').mockResolvedValue({ accessibility: false, screenRecording: true, bundleIdentifier: host.AUTOHAND_COMPUTER_USE_BUNDLE_ID });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const program = new Command();
      registerComputerCommand(program);
      await program.parseAsync(['computer', 'doctor', '--json'], { from: 'user' });
      const report = JSON.parse(output.mock.calls[0][0]);
      expect(report).toMatchObject({ mcpReady: false, permissions: { accessibility: false } });
      expect(report.error).toContain('remove the old entry');
      expect(report.error).toContain('/fixture/Autohand Computer Use.app');
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previous;
      vi.restoreAllMocks();
    }
  });
});
