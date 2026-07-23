/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  executeStreamingShellCommand,
  type BackgroundProcessCompletion,
} from '../../src/ui/shellCommand.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';

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

function nodeShellCommand(script: string): string {
  const executable = process.platform === 'win32'
    ? `"${process.execPath.replace(/"/g, '""')}"`
    : `'${process.execPath.replace(/'/g, `'\\''`)}'`;
  const encodedScript = Buffer.from(script, 'utf8').toString('base64');
  const launcher = `eval(Buffer.from('${encodedScript}','base64').toString('utf8'))`;
  return `${executable} -e "${launcher}"`;
}

describe('executeStreamingShellCommand background mode', () => {
  const testDir = join(tmpdir(), 'autohand-shell-bg-test-' + Date.now());

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should return immediately with backgroundPid when background: true', async () => {
    let resolveCompletion!: (completion: BackgroundProcessCompletion) => void;
    const completionPromise = new Promise<BackgroundProcessCompletion>((resolve) => {
      resolveCompletion = resolve;
    });
    const result = await executeStreamingShellCommand(
      nodeShellCommand('setTimeout(() => process.exit(0), 250)'),
      testDir,
      { background: true, onBackgroundExit: resolveCompletion }
    );

    expect(result.success).toBe(true);
    expect(result.backgroundPid).toBeDefined();
    expect(result.backgroundPid).toBeGreaterThan(0);
    expect(result.output).toBe('');
    await expect(waitForDetachedCompletion(completionPromise)).resolves.toEqual({
      code: 0,
      signal: null,
    });
  });

  it('should run command in background and allow parent to continue', async () => {
    let resolveCompletion!: (completion: BackgroundProcessCompletion) => void;
    const completionPromise = new Promise<BackgroundProcessCompletion>((resolve) => {
      resolveCompletion = resolve;
    });
    const start = Date.now();
    
    const result = await executeStreamingShellCommand(
      nodeShellCommand('setTimeout(() => process.exit(0), 1500)'),
      testDir,
      { background: true, onBackgroundExit: resolveCompletion }
    );

    const elapsed = Date.now() - start;
    
    // Spawn confirmation must not wait for the five-second command to finish.
    expect(elapsed).toBeLessThan(1_000);
    expect(result.success).toBe(true);
    expect(result.backgroundPid).toBeDefined();
    await expect(waitForDetachedCompletion(completionPromise, 3_000)).resolves.toEqual({
      code: 0,
      signal: null,
    });
  });

  it('should handle invalid commands gracefully in background mode', async () => {
    const result = await executeStreamingShellCommand(
      'nonexistentcommand12345',
      testDir,
      { background: true }
    );

    // Background mode spawns the shell, so it succeeds even if command fails
    expect(result.success).toBe(true);
    expect(result.backgroundPid).toBeDefined();
  });

  it('streams detached stdout and stderr before reporting completion once', async () => {
    let stdout = '';
    let stderr = '';
    let resolveCompletion!: (completion: BackgroundProcessCompletion) => void;
    const completionPromise = new Promise<BackgroundProcessCompletion>((resolve) => {
      resolveCompletion = resolve;
    });
    const onBackgroundExit = vi.fn(resolveCompletion);
    const script = [
      "process.stdout.write('shell stdout\\n')",
      "process.stderr.write('shell stderr\\n')",
      'setTimeout(() => process.exit(9), 30)',
    ].join(';');

    const result = await executeStreamingShellCommand(
      nodeShellCommand(script),
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

    expect(result).toMatchObject({ success: true, output: '' });
    expect(result.backgroundPid).toBeGreaterThan(0);
    await expect(waitForDetachedCompletion(completionPromise)).resolves.toEqual({
      code: 9,
      signal: null,
    });
    expect(stdout).toBe('shell stdout\n');
    expect(stderr).toBe('shell stderr\n');
    expect(onBackgroundExit).toHaveBeenCalledTimes(1);
  });

  it('reports detached shell spawn errors once without an unhandled error event', async () => {
    let resolveCompletion!: (completion: BackgroundProcessCompletion) => void;
    const completionPromise = new Promise<BackgroundProcessCompletion>((resolve) => {
      resolveCompletion = resolve;
    });
    const onBackgroundExit = vi.fn(resolveCompletion);

    const missingDirectory = join(testDir, 'missing-directory');
    const result = await executeStreamingShellCommand('echo unreachable', missingDirectory, {
      background: true,
      onBackgroundExit,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(`Working directory not found: ${missingDirectory}`);
    expect(result.backgroundPid).toBeUndefined();
    const completion = await waitForDetachedCompletion(completionPromise);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(completion).toMatchObject({ code: null, signal: null });
    expect(completion.error?.message).toBe(`Working directory not found: ${missingDirectory}`);
    expect(onBackgroundExit).toHaveBeenCalledTimes(1);
  });

  it('keeps streaming after a detached shell command signal is aborted later', async () => {
    const controller = new AbortController();
    let stdout = '';
    let resolveCompletion!: (completion: BackgroundProcessCompletion) => void;
    const completionPromise = new Promise<BackgroundProcessCompletion>((resolve) => {
      resolveCompletion = resolve;
    });
    const script = "setTimeout(() => process.stdout.write('shell after abort\\n'), 30); setTimeout(() => process.exit(0), 50)";

    const result = await executeStreamingShellCommand(
      nodeShellCommand(script),
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
    expect(stdout).toBe('shell after abort\n');
  });

  it('drains high-volume detached shell output without blocking completion', async () => {
    let resolveCompletion!: (completion: BackgroundProcessCompletion) => void;
    const completionPromise = new Promise<BackgroundProcessCompletion>((resolve) => {
      resolveCompletion = resolve;
    });
    const bytesPerStream = 512 * 1024;
    const script = [
      `process.stdout.write('o'.repeat(${bytesPerStream}))`,
      `process.stderr.write('e'.repeat(${bytesPerStream}))`,
    ].join(';');

    const result = await executeStreamingShellCommand(
      nodeShellCommand(script),
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

  it.skipIf(process.platform === 'win32')('reports the terminating signal for a detached shell command', async () => {
    let resolveCompletion!: (completion: BackgroundProcessCompletion) => void;
    const completionPromise = new Promise<BackgroundProcessCompletion>((resolve) => {
      resolveCompletion = resolve;
    });
    const result = await executeStreamingShellCommand(
      nodeShellCommand('setInterval(() => undefined, 1000)'),
      testDir,
      { background: true, onBackgroundExit: resolveCompletion }
    );

    process.kill(result.backgroundPid!, 'SIGTERM');

    await expect(waitForDetachedCompletion(completionPromise)).resolves.toEqual({
      code: null,
      signal: 'SIGTERM',
    });
  });
});
