/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CUA_DRIVER_RELEASE_BASE_URL,
  CUA_DRIVER_VERSION,
  buildCuaInstallerPlan,
  installCuaDriver,
  verifyCuaInstallerAsset,
} from '../../src/computer/cuaInstaller.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('buildCuaInstallerPlan', () => {
  it('pins the complete Unix installer chain to one immutable release', () => {
    const plan = buildCuaInstallerPlan({
      platform: 'darwin',
      temporaryDirectory: '/tmp/cua-install',
      binDirectory: '/opt/autohand/bin',
    });

    expect(plan.assets.map((asset) => asset.url)).toEqual([
      `${CUA_DRIVER_RELEASE_BASE_URL}/cua-driver-rs-v${CUA_DRIVER_VERSION}/install.sh`,
      `${CUA_DRIVER_RELEASE_BASE_URL}/cua-driver-rs-v${CUA_DRIVER_VERSION}/_install-rust.sh`,
    ]);
    expect(plan.assets.every((asset) => /^[0-9a-f]{64}$/u.test(asset.sha256))).toBe(true);
    expect(plan.command).toBe('/bin/bash');
    expect(plan.args).toEqual([
      path.join('/tmp/cua-install', 'install.sh'),
      '--bin-dir',
      '/opt/autohand/bin',
      '--no-modify-path',
    ]);
    expect(plan.env).toMatchObject({
      CUA_DRIVER_RS_VERSION: CUA_DRIVER_VERSION,
      CUA_DRIVER_RS_INSTALL_DIR: '/opt/autohand/bin',
      CUA_DRIVER_RS_NO_MODIFY_PATH: '1',
      CUA_DRIVER_RS_TELEMETRY_ENABLED: '0',
    });
  });

  it('uses the pinned PowerShell installer and default-on upstream autostart on Windows', () => {
    const plan = buildCuaInstallerPlan({
      platform: 'win32',
      temporaryDirectory: 'C:\\Temp\\cua-install',
      binDirectory: 'C:\\Autohand\\vendor',
    });

    expect(plan.assets).toHaveLength(1);
    expect(plan.assets[0]?.name).toBe('install.ps1');
    expect(plan.command.toLowerCase()).toContain('powershell');
    expect(plan.args).toEqual([
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.win32.join('C:\\Temp\\cua-install', 'install.ps1'),
      '-Release',
      CUA_DRIVER_VERSION,
    ]);
    expect(plan.env.CUA_DRIVER_RS_INSTALL_DIR).toBe('C:\\Autohand\\vendor');
  });
});

describe('verifyCuaInstallerAsset', () => {
  it('accepts only content matching the pinned SHA256 digest', () => {
    const content = Buffer.from('#!/bin/sh\necho safe\n');
    const sha256 = createHash('sha256').update(content).digest('hex');
    expect(() => verifyCuaInstallerAsset(content, { name: 'install.sh', url: 'https://example.test/install.sh', sha256 })).not.toThrow();
    expect(() => verifyCuaInstallerAsset(Buffer.from('changed'), { name: 'install.sh', url: 'https://example.test/install.sh', sha256 }))
      .toThrow('checksum verification failed');
  });
});

describe('installCuaDriver', () => {
  it('downloads verified installer content, executes it, and probes the installed binary', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'autohand-cua-installer-test-'));
    tempRoots.push(root);
    const binDirectory = path.join(root, 'bin');
    const installerContent = Buffer.from('#!/bin/sh\n# fixture installer\n');
    const sha256 = createHash('sha256').update(installerContent).digest('hex');
    const fetchImpl = vi.fn(async () => new Response(installerContent, {
      status: 200,
      headers: { 'content-length': String(installerContent.byteLength) },
    }));
    let stagedInstaller = '';
    const executeInstaller = vi.fn(async (plan: { args: string[] }) => {
      stagedInstaller = await readFile(plan.args[0]!, 'utf8');
      const executable = path.join(binDirectory, 'cua-driver');
      await writeFile(executable, '#!/bin/sh\nprintf "cua-driver 0.28.2\\n"\n');
      await chmod(executable, 0o755);
    });

    const result = await installCuaDriver({
      platform: 'linux',
      binDirectory,
      force: true,
      fetchImpl,
      executeInstaller,
      resolveDriverPath: () => path.join(binDirectory, 'cua-driver'),
      inspectDriver: async (driverPath) => ({
        status: 'ready',
        path: driverPath,
        version: '0.28.2',
        supported: true,
      }),
      buildPlan: ({ temporaryDirectory }) => ({
        assets: [{ name: 'install.sh', url: 'https://example.test/install.sh', sha256 }],
        command: '/bin/sh',
        args: [path.join(temporaryDirectory, 'install.sh')],
        env: {},
      }),
    });

    expect(result).toEqual({
      status: 'installed',
      path: path.join(binDirectory, 'cua-driver'),
      version: '0.28.2',
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://example.test/install.sh', expect.objectContaining({ redirect: 'follow' }));
    expect(executeInstaller).toHaveBeenCalledOnce();
    expect(stagedInstaller).toBe(installerContent.toString('utf8'));
  });
});
