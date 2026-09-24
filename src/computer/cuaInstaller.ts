/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CUA_DRIVER_VERSION, inspectCuaDriver, resolveCuaDriverPath } from './cuaDriver.js';
import { killAfter } from '../utils/processTimeout.js';
import { discardResponseBody } from '../utils/responseBody.js';

export { CUA_DRIVER_VERSION } from './cuaDriver.js';

export const CUA_DRIVER_RELEASE_BASE_URL = 'https://github.com/trycua/cua/releases/download';

const DOWNLOAD_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const MAX_INSTALLER_BYTES = 2 * 1024 * 1024;

const INSTALLER_HASHES = {
  'install.sh': '317ba3a49fdba10f2a7f1b9f392c1bc1b7657f3aae85e1e2e43684cf17a1bf3b',
  '_install-rust.sh': 'c3b4423dd4290f65f03579013f2c350e5a08b03458c9ae34ac4904865ec3f833',
  'install.ps1': '3e770fa8c351b80db99ae6b080f696a22f844534498bf44d45816cbd05eb0c3f',
} as const;

export interface CuaInstallerAsset {
  name: keyof typeof INSTALLER_HASHES;
  url: string;
  sha256: string;
}

export interface CuaInstallerPlan {
  assets: CuaInstallerAsset[];
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface BuildCuaInstallerPlanOptions {
  platform: NodeJS.Platform;
  temporaryDirectory: string;
  binDirectory: string;
}

function releaseAsset(name: keyof typeof INSTALLER_HASHES): CuaInstallerAsset {
  return {
    name,
    url: `${CUA_DRIVER_RELEASE_BASE_URL}/cua-driver-rs-v${CUA_DRIVER_VERSION}/${name}`,
    sha256: INSTALLER_HASHES[name],
  };
}

export function buildCuaInstallerPlan(options: BuildCuaInstallerPlanOptions): CuaInstallerPlan {
  const commonEnvironment = {
    CUA_DRIVER_RS_VERSION: CUA_DRIVER_VERSION,
    CUA_DRIVER_RS_INSTALL_DIR: options.binDirectory,
    CUA_DRIVER_RS_TELEMETRY_ENABLED: '0',
  };
  if (options.platform === 'win32') {
    return {
      assets: [releaseAsset('install.ps1')],
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.win32.join(options.temporaryDirectory, 'install.ps1'),
        '-Release',
        CUA_DRIVER_VERSION,
      ],
      env: commonEnvironment,
    };
  }
  return {
    assets: [releaseAsset('install.sh'), releaseAsset('_install-rust.sh')],
    command: '/bin/bash',
    args: [
      path.join(options.temporaryDirectory, 'install.sh'),
      '--bin-dir',
      options.binDirectory,
      '--no-modify-path',
    ],
    env: {
      ...commonEnvironment,
      CUA_DRIVER_RS_NO_MODIFY_PATH: '1',
    },
  };
}

export function verifyCuaInstallerAsset(content: Uint8Array, asset: CuaInstallerAsset): void {
  const actual = createHash('sha256').update(content).digest('hex');
  if (actual !== asset.sha256) {
    throw new Error(`Cua Driver ${asset.name} checksum verification failed.`);
  }
}

async function downloadInstallerAsset(
  asset: CuaInstallerAsset,
  fetchImpl: typeof fetch,
): Promise<Buffer> {
  const response = await fetchImpl(asset.url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    discardResponseBody(response);
    throw new Error(`Could not download Cua Driver ${asset.name} (HTTP ${response.status}).`);
  }
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_INSTALLER_BYTES) {
    discardResponseBody(response);
    throw new Error(`Cua Driver ${asset.name} exceeded its size limit.`);
  }
  const content = Buffer.from(await response.arrayBuffer());
  if (content.byteLength > MAX_INSTALLER_BYTES) {
    throw new Error(`Cua Driver ${asset.name} exceeded its size limit.`);
  }
  verifyCuaInstallerAsset(content, asset);
  return content;
}

async function runInstaller(plan: CuaInstallerPlan): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(plan.command, plan.args, {
      env: { ...process.env, ...plan.env },
      stdio: 'inherit',
      windowsHide: true,
    });
    let timedOut = false;
    killAfter(child, INSTALL_TIMEOUT_MS, () => {
      timedOut = true;
      child.kill('SIGKILL');
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (timedOut) {
        reject(new Error('Cua Driver installer timed out.'));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Cua Driver installer exited with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}.`));
      }
    });
  });
}

export function defaultCuaBinDirectory(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  homeDir = os.homedir(),
): string {
  if (platform === 'win32') {
    return path.win32.join(
      env.LOCALAPPDATA ?? path.win32.join(homeDir, 'AppData', 'Local'),
      'Programs',
      'Cua',
      'cua-driver',
      'bin',
    );
  }
  return path.join(homeDir, '.local', 'bin');
}

export interface InstallCuaDriverOptions {
  platform?: NodeJS.Platform;
  binDirectory?: string;
  force?: boolean;
  fetchImpl?: typeof fetch;
  executeInstaller?: (plan: CuaInstallerPlan) => Promise<void>;
  buildPlan?: (options: BuildCuaInstallerPlanOptions) => CuaInstallerPlan;
  resolveDriverPath?: typeof resolveCuaDriverPath;
  inspectDriver?: typeof inspectCuaDriver;
}

export type InstallCuaDriverResult =
  | { status: 'reused'; path: string; version: string }
  | { status: 'installed'; path: string; version: string };

/** Download, verify, run, and then probe the pinned official installer. */
export async function installCuaDriver(
  options: InstallCuaDriverOptions = {},
): Promise<InstallCuaDriverResult> {
  const platform = options.platform ?? process.platform;
  const binDirectory = path.resolve(options.binDirectory ?? defaultCuaBinDirectory(platform));
  const resolveDriverPath = options.resolveDriverPath ?? resolveCuaDriverPath;
  const inspectDriver = options.inspectDriver ?? inspectCuaDriver;
  const existingPath = resolveDriverPath({ platform });
  if (existingPath && options.force !== true) {
    const existing = await inspectDriver(existingPath);
    if (existing.status === 'ready' && existing.supported) {
      return { status: 'reused', path: existing.path, version: existing.version };
    }
  }

  await mkdir(binDirectory, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'autohand-cua-install-'));
  const plan = (options.buildPlan ?? buildCuaInstallerPlan)({
    platform,
    temporaryDirectory,
    binDirectory,
  });
  try {
    for (const asset of plan.assets) {
      const content = await downloadInstallerAsset(asset, options.fetchImpl ?? fetch);
      const destination = platform === 'win32'
        ? path.win32.join(temporaryDirectory, asset.name)
        : path.join(temporaryDirectory, asset.name);
      await writeFile(destination, content, { mode: 0o700 });
      if (platform !== 'win32') await chmod(destination, 0o700);
    }
    await (options.executeInstaller ?? runInstaller)(plan);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  const installedPath = resolveDriverPath({
    platform,
    env: {
      ...process.env,
      AUTOHAND_CUA_DRIVER_PATH: path.join(
        binDirectory,
        platform === 'win32' ? 'cua-driver.exe' : 'cua-driver',
      ),
    },
  });
  if (!installedPath) {
    throw new Error(`Cua Driver ${CUA_DRIVER_VERSION} installed but its executable was not found.`);
  }
  const inspection = await inspectDriver(installedPath);
  if (inspection.status !== 'ready' || !inspection.supported) {
    throw new Error(
      inspection.status === 'broken'
        ? `Cua Driver installed but could not start: ${inspection.error}`
        : `Cua Driver ${inspection.version} is older than required ${CUA_DRIVER_VERSION}.`,
    );
  }
  return { status: 'installed', path: inspection.path, version: inspection.version };
}
