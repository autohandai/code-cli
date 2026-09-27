/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COMPUTER_USE_RELEASE_BASE_URL,
  COMPUTER_USE_RELEASE_TAG,
  CUA_DRIVER_VERSION,
  buildCuaInstallerPlan,
  defaultCuaBinDirectory,
  installCuaDriver,
  resolveComputerUseReleaseAsset,
  verifyCuaInstallerAsset,
} from '../../src/computer/cuaInstaller.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Autohand Computer Use release assets', () => {
  it.each([
    ['darwin', 'arm64', 'cua-driver-rs-0.28.2-darwin-universal-binary.tar.gz', 'tar.gz'],
    ['darwin', 'x64', 'cua-driver-rs-0.28.2-darwin-universal-binary.tar.gz', 'tar.gz'],
    ['linux', 'arm64', 'cua-driver-rs-0.28.2-linux-arm64-binary.tar.gz', 'tar.gz'],
    ['linux', 'x64', 'cua-driver-rs-0.28.2-linux-x86_64-binary.tar.gz', 'tar.gz'],
    ['win32', 'arm64', 'cua-driver-rs-0.28.2-windows-arm64-binary.zip', 'zip'],
    ['win32', 'x64', 'cua-driver-rs-0.28.2-windows-x86_64-binary.zip', 'zip'],
  ] as const)('pins %s/%s to the Autohand component release', (platform, architecture, name, format) => {
    const asset = resolveComputerUseReleaseAsset(platform, architecture);

    expect(asset).toMatchObject({ name, format });
    expect(asset.url).toBe(
      `${COMPUTER_USE_RELEASE_BASE_URL}/${COMPUTER_USE_RELEASE_TAG}/${name}`,
    );
    expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('rejects a target without a published computer-use binary', () => {
    expect(() => resolveComputerUseReleaseAsset('linux', 'ia32')).toThrow(
      'Autohand Computer Use is not available for linux/ia32',
    );
  });

  it('extracts one verified archive directly instead of executing a remote installer', () => {
    const unixPlan = buildCuaInstallerPlan({
      platform: 'darwin',
      architecture: 'arm64',
      temporaryDirectory: '/tmp/computer-use-install',
      binDirectory: '/opt/autohand/bin',
    });
    expect(unixPlan.assets).toHaveLength(1);
    expect(unixPlan.command).toBe('/usr/bin/tar');
    expect(unixPlan.args).toEqual([
      '-xzf',
      path.join('/tmp/computer-use-install', unixPlan.assets[0]!.name),
      '-C',
      path.join('/tmp/computer-use-install', 'extracted'),
    ]);
    expect(unixPlan.env).toEqual({});

    const windowsPlan = buildCuaInstallerPlan({
      platform: 'win32',
      architecture: 'x64',
      temporaryDirectory: 'C:\\Temp\\computer-use-install',
      binDirectory: 'C:\\Autohand\\Computer Use\\bin',
    });
    expect(windowsPlan.assets).toHaveLength(1);
    expect(windowsPlan.command).toBe('powershell.exe');
    expect(windowsPlan.args.join(' ')).toContain('Expand-Archive');
    expect(windowsPlan.args.join(' ')).not.toContain('Invoke-WebRequest');
  });

  it('uses an Autohand-owned Windows installation directory', () => {
    expect(defaultCuaBinDirectory(
      'win32',
      { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' },
      'C:\\Users\\test',
    )).toBe('C:\\Users\\test\\AppData\\Local\\Programs\\Autohand\\Computer Use\\bin');
  });
});

describe('verifyCuaInstallerAsset', () => {
  it('accepts only content matching the pinned SHA256 digest', () => {
    const content = Buffer.from('verified computer-use archive');
    const sha256 = createHash('sha256').update(content).digest('hex');
    const asset = {
      name: 'fixture.tar.gz',
      url: 'https://example.test/fixture.tar.gz',
      sha256,
      format: 'tar.gz' as const,
    };
    expect(() => verifyCuaInstallerAsset(content, asset)).not.toThrow();
    expect(() => verifyCuaInstallerAsset(Buffer.from('changed'), asset))
      .toThrow('checksum verification failed');
  });
});

describe('installCuaDriver', () => {
  it('prepares Autohand Computer Use and requests its permissions when reusing a macOS engine', async () => {
    const prepareComputerUse = vi.fn(async () => ({
      status: 'ready' as const,
      appPath: '/Users/test/Applications/Autohand Computer Use.app',
      launcherPath: '/Users/test/.local/bin/autohand-computer-use',
      permissions: 'requested' as const,
    }));

    const result = await installCuaDriver({
      platform: 'darwin',
      architecture: 'arm64',
      binDirectory: '/Users/test/.local/bin',
      resolveDriverPath: () => '/Users/test/.local/bin/cua-driver',
      inspectDriver: async (driverPath) => ({
        status: 'ready',
        path: driverPath,
        version: CUA_DRIVER_VERSION,
        supported: true,
      }),
      prepareComputerUse,
    });

    expect(prepareComputerUse).toHaveBeenCalledWith({
      driverPath: '/Users/test/.local/bin/cua-driver',
      binDirectory: expect.any(String),
    });
    expect(result).toMatchObject({
      status: 'reused',
      computerUse: {
        appPath: '/Users/test/Applications/Autohand Computer Use.app',
        permissions: 'requested',
      },
    });
  });

  it('does not install a macOS permission host on other platforms', async () => {
    const prepareComputerUse = vi.fn();

    await installCuaDriver({
      platform: 'linux',
      architecture: 'x64',
      binDirectory: '/home/test/.local/bin',
      resolveDriverPath: () => '/home/test/.local/bin/cua-driver',
      inspectDriver: async (driverPath) => ({
        status: 'ready',
        path: driverPath,
        version: CUA_DRIVER_VERSION,
        supported: true,
      }),
      prepareComputerUse,
    });

    expect(prepareComputerUse).not.toHaveBeenCalled();
  });

  it('downloads, verifies, extracts, installs, and probes an Autohand component archive', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autohand-computer-use-installer-test-'));
    tempRoots.push(root);
    const binDirectory = path.join(root, 'bin');
    const archiveContent = Buffer.from('fixture archive');
    const sha256 = createHash('sha256').update(archiveContent).digest('hex');
    const fetchImpl = vi.fn(async () => new Response(archiveContent, {
      status: 200,
      headers: { 'content-length': String(archiveContent.byteLength) },
    }));
    const executeInstaller = vi.fn(async (plan: { extractDirectory: string }) => {
      await mkdir(path.join(plan.extractDirectory, 'wayland-helper'), { recursive: true });
      await writeFile(
        path.join(plan.extractDirectory, 'cua-driver'),
        '#!/bin/sh\nprintf "cua-driver 0.28.2\\n"\n',
      );
      await writeFile(path.join(plan.extractDirectory, 'cua-cursor-theme'), '#!/bin/sh\n');
      await chmod(path.join(plan.extractDirectory, 'cua-driver'), 0o755);
      await writeFile(path.join(plan.extractDirectory, 'cua_driver_abi.h'), 'header');
      await writeFile(path.join(plan.extractDirectory, 'cua_driver_node_runtime.node'), 'runtime');
      await writeFile(path.join(plan.extractDirectory, 'libcua_driver_sdk.so'), 'sdk');
      await writeFile(path.join(plan.extractDirectory, 'LICENSE-CUA.md'), 'MIT');
      await writeFile(path.join(plan.extractDirectory, 'wayland-helper', 'install.sh'), '#!/bin/sh\n');
      await writeFile(path.join(plan.extractDirectory, 'wayland-helper', 'README.md'), 'helper');
    });

    const result = await installCuaDriver({
      platform: 'linux',
      architecture: 'x64',
      binDirectory,
      fetchImpl,
      executeInstaller,
      resolveDriverPath: ({ env }) => (
        env?.AUTOHAND_CUA_DRIVER_PATH ?? '/usr/local/bin/cua-driver'
      ),
      inspectDriver: async (driverPath) => ({
        status: 'ready',
        path: driverPath,
        version: CUA_DRIVER_VERSION,
        supported: true,
      }),
      buildPlan: ({ temporaryDirectory }) => ({
        assets: [{
          name: 'fixture.tar.gz',
          url: 'https://example.test/fixture.tar.gz',
          sha256,
          format: 'tar.gz',
        }],
        command: '/usr/bin/tar',
        args: [],
        env: {},
        extractDirectory: path.join(temporaryDirectory, 'extracted'),
      }),
    });

    expect(result).toEqual({
      status: 'installed',
      path: path.join(binDirectory, 'cua-driver'),
      version: CUA_DRIVER_VERSION,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.test/fixture.tar.gz',
      expect.objectContaining({ redirect: 'follow' }),
    );
    expect(executeInstaller).toHaveBeenCalledOnce();
  });
});
