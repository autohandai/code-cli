/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants, existsSync } from 'node:fs';
import { access, chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { arch as osArch, homedir, platform as osPlatform, tmpdir } from 'node:os';
import path from 'node:path';
import type { LoadedConfig } from '../types.js';

const RELEASE_BASE_URL = 'https://github.com/autohandai/squad/releases/latest/download';
const RELEASES_PAGE = 'https://github.com/autohandai/squad/releases/latest';
const MAC_APP_NAME = 'Autohand Squad.app';
const BINARY_NAME = 'autohand-squad';

export interface SquadDesktopDeps {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  homeDir?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  applicationsDir?: string;
  run?: (command: string, args: string[]) => Promise<number>;
  launch?: (command: string, args: string[]) => void;
  onProgress?: (line: string) => void;
}

export interface SquadDesktopResult {
  code: number;
  output: string;
}

interface Target {
  key: string;
  installerSuffix: string;
}

/**
 * Open the Autohand Squad desktop app, installing the latest public release
 * first when it is missing. Squad reads the CLI's own session from
 * ~/.autohand/config.json, so a signed-in CLI opens a signed-in Squad.
 */
export async function openSquadDesktop(
  config: LoadedConfig | undefined,
  deps: SquadDesktopDeps = {},
): Promise<SquadDesktopResult> {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? osPlatform();
  const homeDir = deps.homeDir ?? homedir();
  const run = deps.run ?? runCommand;
  const progress = deps.onProgress ?? (() => {});

  const applicationsDir = deps.applicationsDir ?? '/Applications';
  let appPath = findInstalledApp(platform, homeDir, env, applicationsDir);
  const lines: string[] = [];
  if (!appPath) {
    const target = desktopTarget(platform, deps.arch ?? osArch());
    if (!target) {
      return {
        code: 1,
        output: [
          chalk.yellow(`Autohand Squad has no desktop build for ${platform}/${deps.arch ?? osArch()} yet.`),
          chalk.gray(`See ${RELEASES_PAGE}`),
        ].join('\n'),
      };
    }
    const installed = await installSquadDesktop(target, { ...deps, env, platform, homeDir, applicationsDir, run, progress });
    if ('error' in installed) return { code: 1, output: installed.error };
    appPath = installed.appPath;
    lines.push(chalk.green(`Installed Autohand Squad ${installed.version} to ${appPath}`));
  }

  if (platform === 'darwin') {
    const code = await run('open', ['-a', appPath]);
    if (code !== 0) return { code: 1, output: chalk.red(`Could not open ${appPath} (open exited with ${code}).`) };
  } else {
    (deps.launch ?? launchDetached)(appPath, []);
  }

  lines.push(chalk.green('Opened Autohand Squad.'));
  lines.push(signInLine(config));
  return { code: 0, output: lines.join('\n') };
}

export function desktopTarget(platform: NodeJS.Platform, arch: string): Target | null {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) {
    return { key: `darwin-${arch}`, installerSuffix: '.dmg' };
  }
  if (platform === 'linux' && arch === 'x64') return { key: 'linux-x64', installerSuffix: '.AppImage' };
  if (platform === 'win32' && arch === 'x64') return { key: 'win32-x64', installerSuffix: '-setup.exe' };
  return null;
}

export function findInstalledApp(
  platform: NodeJS.Platform,
  homeDir: string,
  env: NodeJS.ProcessEnv,
  applicationsDir = '/Applications',
): string | null {
  return installedAppCandidates(platform, homeDir, env, applicationsDir).find((candidate) => existsSync(candidate)) ?? null;
}

function installedAppCandidates(platform: NodeJS.Platform, homeDir: string, env: NodeJS.ProcessEnv, applicationsDir: string): string[] {
  if (platform === 'darwin') {
    return [path.join(applicationsDir, MAC_APP_NAME), path.join(homeDir, 'Applications', MAC_APP_NAME)];
  }
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
    const programFiles = env.ProgramFiles || 'C:\\Program Files';
    return [
      path.win32.join(localAppData, 'Autohand Squad', `${BINARY_NAME}.exe`),
      path.win32.join(programFiles, 'Autohand Squad', `${BINARY_NAME}.exe`),
    ];
  }
  return [linuxAppImagePath(homeDir), path.join('/usr/bin', BINARY_NAME)];
}

function linuxAppImagePath(homeDir: string): string {
  return path.join(homeDir, '.local', 'bin', `${BINARY_NAME}.AppImage`);
}

async function installSquadDesktop(
  target: Target,
  deps: Required<Pick<SquadDesktopDeps, 'env' | 'platform' | 'homeDir' | 'applicationsDir' | 'run'>> & SquadDesktopDeps & { progress: (line: string) => void },
): Promise<{ appPath: string; version: string } | { error: string }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const baseUrl = (deps.env.AUTOHAND_SQUAD_RELEASE_BASE_URL || RELEASE_BASE_URL).replace(/\/+$/, '');

  let checksums: string;
  try {
    const response = await fetchImpl(`${baseUrl}/checksums-desktop-${target.key}.txt`);
    if (!response.ok) return { error: chalk.red(`Could not find the latest Autohand Squad release (HTTP ${response.status}).`) };
    checksums = await response.text();
  } catch (error) {
    return { error: [chalk.red('Could not reach the Autohand Squad releases.'), chalk.gray((error as Error).message)].join('\n') };
  }

  const entry = checksums
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find(([hash, file]) => /^[0-9a-f]{64}$/i.test(hash ?? '') && file?.endsWith(target.installerSuffix));
  if (!entry) return { error: chalk.red(`The latest Autohand Squad release has no ${target.installerSuffix} installer for ${target.key}.`) };
  const [sha256, fileName] = entry;
  const version = fileName.match(/autohand-squad-([^-]+(?:-[a-z]+\.[0-9]+)?)-/)?.[1] ?? 'latest';

  deps.progress(`Downloading Autohand Squad ${version}...`);
  let bytes: Buffer;
  try {
    const response = await fetchImpl(`${baseUrl}/${fileName}`);
    if (!response.ok) return { error: chalk.red(`Could not download ${fileName} (HTTP ${response.status}).`) };
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    return { error: [chalk.red(`Could not download ${fileName}.`), chalk.gray((error as Error).message)].join('\n') };
  }
  if (createHash('sha256').update(bytes).digest('hex') !== sha256.toLowerCase()) {
    return { error: chalk.red(`Checksum mismatch for ${fileName}. Nothing was installed.`) };
  }

  deps.progress('Installing Autohand Squad...');
  if (deps.platform === 'linux') {
    const appPath = linuxAppImagePath(deps.homeDir);
    await mkdir(path.dirname(appPath), { recursive: true });
    await writeFile(appPath, bytes);
    await chmod(appPath, 0o755);
    return { appPath, version };
  }

  const workDir = await mkdtemp(path.join(tmpdir(), 'autohand-squad-install-'));
  try {
    const installer = path.join(workDir, fileName);
    await writeFile(installer, bytes);
    if (deps.platform === 'win32') {
      const code = await deps.run(installer, ['/S']);
      if (code !== 0) return { error: chalk.red(`The Autohand Squad installer exited with ${code}.`) };
      const appPath = findInstalledApp('win32', deps.homeDir, deps.env);
      return appPath ? { appPath, version } : { error: chalk.red('The installer finished, but Autohand Squad was not found.') };
    }
    return await installFromDmg(installer, workDir, version, deps);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function installFromDmg(
  dmg: string,
  workDir: string,
  version: string,
  deps: { homeDir: string; applicationsDir: string; run: (command: string, args: string[]) => Promise<number> },
): Promise<{ appPath: string; version: string } | { error: string }> {
  const mountPoint = path.join(workDir, 'mount');
  await mkdir(mountPoint);
  if (await deps.run('hdiutil', ['attach', '-nobrowse', '-readonly', '-quiet', '-mountpoint', mountPoint, dmg]) !== 0) {
    return { error: chalk.red('Could not open the Autohand Squad disk image.') };
  }
  try {
    const appName = (await readdir(mountPoint)).find((name) => name.endsWith('.app')) ?? MAC_APP_NAME;
    const destinationDir = await writableApplicationsDir(deps.applicationsDir, deps.homeDir);
    const appPath = path.join(destinationDir, MAC_APP_NAME);
    if (await deps.run('ditto', [path.join(mountPoint, appName), appPath]) !== 0) {
      return { error: chalk.red(`Could not copy Autohand Squad to ${destinationDir}.`) };
    }
    return { appPath, version };
  } finally {
    await deps.run('hdiutil', ['detach', mountPoint, '-quiet']);
  }
}

async function writableApplicationsDir(applicationsDir: string, homeDir: string): Promise<string> {
  try {
    await access(applicationsDir, constants.W_OK);
    return applicationsDir;
  } catch {
    const userApplications = path.join(homeDir, 'Applications');
    await mkdir(userApplications, { recursive: true });
    return userApplications;
  }
}

function signInLine(config: LoadedConfig | undefined): string {
  const auth = config?.auth;
  const expiresAt = auth?.expiresAt ? Date.parse(auth.expiresAt) : NaN;
  if (auth?.token && !(expiresAt <= Date.now())) {
    const email = auth.user?.email;
    return chalk.gray(email ? `Squad uses your Autohand CLI account (${email}).` : 'Squad uses your Autohand CLI account.');
  }
  return chalk.gray('Sign in inside Squad, or run `autohand login` first so Squad opens signed in.');
}

function runCommand(command: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

function launchDetached(command: string, args: string[]): void {
  const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
  child.on('error', () => {});
  child.unref();
}
