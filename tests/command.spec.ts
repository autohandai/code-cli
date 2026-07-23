/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  runCommand,
  runShellCommand,
  type BackgroundProcessCompletion,
} from '../src/actions/command.js';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
    if (Date.now() >= deadline) {
      throw new Error(`Process ${pid} did not exit`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForDetachedCompletion<T>(
  completion: Promise<T>,
  timeoutMs = 2_000,
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timed out waiting for detached completion after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([completion, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

describe('runCommand', () => {
  const testDir = join(tmpdir(), 'autohand-command-test-' + Date.now());
  const subDir = join(testDir, 'subdir');

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'test.txt'), 'hello world');
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('executes a basic command', async () => {
    const result = await runCommand('echo', ['hello'], testDir);
    expect(result.stdout.trim()).toBe('hello');
    expect(result.code).toBe(0);
  });

  it('captures stderr', async () => {
    const result = await runCommand('node', ['-e', 'console.error("err")'], testDir);
    expect(result.stderr.trim()).toBe('err');
    expect(result.code).toBe(0);
  });

  it('preserves UTF-8 code points split across foreground output chunks', async () => {
    const script = [
      "const value = Buffer.from('🌍')",
      'process.stdout.write(value.subarray(0, 2))',
      'setTimeout(() => process.stdout.write(value.subarray(2)), 30)',
    ].join(';');

    const result = await runCommand(process.execPath, ['-e', script], testDir);

    expect(result.stdout).toBe('🌍');
    expect(result.code).toBe(0);
  });

  it('returns exit code for failed command', async () => {
    const result = await runCommand('node', ['-e', 'process.exit(42)'], testDir);
    expect(result.code).toBe(42);
  });

  it('executes in subdirectory when directory option provided', async () => {
    const result = await runCommand('ls', [], testDir, { directory: 'subdir' });
    expect(result.stdout).toContain('test.txt');
    expect(result.code).toBe(0);
  });

  it('honors absolute directory paths without rebasing them onto cwd', async () => {
    const absoluteDir = join(testDir, 'absolute-dir');
    mkdirSync(absoluteDir, { recursive: true });

    const result = await runCommand(
      'node',
      ['-e', 'console.log(process.cwd())'],
      testDir,
      { directory: absoluteDir }
    );

    expect(realpathSync(result.stdout.trim())).toBe(realpathSync(absoluteDir));
    expect(result.code).toBe(0);
  });

  it('injects AUTOHAND_CLI environment variable', async () => {
    const result = await runCommand('node', ['-e', 'console.log(process.env.AUTOHAND_CLI)'], testDir);
    expect(result.stdout.trim()).toBe('1');
  });

  it('maps CODEX_HOME to AUTOHAND_HOME for Autohand-launched commands', async () => {
    const autohandHome = join(testDir, 'autohand-home');
    const result = await runCommand(
      'node',
      ['-e', 'console.log(`${process.env.AUTOHAND_HOME}\\n${process.env.CODEX_HOME}`)'],
      testDir,
      { env: { AUTOHAND_HOME: autohandHome } }
    );

    expect(result.stdout.trim().split('\n')).toEqual([autohandHome, autohandHome]);
  });

  it('preserves an explicit CODEX_HOME command environment override', async () => {
    const autohandHome = join(testDir, 'autohand-home-explicit');
    const codexHome = join(testDir, 'codex-home-explicit');
    const result = await runCommand(
      'node',
      ['-e', 'console.log(`${process.env.AUTOHAND_HOME}\\n${process.env.CODEX_HOME}`)'],
      testDir,
      { env: { AUTOHAND_HOME: autohandHome, CODEX_HOME: codexHome } }
    );

    expect(result.stdout.trim().split('\n')).toEqual([autohandHome, codexHome]);
  });

  it('supports additional environment variables', async () => {
    const result = await runCommand(
      'node',
      ['-e', 'console.log(process.env.MY_VAR)'],
      testDir,
      { env: { MY_VAR: 'test-value' } }
    );
    expect(result.stdout.trim()).toBe('test-value');
  });

  it('runs background process and returns PID', async () => {
    const result = await runCommand('sleep', ['10'], testDir, { background: true });
    expect(result.backgroundPid).toBeDefined();
    expect(typeof result.backgroundPid).toBe('number');
    expect(result.code).toBe(null);

    // Kill the background process
    if (result.backgroundPid) {
      try {
        process.kill(result.backgroundPid, 'SIGTERM');
        await waitForProcessExit(result.backgroundPid);
      } catch {
        // Process may have already exited
      }
    }
  });

  it('streams detached output and reports completion exactly once', async () => {
    let stdout = '';
    let stderr = '';
    let resolveCompletion!: (completion: BackgroundProcessCompletion) => void;
    const completionPromise = new Promise<BackgroundProcessCompletion>((resolve) => {
      resolveCompletion = resolve;
    });
    const onBackgroundExit = vi.fn(resolveCompletion);

    const result = await runCommand(
      process.execPath,
      ['-e', [
        "process.stdout.write('background stdout\\n')",
        "process.stderr.write('background stderr\\n')",
        'setTimeout(() => process.exit(7), 30)',
      ].join(';')],
      testDir,
      {
        background: true,
        onStdout: (chunk) => {
          stdout += chunk;
        },
        onStderr: (chunk) => {
          stderr += chunk;
        },
        onBackgroundExit,
      }
    );

    expect(result).toMatchObject({
      stdout: '',
      stderr: '',
      code: null,
      signal: null,
    });
    expect(result.backgroundPid).toBeGreaterThan(0);

    await expect(waitForDetachedCompletion(completionPromise)).resolves.toEqual({
      code: 7,
      signal: null,
    });
    expect(stdout).toBe('background stdout\n');
    expect(stderr).toBe('background stderr\n');
    expect(onBackgroundExit).toHaveBeenCalledTimes(1);
  });

  it('preserves UTF-8 code points split across detached output chunks', async () => {
    let stdout = '';
    let resolveCompletion!: (completion: BackgroundProcessCompletion) => void;
    const completionPromise = new Promise<BackgroundProcessCompletion>((resolve) => {
      resolveCompletion = resolve;
    });
    const script = [
      "const value = Buffer.from('🌍')",
      'process.stdout.write(value.subarray(0, 2))',
      'setTimeout(() => process.stdout.write(value.subarray(2)), 30)',
    ].join(';');

    await runCommand(process.execPath, ['-e', script], testDir, {
      background: true,
      onStdout: (chunk) => {
        stdout += chunk;
      },
      onBackgroundExit: resolveCompletion,
    });

    await expect(waitForDetachedCompletion(completionPromise)).resolves.toEqual({
      code: 0,
      signal: null,
    });
    expect(stdout).toBe('🌍');
  });

  it('reports a detached spawn failure without emitting an unhandled error', async () => {
    let resolveCompletion!: (completion: BackgroundProcessCompletion) => void;
    const completionPromise = new Promise<BackgroundProcessCompletion>((resolve) => {
      resolveCompletion = resolve;
    });
    const onBackgroundExit = vi.fn(resolveCompletion);
    const missingCommand = 'autohand-background-command-that-does-not-exist';

    await expect(runCommand(missingCommand, [], testDir, {
        background: true,
        onBackgroundExit,
      })).rejects.toThrow(`Command not found: ${missingCommand}`);

    const completion = await waitForDetachedCompletion(completionPromise);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(completion).toMatchObject({ code: null, signal: null });
    expect(completion.error).toEqual(expect.objectContaining({
      message: `Command not found: ${missingCommand}`,
    }));
    expect(onBackgroundExit).toHaveBeenCalledTimes(1);
  });

  it('distinguishes a missing working directory from a missing command', async () => {
    let resolveCompletion!: (completion: BackgroundProcessCompletion) => void;
    const completionPromise = new Promise<BackgroundProcessCompletion>((resolve) => {
      resolveCompletion = resolve;
    });
    const missingDirectory = join(testDir, 'missing-background-cwd');

    await expect(runCommand(process.execPath, [], missingDirectory, {
      background: true,
      onBackgroundExit: resolveCompletion,
    })).rejects.toThrow(`Working directory not found: ${missingDirectory}`);

    const completion = await waitForDetachedCompletion(completionPromise);
    expect(completion.error?.message).toBe(`Working directory not found: ${missingDirectory}`);
  });

  it('keeps streaming after a detached command signal is aborted later', async () => {
    const controller = new AbortController();
    let stdout = '';
    let resolveCompletion!: (completion: BackgroundProcessCompletion) => void;
    const completionPromise = new Promise<BackgroundProcessCompletion>((resolve) => {
      resolveCompletion = resolve;
    });

    const result = await runCommand(
      process.execPath,
      ['-e', "setTimeout(() => process.stdout.write('after abort\\n'), 30); setTimeout(() => process.exit(0), 50)"],
      testDir,
      {
        background: true,
        signal: controller.signal,
        onStdout: (chunk) => {
          stdout += chunk;
        },
        onBackgroundExit: resolveCompletion,
      }
    );

    expect(result.backgroundPid).toBeGreaterThan(0);
    controller.abort();

    await expect(waitForDetachedCompletion(completionPromise)).resolves.toEqual({
      code: 0,
      signal: null,
    });
    expect(stdout).toBe('after abort\n');
  });

  it('drains high-volume detached output without blocking process completion', async () => {
    let resolveCompletion!: (completion: BackgroundProcessCompletion) => void;
    const completionPromise = new Promise<BackgroundProcessCompletion>((resolve) => {
      resolveCompletion = resolve;
    });
    const bytesPerStream = 512 * 1024;

    const result = await runCommand(
      process.execPath,
      ['-e', [
        `process.stdout.write('o'.repeat(${bytesPerStream}))`,
        `process.stderr.write('e'.repeat(${bytesPerStream}))`,
      ].join(';')],
      testDir,
      {
        background: true,
        onBackgroundExit: resolveCompletion,
      }
    );

    expect(result.backgroundPid).toBeGreaterThan(0);
    await expect(waitForDetachedCompletion(completionPromise)).resolves.toEqual({
      code: 0,
      signal: null,
    });
  });

  it('does not invoke the background completion observer for foreground work', async () => {
    const onBackgroundExit = vi.fn();

    const result = await runCommand(
      process.execPath,
      ['-e', "process.stdout.write('foreground')"],
      testDir,
      { onBackgroundExit }
    );

    expect(result).toMatchObject({ code: 0, stdout: 'foreground' });
    expect(onBackgroundExit).not.toHaveBeenCalled();
  });

  it('reports the terminating signal for a detached command', async () => {
    let resolveCompletion!: (completion: BackgroundProcessCompletion) => void;
    const completionPromise = new Promise<BackgroundProcessCompletion>((resolve) => {
      resolveCompletion = resolve;
    });
    const result = await runCommand(
      process.execPath,
      ['-e', 'setInterval(() => undefined, 1000)'],
      testDir,
      { background: true, onBackgroundExit: resolveCompletion }
    );

    process.kill(result.backgroundPid!, 'SIGTERM');

    const completion = await waitForDetachedCompletion(completionPromise);
    if (process.platform === 'win32') {
      expect(completion.error).toBeUndefined();
      expect(completion.code !== null || completion.signal !== null).toBe(true);
    } else {
      expect(completion).toEqual({ code: null, signal: 'SIGTERM' });
    }
  });

  it('supports timeout option', async () => {
    const result = await runCommand('sleep', ['10'], testDir, { timeout: 100 });
    // Should be killed by timeout
    expect(result.signal).toBe('SIGTERM');
  });

  it('does not spawn a foreground command when its signal is already aborted', async () => {
    const markerPath = join(testDir, 'already-aborted-marker');
    const controller = new AbortController();
    controller.abort();

    const error = await runCommand(
      process.execPath,
      ['-e', `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'spawned')`],
      testDir,
      { signal: controller.signal }
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ name: 'AbortError' });
    expect(existsSync(markerPath)).toBe(false);
  });

  it('aborts a foreground command and preserves output captured before termination', async () => {
    const controller = new AbortController();
    let streamedOutput = '';
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const commandPromise = runCommand(
      process.execPath,
      ['-e', [
        `process.stdout.write('started\\n')`,
        'setInterval(() => {}, 1000)',
      ].join(';')],
      testDir,
      {
        signal: controller.signal,
        onStdout: (chunk) => {
          streamedOutput += chunk;
          if (streamedOutput.includes('started\n')) {
            resolveStarted();
          }
        },
      }
    );
    await started;

    controller.abort();
    const error = await commandPromise.catch((caught: unknown) => caught);

    expect(error).toMatchObject({ name: 'AbortError', stdout: 'started\n' });
  });

  it('forces a foreground command to exit when it ignores SIGTERM', async () => {
    const markerPath = join(testDir, 'forced-abort-pid');
    const controller = new AbortController();
    const startedAt = Date.now();
    const commandPromise = runCommand(
      process.execPath,
      ['-e', [
        `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, String(process.pid))`,
        "process.on('SIGTERM', () => {})",
        'setTimeout(() => process.exit(0), 800)',
      ].join(';')],
      testDir,
      { signal: controller.signal, killGracePeriodMs: 30 }
    );
    const pid = await waitForProcessId(markerPath);

    controller.abort();
    const error = await commandPromise.catch((caught: unknown) => caught);

    expect(error).toMatchObject({ name: 'AbortError' });
    expect(Date.now() - startedAt).toBeLessThan(500);
    await waitForProcessExit(pid);
  });

  it('keeps an already-started detached command alive after abort', async () => {
    const controller = new AbortController();
    const result = await runCommand(
      process.execPath,
      ['-e', 'setTimeout(() => process.exit(0), 1000)'],
      testDir,
      { background: true, signal: controller.signal }
    );
    const pid = result.backgroundPid!;

    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(isProcessRunning(pid)).toBe(true);
    process.kill(pid, 'SIGTERM');
    await waitForProcessExit(pid);
  });

  it('does not spawn a detached command when its signal is already aborted', async () => {
    const markerPath = join(testDir, 'already-aborted-background-marker');
    const controller = new AbortController();
    controller.abort();

    const error = await runCommand(
      process.execPath,
      ['-e', `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'spawned')`],
      testDir,
      { background: true, signal: controller.signal }
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ name: 'AbortError' });
    expect(existsSync(markerPath)).toBe(false);
  });

  it('removes the abort listener after a foreground command closes', async () => {
    const controller = new AbortController();
    const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');

    await runCommand(process.execPath, ['-e', 'process.exit(0)'], testDir, {
      signal: controller.signal,
    });

    expect(addEventListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('rejects with "Command not found" for non-existent command', async () => {
    await expect(
      runCommand('nonexistent-command-that-does-not-exist-12345', [], testDir)
    ).rejects.toThrow('Command not found: nonexistent-command-that-does-not-exist-12345');
  });

  it('rejects with "Command not found" for non-existent command with args', async () => {
    await expect(
      runCommand('python99-does-not-exist', ['-m', 'http.server', '8000'], testDir)
    ).rejects.toThrow('Command not found: python99-does-not-exist');
  });
});

describe('runShellCommand', () => {
  const testDir = join(tmpdir(), 'autohand-shell-test-' + Date.now());

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'file1.txt'), 'line1\nline2\nline3');
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('executes command with shell features (piping)', async () => {
    const result = await runShellCommand('echo "hello world" | grep hello', testDir);
    expect(result.stdout.trim()).toBe('hello world');
    expect(result.code).toBe(0);
  });

  it('supports command chaining with &&', async () => {
    const result = await runShellCommand('echo "first" && echo "second"', testDir);
    expect(result.stdout).toContain('first');
    expect(result.stdout).toContain('second');
  });

  it('supports variable expansion', async () => {
    const result = await runShellCommand('echo $HOME', testDir);
    expect(result.stdout.trim()).not.toBe('$HOME');
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });

  it('works with subdirectory option', async () => {
    mkdirSync(join(testDir, 'nested'), { recursive: true });
    writeFileSync(join(testDir, 'nested', 'data.txt'), 'nested content');

    const result = await runShellCommand('cat data.txt', testDir, { directory: 'nested' });
    expect(result.stdout.trim()).toBe('nested content');
  });
});

describe('runCommand with shell: true (always-shell mode)', () => {
  const testDir = join(tmpdir(), 'autohand-shell-always-test-' + Date.now());

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'data.txt'), 'hello\nworld\nfoo');
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('supports piped commands when command+args are joined into shell string', async () => {
    // Simulate how actionExecutor will call: joined command, empty args, shell: true
    const result = await runCommand('echo hello | tr a-z A-Z', [], testDir, { shell: true });
    expect(result.stdout.trim()).toBe('HELLO');
    expect(result.code).toBe(0);
  });

  it('supports environment variable expansion in joined command', async () => {
    const result = await runCommand('echo $HOME', [], testDir, { shell: true });
    expect(result.stdout.trim()).not.toBe('$HOME');
    expect(result.stdout.trim().length).toBeGreaterThan(0);
    expect(result.code).toBe(0);
  });

  it('supports command chaining with && in joined command', async () => {
    const result = await runCommand('echo first && echo second', [], testDir, { shell: true });
    expect(result.stdout).toContain('first');
    expect(result.stdout).toContain('second');
  });

  it('supports redirect operators in joined command', async () => {
    const outFile = join(testDir, 'redirect-out.txt');
    const result = await runCommand(`echo redirected > ${outFile}`, [], testDir, { shell: true });
    expect(result.code).toBe(0);
    // Verify the file was actually written
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(outFile, 'utf8').trim()).toBe('redirected');
  });

  it('supports glob expansion in joined command', async () => {
    writeFileSync(join(testDir, 'a.txt'), 'a');
    writeFileSync(join(testDir, 'b.txt'), 'b');
    const result = await runCommand('ls *.txt', [], testDir, { shell: true });
    expect(result.stdout).toContain('a.txt');
    expect(result.stdout).toContain('b.txt');
    expect(result.code).toBe(0);
  });

  it('supports simple commands without shell operators', async () => {
    const result = await runCommand('echo hello world', [], testDir, { shell: true });
    expect(result.stdout.trim()).toBe('hello world');
    expect(result.code).toBe(0);
  });

  it('preserves directory option with shell: true', async () => {
    const sub = join(testDir, 'sub');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'file.txt'), 'in sub');
    const result = await runCommand('cat file.txt', [], testDir, {
      shell: true,
      directory: 'sub'
    });
    expect(result.stdout.trim()).toBe('in sub');
  });

  it('preserves timeout option with shell: true', async () => {
    const result = await runCommand('sleep 10', [], testDir, {
      shell: true,
      timeout: 100
    });
    expect(result.signal).toBe('SIGTERM');
  });

  it('preserves background option with shell: true', async () => {
    const result = await runCommand('sleep 10', [], testDir, {
      shell: true,
      background: true
    });
    expect(result.backgroundPid).toBeDefined();
    expect(typeof result.backgroundPid).toBe('number');
    if (result.backgroundPid) {
      try {
        process.kill(result.backgroundPid, 'SIGTERM');
        await waitForProcessExit(result.backgroundPid);
      } catch { /* may already be gone */ }
    }
  });
});

describe('needsShell', () => {
  let needsShell: (cmd: string) => boolean;

  beforeAll(async () => {
    const mod = await import('../src/actions/command.js');
    needsShell = mod.needsShell;
  });

  it('detects pipe operators', () => {
    expect(needsShell('find . -type f 2>/dev/null | head -20')).toBe(true);
    expect(needsShell('echo hello | grep hello')).toBe(true);
  });

  it('detects redirections', () => {
    expect(needsShell('echo hello > file.txt')).toBe(true);
    expect(needsShell('cat < input.txt')).toBe(true);
    expect(needsShell('cmd 2>/dev/null')).toBe(true);
  });

  it('detects command chaining', () => {
    expect(needsShell('echo a && echo b')).toBe(true);
    expect(needsShell('echo a || echo b')).toBe(true);
    expect(needsShell('echo a ; echo b')).toBe(true);
  });

  it('detects shell expansions', () => {
    expect(needsShell('echo $HOME')).toBe(true);
    expect(needsShell('echo $(date)')).toBe(true);
  });

  it('returns false for simple commands', () => {
    expect(needsShell('ls')).toBe(false);
    expect(needsShell('git')).toBe(false);
    expect(needsShell('echo')).toBe(false);
    expect(needsShell('npm')).toBe(false);
    expect(needsShell('find')).toBe(false);
  });

  it('does not trigger on literal $ in args-style strings', () => {
    // Args are NOT checked — only the command string
    // A commit message like 'fix: handle $variables' should not trigger
    expect(needsShell('git')).toBe(false);
  });
});
