/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ShellSettings } from '../types.js';

type ShellDialect = NonNullable<ShellSettings['dialect']>;
type ShellProfileSettings = Pick<ShellSettings, 'executable' | 'dialect'>;

export interface ShellExecutionContext {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  settings?: ShellProfileSettings;
}

let configured: ShellProfileSettings | undefined;
let gitBashPath: { key: string; executable: string } | undefined;

export function configureShellExecution(settings: ShellProfileSettings | undefined): void {
  configured = settings?.executable ? { executable: settings.executable, dialect: settings.dialect } : undefined;
  gitBashPath = undefined;
}

function inferDialect(executable: string): ShellDialect {
  const name = path.win32.basename(executable.replaceAll('/', '\\')).replace(/\.exe$/iu, '').toLowerCase();
  if (name === 'cmd') return 'cmd';
  if (name === 'pwsh' || name === 'powershell') return 'powershell';
  return 'posix';
}

function nativeGitBashPath(environment: NodeJS.ProcessEnv): string {
  const shell = environment.SHELL || '/bin/bash';
  if (/^[a-z]:[\\/]/iu.test(shell)) return shell;
  const key = `${shell}\n${environment.PATH ?? environment.Path ?? ''}`;
  if (gitBashPath?.key === key) return gitBashPath.executable;
  try {
    const executable = execFileSync('cygpath.exe', ['-w', shell], {
      env: environment, encoding: 'utf8', timeout: 1500, windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!/^[a-z]:[\\/]/iu.test(executable)) throw new Error('Expected a Windows shell path');
    gitBashPath = { key, executable };
    return executable;
  } catch {
    throw new Error('Git Bash was detected but its shell path could not be resolved. Set shell.executable to the full Windows path of bash.exe.');
  }
}

export function getShellExecutionProfile(context: ShellExecutionContext = {}): { executable: string; dialect: ShellDialect } {
  const environment = context.environment ?? process.env;
  const platform = context.platform ?? process.platform;
  const settings = context.settings ?? configured;
  const executable = settings?.executable ?? (platform === 'win32'
    ? environment.MSYSTEM ? nativeGitBashPath(environment) : environment.ComSpec || environment.COMSPEC || 'cmd.exe'
    : environment.SHELL || '/bin/sh');
  return { executable, dialect: settings?.dialect ?? inferDialect(executable) };
}

export function resolveShellExecution(command: string, context: ShellExecutionContext = {}): { file: string; args: string[]; dialect: ShellDialect; windowsVerbatimArguments?: boolean } {
  const profile = getShellExecutionProfile(context);
  const args = profile.dialect === 'cmd' ? ['/d', '/s', '/c', `"${command}"`]
    : profile.dialect === 'powershell' ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]
      : ['-lc', command];
  return { file: profile.executable, args, dialect: profile.dialect,
    ...(profile.dialect === 'cmd' ? { windowsVerbatimArguments: true } : {}) };
}
