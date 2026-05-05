/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { launchTerminal, type Session } from 'tuistory';

export interface TuistoryTempState {
  autohandHome: string;
  configPath: string;
  workspaceRoot: string;
  cleanup: () => Promise<void>;
}

export interface LaunchBuiltAutohandOptions {
  autohandHome?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  cols?: number;
  rows?: number;
  waitForData?: boolean;
  waitForDataTimeout?: number;
}

export function repoRoot(): string {
  return path.resolve(import.meta.dirname, '../../..');
}

export async function createTempAutohandHome(): Promise<TuistoryTempState> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'autohand-tuistory-'));
  const autohandHome = path.join(tempRoot, 'home');
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const configPath = path.join(autohandHome, 'config.json');

  await mkdir(autohandHome, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  execFileSync('git', ['init'], { cwd: workspaceRoot, stdio: 'ignore' });

  await writeFile(
    configPath,
    JSON.stringify(
      {
        provider: 'openrouter',
        openrouter: {
          apiKey: 'tuistory-test-api-key',
          model: 'openai/gpt-4o-mini',
        },
        auth: {
          token: 'tuistory-test-token',
          expiresAt: '2099-01-01T00:00:00.000Z',
          user: {
            id: 'tuistory-test-user',
            email: 'tuistory@example.com',
            name: 'Tuistory Test',
          },
        },
        sync: {
          enabled: false,
        },
        ui: {
          checkForUpdates: false,
        },
      },
      null,
      2
    )
  );
  await writeFile(path.join(workspaceRoot, 'package.json'), '{"name":"tuistory-workspace","version":"0.0.0"}\n');

  return {
    autohandHome,
    configPath,
    workspaceRoot,
    cleanup: async () => {
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

export async function launchBuiltAutohand(
  args: string[],
  options: LaunchBuiltAutohandOptions = {}
): Promise<Session> {
  const root = repoRoot();
  const env: Record<string, string | undefined> = {
    ...process.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    AUTOHAND_NO_BANNER: '1',
    AUTOHAND_SKIP_PING: '1',
    AUTOHAND_SKIP_UPDATE_CHECK: '1',
    AUTOHAND_HOME: options.autohandHome,
    ...options.env,
  };

  return await launchTerminal({
    command: process.execPath,
    args: [path.join(root, 'dist/index.js'), ...args],
    cwd: options.cwd ?? root,
    env,
    cols: options.cols ?? 120,
    rows: options.rows ?? 36,
    waitForData: options.waitForData,
    waitForDataTimeout: options.waitForDataTimeout,
  });
}

export async function waitForExit(session: Session, timeout = 10_000): Promise<void> {
  const start = Date.now();
  while (!session.exitInfo) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for process exit. Current screen:\n${await session.text({ immediate: true })}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export function expectCleanExit(session: Session): void {
  if (!session.exitInfo) {
    throw new Error('Expected process to have exited, but it is still running.');
  }
  if (session.exitInfo.exitCode !== 0) {
    throw new Error(`Expected clean exit, got exitCode=${session.exitInfo.exitCode} signal=${session.exitInfo.signal}`);
  }
}

export async function exitInteractive(session: Session): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await session.press(['ctrl', 'c']);
    try {
      await waitForExit(session, 1_000);
      expectCleanExit(session);
      return;
    } catch {
      // The first Ctrl+C may clear composer text or show the exit warning.
    }
  }

  await waitForExit(session);
  expectCleanExit(session);
}
