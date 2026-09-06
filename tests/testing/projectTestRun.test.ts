/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runProjectTestScript } from '../../src/testing/projectTestRun.js';

describe('project test script evidence', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-test-script-'));
    await fs.writeFile(path.join(workspaceRoot, 'package.json'), JSON.stringify({
      name: 'local-evidence-fixture',
      scripts: {
        test: 'node fixture.cjs',
        fail: 'node -e "process.exit(7)"',
        slow: 'node -e "setTimeout(() => {}, 30000)"',
      },
    }));
    await fs.writeFile(path.join(workspaceRoot, 'fixture.cjs'), 'console.log("fixture passed", ...process.argv.slice(2));');
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('executes a declared script and preserves real exit/log evidence and literal arguments', async () => {
    const result = await runProjectTestScript({ workspaceRoot, script: 'test', args: ['literal;do-not-execute'] });

    expect(result.status).toBe('passed');
    expect(result.exitCode).toBe(0);
    expect(result.visualInspection).toBe('not-run');
    expect(await fs.readFile(result.logPath!, 'utf8')).toContain('fixture passed literal;do-not-execute');
    expect(JSON.parse(await fs.readFile(result.manifestPath, 'utf8'))).toMatchObject({ status: 'passed', script: 'test' });
    if (process.platform !== 'win32') {
      for (const artifact of [result.logPath!, result.manifestPath, result.reportPath]) {
        expect((await fs.stat(artifact)).mode & 0o777).toBe(0o600);
      }
    }
  });

  it('reports failing scripts as failed without rewriting their exit code', async () => {
    const result = await runProjectTestScript({ workspaceRoot, script: 'fail' });
    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(7);
  });

  it('reports undeclared scripts as not-run without executing arbitrary shell input', async () => {
    const result = await runProjectTestScript({ workspaceRoot, script: 'test; touch unsafe' });
    expect(result.status).toBe('not-run');
    expect(result.message).toContain('declared package.json script');
    expect(await fs.readdir(workspaceRoot)).not.toContain('unsafe');
  });

  it('terminates a bounded test run on timeout and preserves a failed report', async () => {
    const result = await runProjectTestScript({ workspaceRoot, script: 'slow', timeoutMs: 300 });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('timed out');
  });

  it('does not start a script when cancellation was already requested', async () => {
    const result = await runProjectTestScript({ workspaceRoot, script: 'test', signal: AbortSignal.abort() });
    expect(result.status).toBe('not-run');
    expect(result.message).toContain('cancelled');
    expect(result.exitCode).toBeNull();
  });

  it('reports unavailable logs as failed evidence even when the script exits zero', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'fixture.cjs'), [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'const root = path.join(process.cwd(), ".autohand", "test-evidence");',
      'const run = fs.readdirSync(root).find(name => name.startsWith("run-"));',
      'fs.mkdirSync(path.join(root, run, "output.log"));',
    ].join('\n'));

    const result = await runProjectTestScript({ workspaceRoot, script: 'test' });

    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(0);
    expect(result.logPath).toBeUndefined();
    expect(result.message).toContain('Could not retain project test evidence');
    expect(JSON.parse(await fs.readFile(result.manifestPath, 'utf8'))).toMatchObject({ status: 'failed', exitCode: 0 });
    expect(await fs.readFile(result.reportPath, 'utf8')).not.toContain('[output.log]');
  });

  it.skipIf(process.platform === 'win32')('does not follow an evidence directory replaced by a symbolic link during a run', async () => {
    const unrelated = path.join(workspaceRoot, 'unrelated');
    await fs.mkdir(unrelated);
    await fs.writeFile(path.join(workspaceRoot, 'fixture.cjs'), [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'const root = path.join(process.cwd(), ".autohand", "test-evidence");',
      'const run = path.join(root, fs.readdirSync(root).find(name => name.startsWith("run-")));',
      'fs.renameSync(run, run + "-original");',
      `fs.symlinkSync(${JSON.stringify(unrelated)}, run, "dir");`,
    ].join('\n'));

    await expect(runProjectTestScript({ workspaceRoot, script: 'test' })).rejects.toThrow('Evidence output cannot traverse symbolic links');

    expect(await fs.readdir(unrelated)).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('cancels a slow-starting process group even when its test process ignores SIGTERM', async () => {
    const pidPath = path.join(workspaceRoot, 'running.pid');
    await fs.writeFile(path.join(workspaceRoot, 'fixture.cjs'), [
      'setTimeout(() => {',
      'process.on("SIGTERM", () => {});',
      `require("node:fs").writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));`,
      'console.log("test process started");',
      'setInterval(() => {}, 1000);',
      '}, 1_200);',
    ].join('\n'));
    const controller = new AbortController();
    const run = runProjectTestScript({ workspaceRoot, script: 'test', signal: controller.signal });
    try {
      await vi.waitFor(async () => expect(await fs.readFile(pidPath, 'utf8')).toMatch(/^\d+$/), { timeout: 10_000 });
    } finally {
      controller.abort();
      await run;
    }

    const result = await run;
    const pid = Number(await fs.readFile(pidPath, 'utf8'));
    expect(result.status).toBe('failed');
    expect(result.message).toContain('cancelled');
    expect(await fs.readFile(result.logPath!, 'utf8')).toContain('test process started');
    expect(() => process.kill(pid, 0)).toThrow();
  });
});
