/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { killProcessGroup, runCommand } from '../../src/actions/command.js';

function nodeShellCommand(script: string): string {
  const executable = process.platform === 'win32'
    ? `"${process.execPath.replace(/"/g, '""')}"`
    : `'${process.execPath.replace(/'/g, `'\\''`)}'`;
  const encodedScript = Buffer.from(script, 'utf8').toString('base64');
  const launcher = `eval(Buffer.from('${encodedScript}','base64').toString('utf8'))`;
  return `${executable} -e "${launcher}"`;
}

async function waitForProcessExit(pid: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Process ${pid} did not exit within ${timeoutMs}ms`);
}

describe('killProcessGroup', () => {
  const testDir = join(tmpdir(), 'autohand-kill-process-group-test-' + Date.now());

  it('terminates a real detached background process', async () => {
    mkdirSync(testDir, { recursive: true });
    try {
      const result = await runCommand(
        nodeShellCommand('setInterval(() => {}, 1000)'),
        [],
        testDir,
        { shell: true, background: true },
      );

      expect(result.backgroundPid).toBeGreaterThan(0);
      const pid = result.backgroundPid!;

      // Still running before we kill it.
      expect(() => process.kill(pid, 0)).not.toThrow();

      await killProcessGroup(pid, 50);
      await waitForProcessExit(pid);

      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('does not throw when the process is already gone', async () => {
    // A PID essentially guaranteed not to exist.
    await expect(killProcessGroup(999_999, 10)).resolves.toBeUndefined();
  });

  it('falls back to a direct kill when the pid is not a process-group leader', async () => {
    // A non-detached child inherits the parent's process group rather than
    // becoming its own group leader, so process.kill(-pid, signal) throws
    // (no such process group) while process.kill(pid, signal) succeeds —
    // this proves the fallback path added for Windows compatibility.
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve());
      child.once('error', reject);
    });
    const pid = child.pid!;

    try {
      expect(() => process.kill(pid, 0)).not.toThrow();

      await killProcessGroup(pid, 50);
      await waitForProcessExit(pid);

      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  });
});
