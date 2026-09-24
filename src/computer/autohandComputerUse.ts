/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants, realpathSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { killAfter } from '../utils/processTimeout.js';

export const AUTOHAND_COMPUTER_USE_APP_NAME = 'Autohand Computer Use';
export const AUTOHAND_COMPUTER_USE_BUNDLE_ID = 'ai.autohand.computer-use';
export const AUTOHAND_COMPUTER_USE_EXECUTABLE_NAME = 'AutohandComputerUse';
export const AUTOHAND_COMPUTER_USE_LAUNCHER_NAME = 'autohand-computer-use';

const PERMISSION_TIMEOUT_MS = 10 * 60_000;

export interface ComputerUsePermissionPlan {
  command: string;
  args: string[];
}

export interface ComputerUsePreparationResult {
  status: 'ready';
  appPath: string;
  launcherPath: string;
  permissions: 'granted' | 'requested';
}

export interface PrepareComputerUseOptions {
  driverPath: string;
  binDirectory: string;
}

export interface AutohandComputerUsePathOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  isExecutable?: (candidate: string) => boolean;
}

export interface ComputerUsePermissionStatus {
  accessibility: boolean;
  screenRecording: boolean;
  bundleIdentifier: string;
}

function isExecutable(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
    accessSync(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function appExecutable(appPath: string): string {
  return path.join(appPath, 'Contents', 'MacOS', AUTOHAND_COMPUTER_USE_EXECUTABLE_NAME);
}

export function defaultAutohandComputerUseAppPath(homeDir = os.homedir()): string {
  return path.join(homeDir, 'Applications', `${AUTOHAND_COMPUTER_USE_APP_NAME}.app`);
}

export function resolveAutohandComputerUseHostPath(
  options: AutohandComputerUsePathOptions = {},
): string | null {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin') return null;

  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const executableCheck = options.isExecutable ?? isExecutable;
  const configured = env.AUTOHAND_COMPUTER_USE_APP_PATH;
  if (configured) {
    const configuredExecutable = configured.endsWith('.app')
      ? appExecutable(configured)
      : configured;
    if (!executableCheck(configuredExecutable)) return null;
    try {
      return realpathSync(configuredExecutable);
    } catch {
      return path.resolve(configuredExecutable);
    }
  }
  const candidates = [
    ...((env.PATH ?? '').split(path.delimiter).filter(Boolean).map((directory) => (
      path.join(directory, AUTOHAND_COMPUTER_USE_LAUNCHER_NAME)
    ))),
    appExecutable(defaultAutohandComputerUseAppPath(homeDir)),
    appExecutable(path.join('/Applications', `${AUTOHAND_COMPUTER_USE_APP_NAME}.app`)),
  ];

  for (const candidate of candidates) {
    if (candidate && executableCheck(candidate)) {
      try {
        return realpathSync(candidate);
      } catch {
        return path.resolve(candidate);
      }
    }
  }
  return null;
}

export function buildComputerUsePermissionPlan(options: {
  appPath: string;
  driverPath: string;
  resultPath: string;
}): ComputerUsePermissionPlan {
  return {
    command: '/usr/bin/open',
    args: [
      '-W',
      '-n',
      options.appPath,
      '--args',
      'permissions',
      'grant',
      '--driver-path',
      options.driverPath,
      '--result-path',
      options.resultPath,
    ],
  };
}

export function buildComputerUsePermissionStatusPlan(options: {
  appPath: string;
  resultPath: string;
}): ComputerUsePermissionPlan {
  return {
    command: '/usr/bin/open',
    args: [
      '-W',
      '-n',
      options.appPath,
      '--args',
      'permissions',
      'status',
      '--result-path',
      options.resultPath,
    ],
  };
}

async function runCommand(plan: ComputerUsePermissionPlan, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(plan.command, plan.args, {
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    let timedOut = false;
    killAfter(child, timeoutMs, () => {
      timedOut = true;
      child.kill('SIGKILL');
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (timedOut) {
        reject(new Error(`${AUTOHAND_COMPUTER_USE_APP_NAME} permission setup timed out.`));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(
          `${AUTOHAND_COMPUTER_USE_APP_NAME} permission setup exited with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}.`,
        ));
      }
    });
  });
}

async function copyApplication(source: string, destination: string): Promise<void> {
  const parent = path.dirname(destination);
  const staging = path.join(parent, `.${AUTOHAND_COMPUTER_USE_APP_NAME}.${process.pid}.new`);
  const backup = path.join(parent, `.${AUTOHAND_COMPUTER_USE_APP_NAME}.${process.pid}.old`);
  await mkdir(parent, { recursive: true });
  await rm(staging, { recursive: true, force: true });
  await runCommand({ command: '/usr/bin/ditto', args: [source, staging] }, PERMISSION_TIMEOUT_MS);
  await runCommand({
    command: '/usr/bin/codesign',
    args: ['--verify', '--deep', '--strict', staging],
  }, PERMISSION_TIMEOUT_MS);

  await rm(backup, { recursive: true, force: true });
  try {
    await rename(destination, backup);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  try {
    await rename(staging, destination);
    await rm(backup, { recursive: true, force: true });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    try {
      await rename(backup, destination);
    } catch {
      // The original app did not exist or could not be restored; preserve the first error.
    }
    throw error;
  }
}

async function installLauncher(target: string, binDirectory: string): Promise<string> {
  const launcherPath = path.join(binDirectory, AUTOHAND_COMPUTER_USE_LAUNCHER_NAME);
  const staging = `${launcherPath}.${process.pid}.new`;
  await mkdir(binDirectory, { recursive: true });
  await rm(staging, { force: true });
  await symlink(target, staging);
  await rename(staging, launcherPath);
  return launcherPath;
}

function resolveSourceApplication(env: NodeJS.ProcessEnv): string | null {
  const configured = env.AUTOHAND_COMPUTER_USE_APP_SOURCE;
  if (configured && statSync(configured, { throwIfNoEntry: false })?.isDirectory()) {
    return path.resolve(configured);
  }
  const architecture = process.arch === 'arm64' ? 'arm64' : 'x64';
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const packageRoots = [
    path.resolve(moduleDirectory, '..'),
    path.resolve(moduleDirectory, '..', '..'),
  ];
  for (const packageRoot of packageRoots) {
    const packaged = path.join(
      packageRoot,
      'native',
      'macos',
      'prebuilt',
      architecture,
      `${AUTOHAND_COMPUTER_USE_APP_NAME}.app`,
    );
    if (statSync(packaged, { throwIfNoEntry: false })?.isDirectory()) {
      return packaged;
    }
  }
  return null;
}

async function requestPermissions(appPath: string, driverPath: string): Promise<'granted' | 'requested'> {
  if (process.env.AUTOHAND_SKIP_COMPUTER_USE_PERMISSIONS === '1') return 'requested';

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'autohand-computer-use-'));
  const resultPath = path.join(temporaryDirectory, 'permissions.json');
  try {
    await runCommand(buildComputerUsePermissionPlan({ appPath, driverPath, resultPath }), PERMISSION_TIMEOUT_MS);
    const result = JSON.parse(await readFile(resultPath, 'utf8')) as ComputerUsePermissionStatus;
    return result.accessibility === true && result.screenRecording === true
      ? 'granted'
      : 'requested';
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function inspectAutohandComputerUsePermissions(
  appPath: string,
): Promise<ComputerUsePermissionStatus> {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'autohand-computer-use-status-'));
  const resultPath = path.join(temporaryDirectory, 'permissions.json');
  try {
    await runCommand(
      buildComputerUsePermissionStatusPlan({ appPath, resultPath }),
      PERMISSION_TIMEOUT_MS,
    );
    const result = JSON.parse(await readFile(resultPath, 'utf8')) as Partial<ComputerUsePermissionStatus>;
    if (
      typeof result.accessibility !== 'boolean'
      || typeof result.screenRecording !== 'boolean'
      || result.bundleIdentifier !== AUTOHAND_COMPUTER_USE_BUNDLE_ID
    ) {
      throw new Error(`${AUTOHAND_COMPUTER_USE_APP_NAME} returned an invalid permission result.`);
    }
    return result as ComputerUsePermissionStatus;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function prepareAutohandComputerUse(
  options: PrepareComputerUseOptions,
): Promise<ComputerUsePreparationResult> {
  if (process.platform !== 'darwin') {
    throw new Error(`${AUTOHAND_COMPUTER_USE_APP_NAME} is only available on macOS.`);
  }

  const destination = defaultAutohandComputerUseAppPath();
  const source = resolveSourceApplication(process.env);
  if (source && path.resolve(source) !== path.resolve(destination)) {
    await copyApplication(source, destination);
  }

  const executable = appExecutable(destination);
  if (!isExecutable(executable)) {
    throw new Error(
      `${AUTOHAND_COMPUTER_USE_APP_NAME} was not bundled with this installation. Reinstall Autohand Code and retry.`,
    );
  }

  const launcherPath = await installLauncher(executable, options.binDirectory);
  const permissions = await requestPermissions(destination, options.driverPath);
  return { status: 'ready', appPath: destination, launcherPath, permissions };
}
