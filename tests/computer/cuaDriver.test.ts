/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { LoadedConfig } from '../../src/types.js';
import {
  CUA_DRIVER_VERSION,
  ensureCuaMcpServer,
  inspectCuaDriver,
  parseCuaDriverVersion,
  resolveCuaDriverPath,
} from '../../src/computer/cuaDriver.js';

function config(): LoadedConfig {
  return { configPath: '/tmp/config.json' } as LoadedConfig;
}

describe('resolveCuaDriverPath', () => {
  it('prefers an explicit config path, then the environment, PATH, packaged vendor, and platform defaults', () => {
    const separator = path.delimiter;
    const executableName = process.platform === 'win32' ? 'cua-driver.exe' : 'cua-driver';
    const available = new Set([
      '/configured/cua-driver',
      '/environment/cua-driver',
      path.join('/path-bin', executableName),
      path.join('/package', 'vendor', executableName),
      path.join('/home', '.local', 'bin', executableName),
    ]);
    const common = {
      platform: 'linux' as const,
      homeDir: '/home',
      moduleDirectory: '/package/dist',
      executablePath: '/runtime/node',
      entryPath: '/package/dist/index.js',
      isExecutable: (candidate: string) => available.has(candidate),
    };

    expect(resolveCuaDriverPath({
      ...common,
      configuredPath: '/configured/cua-driver',
      env: { AUTOHAND_CUA_DRIVER_PATH: '/environment/cua-driver', PATH: `/path-bin${separator}/other` },
    })).toBe('/configured/cua-driver');
    expect(resolveCuaDriverPath({
      ...common,
      env: { AUTOHAND_CUA_DRIVER_PATH: '/environment/cua-driver', PATH: `/path-bin${separator}/other` },
    })).toBe('/environment/cua-driver');
    expect(resolveCuaDriverPath({
      ...common,
      env: { PATH: `/path-bin${separator}/other` },
    })).toBe(path.join('/path-bin', executableName));
    expect(resolveCuaDriverPath({ ...common, env: { PATH: '' } })).toBe(path.join('/package', 'vendor', executableName));
  });

  it('returns null instead of trusting a path that is not executable', () => {
    expect(resolveCuaDriverPath({
      platform: 'linux',
      homeDir: '/home',
      env: { AUTOHAND_CUA_DRIVER_PATH: '/broken/cua-driver', PATH: '' },
      isExecutable: () => false,
    })).toBeNull();
  });

  it('finds the engine in the Autohand-owned Windows installation directory', () => {
    const expected = 'C:\\Local\\Programs\\Autohand\\Computer Use\\bin\\cua-driver.exe';
    expect(resolveCuaDriverPath({
      platform: 'win32',
      homeDir: 'C:\\Users\\test',
      env: { LOCALAPPDATA: 'C:\\Local', PATH: '' },
      moduleDirectory: 'C:\\Autohand\\dist',
      executablePath: 'C:\\Autohand\\autohand.exe',
      entryPath: 'C:\\Autohand\\dist\\index.js',
      isExecutable: (candidate) => candidate === expected,
    })).toBe(expected);
  });
});

describe('ensureCuaMcpServer', () => {
  it('adds the detected driver as a standard, promptless stdio MCP server', () => {
    const loaded = config();
    const result = ensureCuaMcpServer(loaded, { platform: 'linux', driverPath: '/opt/cua-driver' });

    expect(result.status).toBe('added');
    expect(loaded.mcp?.servers).toEqual([{
      name: 'cua-driver',
      transport: 'stdio',
      command: '/opt/cua-driver',
      args: ['mcp'],
      autoConnect: true,
      env: {
        CUA_DRIVER_PERMISSION_MODE: 'standard',
        CUA_DRIVER_RS_TELEMETRY_ENABLED: '0',
      },
    }]);
  });

  it('preserves a user configured Cua server without adding a duplicate', () => {
    const loaded = config();
    loaded.mcp = {
      servers: [{
        name: 'desktop',
        transport: 'stdio',
        command: '/custom/cua-driver',
        args: ['mcp', '--grant', 'existing-profile'],
      }],
    };

    expect(ensureCuaMcpServer(loaded, { driverPath: '/opt/cua-driver' }).status).toBe('existing');
    expect(loaded.mcp.servers).toHaveLength(1);
    expect(loaded.mcp.servers?.[0]?.command).toBe('/custom/cua-driver');
  });

  it.each([
    { options: { bare: true, driverPath: '/opt/cua-driver' }, expected: 'disabled' },
    { options: { driverPath: '/opt/cua-driver', env: { AUTOHAND_DISABLE_COMPUTER_USE: '1' } }, expected: 'disabled' },
    { options: { driverPath: null }, expected: 'missing' },
  ])('does not add the server when integration is unavailable or disabled: $expected', ({ options, expected }) => {
    const loaded = config();
    expect(ensureCuaMcpServer(loaded, options).status).toBe(expected);
    expect(loaded.mcp?.servers ?? []).toHaveLength(0);
  });

  it('honors the global MCP opt-out', () => {
    const loaded = config();
    loaded.mcp = { enabled: false, servers: [] };
    expect(ensureCuaMcpServer(loaded, { driverPath: '/opt/cua-driver' }).status).toBe('disabled');
    expect(loaded.mcp.servers).toEqual([]);
  });

  it('routes macOS MCP through the Autohand Computer Use permission host', () => {
    const loaded = config();
    const result = ensureCuaMcpServer(loaded, {
      platform: 'darwin',
      driverPath: '/Users/test/.local/bin/cua-driver',
      computerUseHostPath: '/Users/test/Applications/Autohand Computer Use.app/Contents/MacOS/AutohandComputerUse',
    });

    expect(result).toEqual({
      status: 'added',
      path: '/Users/test/Applications/Autohand Computer Use.app/Contents/MacOS/AutohandComputerUse',
    });
    expect(loaded.mcp?.servers).toEqual([expect.objectContaining({
      name: 'cua-driver',
      command: '/Users/test/Applications/Autohand Computer Use.app/Contents/MacOS/AutohandComputerUse',
      args: ['mcp', '--driver-path', '/Users/test/.local/bin/cua-driver'],
      env: expect.objectContaining({
        CUA_DRIVER_EMBEDDED: '1',
        CUA_DRIVER_HOST_BUNDLE_ID: 'ai.autohand.computer-use',
      }),
    })]);
  });

  it('does not fall back to the unbranded macOS engine when the permission host is missing', () => {
    const loaded = config();

    expect(ensureCuaMcpServer(loaded, {
      platform: 'darwin',
      driverPath: '/Users/test/.local/bin/cua-driver',
      computerUseHostPath: null,
    })).toEqual({ status: 'missing' });
    expect(loaded.mcp?.servers ?? []).toEqual([]);
  });
});

describe('Cua Driver inspection', () => {
  it('parses the official version output', () => {
    expect(parseCuaDriverVersion('cua-driver 0.28.2\n')).toBe('0.28.2');
    expect(parseCuaDriverVersion('Cua Driver v0.29.0')).toBe('0.29.0');
    expect(parseCuaDriverVersion('unknown')).toBeNull();
  });

  it('reports a healthy supported driver', async () => {
    const execute = vi.fn(async () => ({ stdout: `cua-driver ${CUA_DRIVER_VERSION}\n`, stderr: '' }));
    await expect(inspectCuaDriver('/opt/cua-driver', { execute })).resolves.toEqual({
      status: 'ready',
      path: '/opt/cua-driver',
      version: CUA_DRIVER_VERSION,
      supported: true,
    });
    expect(execute).toHaveBeenCalledWith('/opt/cua-driver', ['--version']);
  });

  it('distinguishes an old driver from a binary that cannot start', async () => {
    await expect(inspectCuaDriver('/opt/old', {
      execute: async () => ({ stdout: 'cua-driver 0.27.0', stderr: '' }),
    })).resolves.toMatchObject({ status: 'ready', supported: false, version: '0.27.0' });

    await expect(inspectCuaDriver('/opt/broken', {
      execute: async () => { throw new Error('permission denied'); },
    })).resolves.toEqual({
      status: 'broken',
      path: '/opt/broken',
      error: 'permission denied',
    });

    await expect(inspectCuaDriver('/opt/unrecognized', {
      execute: async () => ({ stdout: 'unexpected output', stderr: '' }),
    })).resolves.toEqual({
      status: 'broken',
      path: '/opt/unrecognized',
      error: 'Autohand Computer Use engine returned an unrecognized version.',
    });
  });
});
