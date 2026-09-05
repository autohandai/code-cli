/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertTestEvidenceDirectory, createTestEvidenceDirectory } from './evidenceDirectory.js';

export interface ProjectTestRunOptions {
  workspaceRoot: string;
  script: string;
  args?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ProjectTestRunManifest {
  version: 1;
  kind: 'project-script';
  status: 'passed' | 'failed' | 'not-run';
  script: string;
  command: string[];
  exitCode: number | null;
  message: string;
  visualInspection: 'not-run';
  logPath?: string;
  logTruncated: boolean;
  reportPath: string;
  manifestPath: string;
  startedAt: string;
  finishedAt: string;
}

type PackageManager = 'npm' | 'bun' | 'pnpm' | 'yarn';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function resolvePackageManager(workspaceRoot: string, declaration: unknown): Promise<PackageManager> {
  if (typeof declaration === 'string') {
    const match = /^(npm|bun|pnpm|yarn)@/.exec(declaration);
    if (!match) throw new Error('Unsupported packageManager; expected npm, bun, pnpm, or yarn.');
    return match[1] as PackageManager;
  }
  const files = await fs.readdir(workspaceRoot);
  if (files.includes('bun.lock') || files.includes('bun.lockb')) return 'bun';
  if (files.includes('pnpm-lock.yaml')) return 'pnpm';
  if (files.includes('yarn.lock')) return 'yarn';
  return 'npm';
}

async function executeScript(
  options: ProjectTestRunOptions,
  command: string[],
  manifest: ProjectTestRunManifest,
): Promise<string> {
  return new Promise<string>((resolve) => {
    const child = spawn(command[0]!, command.slice(1), {
      cwd: options.workspaceRoot,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, COREPACK_ENABLE_NETWORK: '0', npm_config_offline: 'true', CI: 'true' },
    });
    let output = '';
    let outputBytes = 0;
    let stopped: 'cancelled' | 'timed out' | undefined;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const capture = (chunk: Buffer): void => {
      const remaining = 2_000_000 - outputBytes;
      if (chunk.byteLength > remaining) manifest.logTruncated = true;
      if (remaining <= 0) return;
      const kept = chunk.subarray(0, remaining);
      output += kept.toString('utf8');
      outputBytes += kept.byteLength;
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const terminate = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // The process may exit between cancellation and the signal delivery.
      }
    };
    const stop = (reason: 'cancelled' | 'timed out'): void => {
      if (settled || stopped) return;
      stopped = reason;
      terminate('SIGTERM');
      killTimer = setTimeout(() => terminate('SIGKILL'), 1_000);
      killTimer.unref();
    };
    const abort = (): void => stop('cancelled');
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop('timed out'), options.timeoutMs ?? 120_000);
    timer.unref();
    const finish = (): void => {
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', abort);
      resolve(output);
    };
    child.on('error', (error) => {
      manifest.status = 'not-run';
      manifest.message = `Could not start the installed project test runner: ${error.message}`;
      finish();
    });
    child.on('close', (code) => {
      if (settled) return;
      manifest.exitCode = code;
      manifest.status = code === 0 && !stopped ? 'passed' : 'failed';
      manifest.message = stopped
        ? `Project test script ${stopped}; partial logs are retained.`
        : `Project script exited with code ${code ?? 'unavailable'}. This is the script result, not independent proof of test coverage.`;
      finish();
    });
    if (options.signal?.aborted) abort();
  });
}

export async function runProjectTestScript(options: ProjectTestRunOptions): Promise<ProjectTestRunManifest> {
  const directory = await createTestEvidenceDirectory(options.workspaceRoot);
  const manifest: ProjectTestRunManifest = {
    version: 1,
    kind: 'project-script',
    status: 'not-run',
    script: options.script,
    command: [],
    exitCode: null,
    message: '',
    visualInspection: 'not-run',
    logTruncated: false,
    reportPath: path.join(directory, 'report.md'),
    manifestPath: path.join(directory, 'manifest.json'),
    startedAt: new Date().toISOString(),
    finishedAt: '',
  };
  try {
    if (options.signal?.aborted) throw new Error('Project test script cancelled before launch.');
    if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 600_000)) {
      throw new Error('timeoutMs must be an integer between 1 and 600000.');
    }
    const packageJson: unknown = JSON.parse(await fs.readFile(path.join(options.workspaceRoot, 'package.json'), 'utf8'));
    if (!isRecord(packageJson) || !isRecord(packageJson.scripts)
      || !/^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/.test(options.script)
      || !Object.hasOwn(packageJson.scripts, options.script)
      || typeof packageJson.scripts[options.script] !== 'string') {
      throw new Error('Choose an existing declared package.json script; shell commands are not accepted.');
    }
    if ((options.args ?? []).some((arg) => arg.includes('\0'))) throw new Error('Test arguments cannot contain NUL bytes.');
    const manager = await resolvePackageManager(options.workspaceRoot, packageJson.packageManager);
    const separator = manager === 'npm' && options.args?.length ? ['--'] : [];
    manifest.command = [manager, 'run', options.script, ...separator, ...options.args ?? []];
    const output = await executeScript(options, manifest.command, manifest);
    const logPath = path.join(directory, 'output.log');
    await assertTestEvidenceDirectory(directory);
    await fs.writeFile(logPath, output, { flag: 'wx', mode: 0o600 });
    manifest.logPath = logPath;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (manifest.status !== 'not-run') {
      manifest.status = 'failed';
      manifest.message = `Could not retain project test evidence: ${reason}`;
    } else {
      manifest.message = reason;
    }
  }
  manifest.finishedAt = new Date().toISOString();
  await assertTestEvidenceDirectory(directory);
  await fs.writeFile(manifest.manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  await assertTestEvidenceDirectory(directory);
  await fs.writeFile(manifest.reportPath, [
    '# Project test evidence',
    '',
    `Status: ${manifest.status}`,
    `Script: ${manifest.script}`,
    `Command arguments: ${JSON.stringify(manifest.command)}`,
    `Exit code: ${manifest.exitCode ?? 'not available'}`,
    `Visual inspection: ${manifest.visualInspection}`,
    '',
    manifest.message,
    '',
    ...(manifest.logPath ? [`Log: [output.log](output.log)${manifest.logTruncated ? ' (truncated at 2 MB)' : ''}`] : []),
    'Manifest: [manifest.json](manifest.json)',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
  return manifest;
}
