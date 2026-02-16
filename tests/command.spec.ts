/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runCommand, runShellCommand } from '../src/actions/command.js';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

  it('returns exit code for failed command', async () => {
    const result = await runCommand('node', ['-e', 'process.exit(42)'], testDir);
    expect(result.code).toBe(42);
  });

  it('executes in subdirectory when directory option provided', async () => {
    const result = await runCommand('ls', [], testDir, { directory: 'subdir' });
    expect(result.stdout).toContain('test.txt');
    expect(result.code).toBe(0);
  });

  it('injects AUTOHAND_CLI environment variable', async () => {
    const result = await runCommand('node', ['-e', 'console.log(process.env.AUTOHAND_CLI)'], testDir);
    expect(result.stdout.trim()).toBe('1');
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
      } catch {
        // Process may have already exited
      }
    }
  });

  it('supports timeout option', async () => {
    const result = await runCommand('sleep', ['10'], testDir, { timeout: 100 });
    // Should be killed by timeout
    expect(result.signal).toBe('SIGTERM');
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
