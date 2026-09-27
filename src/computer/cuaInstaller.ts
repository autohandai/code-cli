/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CUA_DRIVER_VERSION, inspectCuaDriver, resolveCuaDriverPath } from './cuaDriver.js';
import { killAfter } from '../utils/processTimeout.js';
import { discardResponseBody } from '../utils/responseBody.js';
import {
  prepareAutohandComputerUse,
  type ComputerUsePreparationResult,
  type PrepareComputerUseOptions,
} from './autohandComputerUse.js';

export { CUA_DRIVER_VERSION } from './cuaDriver.js';

export const COMPUTER_USE_RELEASE_BASE_URL =
  'https://github.com/autohandai/computer-use/releases/download';
export const COMPUTER_USE_RELEASE_TAG = `computer-use-v${CUA_DRIVER_VERSION}`;

const DOWNLOAD_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;

type ComputerUseArchiveFormat = 'tar.gz' | 'zip';

interface ComputerUseReleaseDefinition {
  name: string;
  sha256: string;
  format: ComputerUseArchiveFormat;
}

const RELEASE_ASSETS: Readonly<Record<string, ComputerUseReleaseDefinition>> = {
  'darwin/arm64': {
    name: `cua-driver-rs-${CUA_DRIVER_VERSION}-darwin-universal-binary.tar.gz`,
    sha256: 'e1c859785107914c3432acda574f627a028a00704ce2bb6c37b2075e6ad16512',
    format: 'tar.gz',
  },
  'darwin/x64': {
    name: `cua-driver-rs-${CUA_DRIVER_VERSION}-darwin-universal-binary.tar.gz`,
    sha256: 'e1c859785107914c3432acda574f627a028a00704ce2bb6c37b2075e6ad16512',
    format: 'tar.gz',
  },
  'linux/arm64': {
    name: `cua-driver-rs-${CUA_DRIVER_VERSION}-linux-arm64-binary.tar.gz`,
    sha256: 'f2a41fbd359398bd169af195e6978143376e40b16bbd6a1dd79de1f46cafee5b',
    format: 'tar.gz',
  },
  'linux/x64': {
    name: `cua-driver-rs-${CUA_DRIVER_VERSION}-linux-x86_64-binary.tar.gz`,
    sha256: '55c0f93ca0687382da6fe945d6c211a7306e685bab3351824e59547445274643',
    format: 'tar.gz',
  },
  'win32/arm64': {
    name: `cua-driver-rs-${CUA_DRIVER_VERSION}-windows-arm64-binary.zip`,
    sha256: '021f061a54d3d17c778f31a8da5595e270f9f170fde6d3a467b2d9557a2c2d88',
    format: 'zip',
  },
  'win32/x64': {
    name: `cua-driver-rs-${CUA_DRIVER_VERSION}-windows-x86_64-binary.zip`,
    sha256: 'fab00e2353ae9b93abeed5b7fef73661453c064c855ef40b1bea417aa9624fd1',
    format: 'zip',
  },
};

const EXPECTED_RUNTIME_ENTRIES: Readonly<Record<string, ReadonlySet<string>>> = {
  darwin: new Set([
    'LICENSE-CUA.md',
    'cua-driver',
    'cua-cursor-theme',
    'cua_driver_abi.h',
    'cua_driver_node_runtime.node',
    'libcua_driver_sdk.dylib',
  ]),
  linux: new Set([
    'LICENSE-CUA.md',
    'cua-driver',
    'cua-cursor-theme',
    'cua_driver_abi.h',
    'cua_driver_node_runtime.node',
    'libcua_driver_sdk.so',
    'wayland-helper',
  ]),
  win32: new Set([
    'LICENSE-CUA.md',
    'cua-driver.exe',
    'cua-cursor-theme.exe',
    'cua-driver-uia.exe',
    'cua_driver_abi.h',
    'cua_driver_node_runtime.node',
    'cua_driver_sdk.dll',
  ]),
};

export interface CuaInstallerAsset {
  name: string;
  url: string;
  sha256: string;
  format: ComputerUseArchiveFormat;
}

export interface CuaInstallerPlan {
  assets: CuaInstallerAsset[];
  command: string;
  args: string[];
  env: Record<string, string>;
  extractDirectory: string;
}

export interface BuildCuaInstallerPlanOptions {
  platform: NodeJS.Platform;
  architecture?: NodeJS.Architecture;
  temporaryDirectory: string;
  binDirectory: string;
}

export function resolveComputerUseReleaseAsset(
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture,
): CuaInstallerAsset {
  const definition = RELEASE_ASSETS[`${platform}/${architecture}`];
  if (!definition) {
    throw new Error(`Autohand Computer Use is not available for ${platform}/${architecture}.`);
  }
  return {
    ...definition,
    url: `${COMPUTER_USE_RELEASE_BASE_URL}/${COMPUTER_USE_RELEASE_TAG}/${definition.name}`,
  };
}

export function buildCuaInstallerPlan(options: BuildCuaInstallerPlanOptions): CuaInstallerPlan {
  const architecture = options.architecture ?? process.arch;
  const asset = resolveComputerUseReleaseAsset(options.platform, architecture);
  const pathApi = options.platform === 'win32' ? path.win32 : path;
  const archivePath = pathApi.join(options.temporaryDirectory, asset.name);
  const extractDirectory = pathApi.join(options.temporaryDirectory, 'extracted');

  if (options.platform === 'win32') {
    return {
      assets: [asset],
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force',
        archivePath,
        extractDirectory,
      ],
      env: {},
      extractDirectory,
    };
  }

  return {
    assets: [asset],
    command: '/usr/bin/tar',
    args: ['-xzf', archivePath, '-C', extractDirectory],
    env: {},
    extractDirectory,
  };
}

export function verifyCuaInstallerAsset(content: Uint8Array, asset: CuaInstallerAsset): void {
  const actual = createHash('sha256').update(content).digest('hex');
  if (actual !== asset.sha256) {
    throw new Error(`Autohand Computer Use ${asset.name} checksum verification failed.`);
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
    throw new Error(`Could not download Autohand Computer Use ${asset.name} (HTTP ${response.status}).`);
  }
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_ARCHIVE_BYTES) {
    discardResponseBody(response);
    throw new Error(`Autohand Computer Use ${asset.name} exceeded its size limit.`);
  }
  const content = Buffer.from(await response.arrayBuffer());
  if (content.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error(`Autohand Computer Use ${asset.name} exceeded its size limit.`);
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
        reject(new Error('Autohand Computer Use archive extraction timed out.'));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(
          `Autohand Computer Use archive extraction exited with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}.`,
        ));
      }
    });
  });
}

async function replaceRuntimeEntry(sourcePath: string, destinationPath: string): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(destinationPath),
    `.autohand-computer-use-${randomUUID()}-${path.basename(destinationPath)}`,
  );
  await rm(temporaryPath, { recursive: true, force: true });
  try {
    await cp(sourcePath, temporaryPath, { recursive: true, force: true });
    await rm(destinationPath, { recursive: true, force: true });
    await rename(temporaryPath, destinationPath);
  } catch (error) {
    await rm(temporaryPath, { recursive: true, force: true });
    throw error;
  }
}

async function installExtractedRuntime(
  extractDirectory: string,
  binDirectory: string,
  platform: NodeJS.Platform,
): Promise<void> {
  const expectedEntries = EXPECTED_RUNTIME_ENTRIES[platform];
  if (!expectedEntries) {
    throw new Error(`Autohand Computer Use does not support ${platform}.`);
  }
  const entries = await readdir(extractDirectory, { withFileTypes: true });
  const unexpectedEntry = entries.find((entry) => !expectedEntries.has(entry.name));
  if (unexpectedEntry) {
    throw new Error(`Autohand Computer Use archive contained unexpected entry ${unexpectedEntry.name}.`);
  }
  const entryNames = new Set(entries.map((entry) => entry.name));
  const missingEntry = [...expectedEntries].find((entry) => !entryNames.has(entry));
  if (missingEntry) {
    throw new Error(`Autohand Computer Use archive did not contain ${missingEntry}.`);
  }
  const driverName = platform === 'win32' ? 'cua-driver.exe' : 'cua-driver';
  if (!entries.some((entry) => entry.isFile() && entry.name === driverName)) {
    throw new Error(`Autohand Computer Use archive did not contain ${driverName}.`);
  }

  await mkdir(binDirectory, { recursive: true });
  for (const entry of entries) {
    const sourcePath = path.join(extractDirectory, entry.name);
    const destinationPath = path.join(binDirectory, entry.name);
    await replaceRuntimeEntry(sourcePath, destinationPath);
  }
  if (platform !== 'win32') {
    await chmod(path.join(binDirectory, 'cua-driver'), 0o755);
    await chmod(path.join(binDirectory, 'cua-cursor-theme'), 0o755);
    if (platform === 'linux') {
      await chmod(path.join(binDirectory, 'wayland-helper', 'install.sh'), 0o755);
    }
  }
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
      'Autohand',
      'Computer Use',
      'bin',
    );
  }
  return path.join(homeDir, '.local', 'bin');
}

export interface InstallCuaDriverOptions {
  platform?: NodeJS.Platform;
  architecture?: NodeJS.Architecture;
  binDirectory?: string;
  force?: boolean;
  fetchImpl?: typeof fetch;
  executeInstaller?: (plan: CuaInstallerPlan) => Promise<void>;
  buildPlan?: (options: BuildCuaInstallerPlanOptions) => CuaInstallerPlan;
  resolveDriverPath?: typeof resolveCuaDriverPath;
  inspectDriver?: typeof inspectCuaDriver;
  prepareComputerUse?: (options: PrepareComputerUseOptions) => Promise<ComputerUsePreparationResult>;
}

export type InstallCuaDriverResult =
  | { status: 'reused'; path: string; version: string; computerUse?: ComputerUsePreparationResult }
  | { status: 'installed'; path: string; version: string; computerUse?: ComputerUsePreparationResult };

async function withComputerUseHost(
  result: InstallCuaDriverResult,
  platform: NodeJS.Platform,
  binDirectory: string,
  prepareComputerUse: (options: PrepareComputerUseOptions) => Promise<ComputerUsePreparationResult>,
): Promise<InstallCuaDriverResult> {
  if (platform !== 'darwin') return result;
  return {
    ...result,
    computerUse: await prepareComputerUse({ driverPath: result.path, binDirectory }),
  };
}

/** Download, verify, extract, install, and probe the pinned Autohand component archive. */
export async function installCuaDriver(
  options: InstallCuaDriverOptions = {},
): Promise<InstallCuaDriverResult> {
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const pathApi = platform === 'win32' ? path.win32 : path;
  const binDirectory = pathApi.resolve(options.binDirectory ?? defaultCuaBinDirectory(platform));
  const driverName = platform === 'win32' ? 'cua-driver.exe' : 'cua-driver';
  const managedDriverPath = pathApi.join(binDirectory, driverName);
  const resolveDriverPath = options.resolveDriverPath ?? resolveCuaDriverPath;
  const inspectDriver = options.inspectDriver ?? inspectCuaDriver;
  const prepareComputerUse = options.prepareComputerUse ?? prepareAutohandComputerUse;
  const existingPath = resolveDriverPath({ platform });
  const mayReuseExisting = existingPath !== null && (
    pathApi.resolve(existingPath) === pathApi.resolve(managedDriverPath)
    || process.env.AUTOHAND_CUA_DRIVER_PATH !== undefined
  );
  if (existingPath && mayReuseExisting && options.force !== true) {
    const existing = await inspectDriver(existingPath);
    if (existing.status === 'ready' && existing.supported) {
      return withComputerUseHost(
        { status: 'reused', path: existing.path, version: existing.version },
        platform,
        binDirectory,
        prepareComputerUse,
      );
    }
  }

  await mkdir(binDirectory, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'autohand-computer-use-install-'));
  const plan = (options.buildPlan ?? buildCuaInstallerPlan)({
    platform,
    architecture,
    temporaryDirectory,
    binDirectory,
  });
  try {
    await mkdir(plan.extractDirectory, { recursive: true });
    for (const asset of plan.assets) {
      const content = await downloadInstallerAsset(asset, options.fetchImpl ?? fetch);
      const destination = pathApi.join(temporaryDirectory, asset.name);
      await writeFile(destination, content, { mode: 0o600 });
    }
    await (options.executeInstaller ?? runInstaller)(plan);
    await installExtractedRuntime(plan.extractDirectory, binDirectory, platform);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  const installedPath = resolveDriverPath({
    platform,
    env: {
      ...process.env,
      AUTOHAND_CUA_DRIVER_PATH: managedDriverPath,
    },
  });
  if (!installedPath) {
    throw new Error(`Autohand Computer Use ${CUA_DRIVER_VERSION} installed but its engine was not found.`);
  }
  const inspection = await inspectDriver(installedPath);
  if (inspection.status !== 'ready' || !inspection.supported) {
    throw new Error(
      inspection.status === 'broken'
        ? `Autohand Computer Use installed but could not start: ${inspection.error}`
        : `Autohand Computer Use ${inspection.version} is older than required ${CUA_DRIVER_VERSION}.`,
    );
  }
  return withComputerUseHost(
    { status: 'installed', path: inspection.path, version: inspection.version },
    platform,
    binDirectory,
    prepareComputerUse,
  );
}
