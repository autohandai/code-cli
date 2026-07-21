/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {
  ensureNodePtyHelperExecutable,
  executeStreamingShellCommand,
  isImmediateCommand,
  isShellCommand,
  parseShellCommand,
  setNodePtyLoaderForTests,
} from '../../src/ui/shellCommand.js';

const originalAutohandHome = process.env.AUTOHAND_HOME;
const originalCodexHome = process.env.CODEX_HOME;

async function waitForProcessId(filePath: string, timeoutMs = 1_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(filePath)) {
      const pid = Number.parseInt(readFileSync(filePath, 'utf8').trim(), 10);
      if (Number.isSafeInteger(pid) && pid > 0) return pid;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for a process ID in ${filePath}`);
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (isProcessRunning(pid)) {
    if (Date.now() >= deadline) throw new Error(`Process ${pid} did not exit`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

afterEach(() => {
  setNodePtyLoaderForTests();
  vi.restoreAllMocks();
  if (originalAutohandHome === undefined) {
    delete process.env.AUTOHAND_HOME;
  } else {
    process.env.AUTOHAND_HOME = originalAutohandHome;
  }

  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = originalCodexHome;
  }
});

describe('isImmediateCommand', () => {
  describe('shell commands', () => {
    it('should return true for shell commands starting with !', () => {
      expect(isImmediateCommand('!ls')).toBe(true);
      expect(isImmediateCommand('! git status')).toBe(true);
      expect(isImmediateCommand('  !npm test  ')).toBe(true);
    });

    it('should return false for ! alone', () => {
      expect(isImmediateCommand('!')).toBe(false);
      expect(isImmediateCommand('  !  ')).toBe(false);
    });
  });

  describe('slash commands', () => {
    it('should return true for valid slash commands', () => {
      expect(isImmediateCommand('/help')).toBe(true);
      expect(isImmediateCommand('/model')).toBe(true);
      expect(isImmediateCommand('/quit')).toBe(true);
      expect(isImmediateCommand('  /exit  ')).toBe(true);
    });

    it('should return false for / alone', () => {
      expect(isImmediateCommand('/')).toBe(false);
      expect(isImmediateCommand('  /  ')).toBe(false);
    });
  });

  describe('file paths starting with /', () => {
    it('should return false for macOS screenshot paths', () => {
      // This is the exact format macOS Terminal pastes when you take a screenshot
      expect(isImmediateCommand('/var/folders/t1/2g8dxmj56vqd9qx_f0h1xs7r0000gn/T/TemporaryItems/NSIRD_screencaptureui_tW95AB/Screenshot 2025-01-15 at 10.30.45 AM.png')).toBe(false);
    });

    it('should return false for common Unix path prefixes', () => {
      expect(isImmediateCommand('/Users/igor/test.png')).toBe(false);
      expect(isImmediateCommand('/home/user/file.txt')).toBe(false);
      expect(isImmediateCommand('/tmp/screenshot.png')).toBe(false);
      expect(isImmediateCommand('/var/log/app.log')).toBe(false);
      expect(isImmediateCommand('/opt/homebrew/bin/node')).toBe(false);
      expect(isImmediateCommand('/etc/hosts')).toBe(false);
      expect(isImmediateCommand('/usr/local/bin/bun')).toBe(false);
    });

    it('should return false for paths with file extensions', () => {
      expect(isImmediateCommand('/path/to/file.png')).toBe(false);
      expect(isImmediateCommand('/path/to/file.jpg')).toBe(false);
      expect(isImmediateCommand('/path/to/file.txt')).toBe(false);
      expect(isImmediateCommand('/path/to/file.md')).toBe(false);
    });

    it('should return false for paths with nested slashes', () => {
      expect(isImmediateCommand('/a/b/c')).toBe(false);
      expect(isImmediateCommand('/some/nested/path')).toBe(false);
    });
  });

  describe('regular text', () => {
    it('should return false for regular text', () => {
      expect(isImmediateCommand('hello world')).toBe(false);
      expect(isImmediateCommand('fix the bug')).toBe(false);
      expect(isImmediateCommand('')).toBe(false);
      expect(isImmediateCommand('   ')).toBe(false);
    });
  });
});

describe('isShellCommand', () => {
  it('should return true for shell commands', () => {
    expect(isShellCommand('!ls')).toBe(true);
    expect(isShellCommand('!git status')).toBe(true);
  });

  it('should return false for non-shell commands', () => {
    expect(isShellCommand('ls')).toBe(false);
    expect(isShellCommand('/help')).toBe(false);
    expect(isShellCommand('!')).toBe(false);
  });
});

describe('parseShellCommand', () => {
  it('should parse shell commands correctly', () => {
    expect(parseShellCommand('!ls')).toBe('ls');
    expect(parseShellCommand('!git status')).toBe('git status');
    expect(parseShellCommand('  !npm test  ')).toBe('npm test');
  });

  it('should return empty string for non-shell commands', () => {
    expect(parseShellCommand('ls')).toBe('');
    expect(parseShellCommand('/help')).toBe('');
  });
});

describe('executeStreamingShellCommand', () => {
  it('repairs the node-pty native helper before PTY execution', async () => {
    const nodePtyRoot = mkdtempSync(join(tmpdir(), 'autohand-node-pty-runtime-'));
    const nativeDirectory = join(nodePtyRoot, 'prebuilds', 'darwin-arm64');
    const helperPath = join(nativeDirectory, 'spawn-helper');

    try {
      mkdirSync(nativeDirectory, { recursive: true });
      writeFileSync(join(nativeDirectory, 'pty.node'), 'native module placeholder');
      writeFileSync(helperPath, '#!/bin/sh\nexit 0\n');
      chmodSync(helperPath, 0o644);

      await expect(ensureNodePtyHelperExecutable({
        nodePtyRoot,
        platform: 'darwin',
        architecture: 'arm64',
      })).resolves.toBe(true);
      expect(statSync(helperPath).mode & 0o777).toBe(0o755);
    } finally {
      rmSync(nodePtyRoot, { recursive: true, force: true });
    }
  });

  it('disables PTY execution when the native helper layout is unavailable', async () => {
    const nodePtyRoot = mkdtempSync(join(tmpdir(), 'autohand-node-pty-missing-'));

    try {
      await expect(ensureNodePtyHelperExecutable({
        nodePtyRoot,
        platform: 'linux',
        architecture: 'x64',
      })).resolves.toBe(false);
    } finally {
      rmSync(nodePtyRoot, { recursive: true, force: true });
    }
  });

  it('accepts an already executable native helper without changing its mode', async () => {
    const nodePtyRoot = mkdtempSync(join(tmpdir(), 'autohand-node-pty-executable-'));
    const nativeDirectory = join(nodePtyRoot, 'build', 'Release');
    const helperPath = join(nativeDirectory, 'spawn-helper');

    try {
      mkdirSync(nativeDirectory, { recursive: true });
      writeFileSync(join(nativeDirectory, 'pty.node'), 'native module placeholder');
      writeFileSync(helperPath, '#!/bin/sh\nexit 0\n');
      chmodSync(helperPath, 0o500);

      await expect(ensureNodePtyHelperExecutable({
        nodePtyRoot,
        platform: 'linux',
        architecture: 'x64',
      })).resolves.toBe(true);
      expect(statSync(helperPath).mode & 0o777).toBe(0o500);
    } finally {
      rmSync(nodePtyRoot, { recursive: true, force: true });
    }
  });

  it('does not require executable helper permissions on Windows', async () => {
    await expect(ensureNodePtyHelperExecutable({
      nodePtyRoot: join(tmpdir(), 'autohand-node-pty-windows-missing'),
      platform: 'win32',
      architecture: 'x64',
    })).resolves.toBe(true);
  });

  it('maps CODEX_HOME to AUTOHAND_HOME for live shell commands', async () => {
    const autohandHome = join(tmpdir(), `autohand-shell-home-${Date.now()}`);
    process.env.AUTOHAND_HOME = autohandHome;
    process.env.CODEX_HOME = join(tmpdir(), 'inherited-codex-home');

    const script = 'console.log((process.env.AUTOHAND_HOME ?? "") + "\\n" + (process.env.CODEX_HOME ?? ""))';
    const result = await executeStreamingShellCommand(
      `${process.execPath} -e ${JSON.stringify(script)}`,
      tmpdir(),
      { preferPty: false }
    );

    expect(result.success).toBe(true);
    expect(result.output?.trim().split('\n')).toEqual([autohandHome, autohandHome]);
  });

  it('does not spawn when its signal is already aborted', async () => {
    const markerPath = join(tmpdir(), `autohand-shell-aborted-${Date.now()}`);
    const controller = new AbortController();
    controller.abort();
    const script = `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'spawned')`;

    const error = await executeStreamingShellCommand(
      `${process.execPath} -e ${JSON.stringify(script)}`,
      tmpdir(),
      { preferPty: false, signal: controller.signal }
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ name: 'AbortError' });
    expect(existsSync(markerPath)).toBe(false);
  });

  it('aborts a non-PTY foreground command and preserves streamed output', async () => {
    const markerPath = join(tmpdir(), `autohand-shell-pid-${Date.now()}`);
    const controller = new AbortController();
    const script = [
      `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, String(process.pid))`,
      `process.stdout.write('started\\n')`,
      'setTimeout(() => process.exit(0), 500)',
    ].join(';');
    let streamedOutput = '';
    const commandPromise = executeStreamingShellCommand(
      `${process.execPath} -e ${JSON.stringify(script)}`,
      tmpdir(),
      {
        preferPty: false,
        signal: controller.signal,
        onStdout: (chunk) => {
          streamedOutput += chunk;
        },
      }
    );
    const pid = await waitForProcessId(markerPath);
    await vi.waitFor(() => expect(streamedOutput).toContain('started'));

    controller.abort();
    const error = await commandPromise.catch((caught: unknown) => caught);

    expect(error).toMatchObject({ name: 'AbortError', output: 'started\n' });
    await waitForProcessExit(pid);
  });

  it('forces an entire non-PTY foreground process group to exit after its grace period', async () => {
    const markerPath = join(tmpdir(), `autohand-shell-force-pid-${Date.now()}`);
    const controller = new AbortController();
    const stubbornChildScript = [
      "process.on('SIGTERM', () => {})",
      `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, String(process.pid))`,
      'setTimeout(() => process.exit(0), 800)',
    ].join(';');
    const script = [
      `const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(stubbornChildScript)}], { stdio: 'inherit' })`,
      'child.on(\'exit\', (code) => process.exit(code ?? 0))',
    ].join(';');
    const commandPromise = executeStreamingShellCommand(
      `${process.execPath} -e ${JSON.stringify(script)}`,
      tmpdir(),
      { preferPty: false, signal: controller.signal, killGracePeriodMs: 30 }
    );
    const pid = await waitForProcessId(markerPath);

    const abortedAt = Date.now();
    controller.abort();
    const error = await commandPromise.catch((caught: unknown) => caught);

    expect(error).toMatchObject({ name: 'AbortError' });
    expect(Date.now() - abortedAt).toBeLessThan(500);
    await waitForProcessExit(pid);
  });

  it('keeps an already-started detached shell command alive after abort', async () => {
    const controller = new AbortController();
    const result = await executeStreamingShellCommand(
      `${process.execPath} -e ${JSON.stringify('setTimeout(() => process.exit(0), 1000)')}`,
      tmpdir(),
      { background: true, signal: controller.signal }
    );
    const pid = result.backgroundPid!;

    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(isProcessRunning(pid)).toBe(true);
    process.kill(pid, 'SIGTERM');
    await waitForProcessExit(pid);
  });

  it('kills a PTY and disposes handlers when aborted', async () => {
    let exitHandler: ((event: { exitCode: number; signal?: number }) => void) | undefined;
    const dataDispose = vi.fn();
    const exitDispose = vi.fn();
    const kill = vi.fn();
    setNodePtyLoaderForTests(async () => ({
      spawn: () => ({
        onData: () => ({ dispose: dataDispose }),
        onExit: (handler) => {
          exitHandler = handler;
          return { dispose: exitDispose };
        },
        kill,
      }),
    }));
    const stdinIsTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    const stdoutIsTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    try {
      const controller = new AbortController();
      const commandPromise = executeStreamingShellCommand('slow command', tmpdir(), {
        preferPty: true,
        signal: controller.signal,
      });
      await vi.waitFor(() => expect(exitHandler).toBeDefined());

      controller.abort();
      setTimeout(() => exitHandler?.({ exitCode: 0 }), 50);
      const error = await commandPromise.catch((caught: unknown) => caught);

      expect(error).toMatchObject({ name: 'AbortError' });
      expect(kill).toHaveBeenCalledTimes(1);
      expect(dataDispose).toHaveBeenCalledTimes(1);
      expect(exitDispose).toHaveBeenCalledTimes(1);
    } finally {
      if (stdinIsTty) Object.defineProperty(process.stdin, 'isTTY', stdinIsTty);
      else delete (process.stdin as { isTTY?: boolean }).isTTY;
      if (stdoutIsTty) Object.defineProperty(process.stdout, 'isTTY', stdoutIsTty);
      else delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
  });

  it('removes its abort listener after non-PTY completion', async () => {
    const controller = new AbortController();
    const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');

    await executeStreamingShellCommand(
      `${process.execPath} -e ${JSON.stringify('process.exit(0)')}`,
      tmpdir(),
      { preferPty: false, signal: controller.signal }
    );

    expect(addEventListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
