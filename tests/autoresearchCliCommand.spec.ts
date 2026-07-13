/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..');
const CLI_ENTRY = path.join(ROOT, 'src/index.ts');
const TSX_LOADER = path.join(ROOT, 'node_modules/tsx/dist/loader.mjs');
const USES_BUN = process.execPath.includes('bun');

describe('auto-research CLI subcommands', () => {
  let tmpDir: string;
  let workspaceRoot: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-autoresearch-cli-'));
    workspaceRoot = path.join(tmpDir, 'workspace');
    configPath = path.join(tmpDir, 'config.json');
    await fs.ensureDir(workspaceRoot);
    await fs.writeJson(configPath, {
      provider: 'openrouter',
      openrouter: { apiKey: 'test-key' },
      mcp: { enabled: false, servers: [] },
      sync: { enabled: false },
      ui: { checkForUpdates: false },
    });
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  function runCli(args: string[]): { stdout: string; exitCode: number } {
    const runnerArgs = USES_BUN
      ? [CLI_ENTRY, ...args]
      : ['--import', TSX_LOADER, CLI_ENTRY, ...args];
    const result = spawnSync(process.execPath, runnerArgs, {
      cwd: workspaceRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
      env: {
        ...process.env,
        AUTOHAND_HOME: tmpDir,
        AUTOHAND_CONFIG: configPath,
        AUTOHAND_DISABLE_AUTO_REPORT: '1',
        AUTOHAND_NO_BANNER: '1',
      },
    });

    return {
      stdout: (result.stdout ?? '') + (result.stderr ?? ''),
      exitCode: result.status ?? 1,
    };
  }

  it('runs the hyphenated and no-hyphen aliases through the same non-interactive session state', async () => {
    const start = runCli([
      'auto-research',
      'optimize',
      'test',
      'runtime',
      '--metric',
      'total_ms',
      '--unit',
      'ms',
      '--direction',
      'lower',
      '--measure',
      'echo "METRIC total_ms=42"',
      '--max-iterations',
      '4',
    ]);

    expect(start.exitCode).toBe(0);
    expect(start.stdout).toContain('Auto-research session started');
    expect(start.stdout).toContain('Loop instruction');
    expect(start.stdout).toContain('Initialized benchmark config from command options.');

    const status = runCli(['autoresearch', 'status']);

    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain('Session: optimize test runtime');
    expect(status.stdout).toContain('Metric: total_ms (ms)');
    expect(status.stdout).toContain('Iterations: 0 / 4');

    const off = runCli(['autoresearch', 'off']);

    expect(off.exitCode).toBe(0);
    expect(off.stdout).toContain('Auto-research session paused');

    await fs.writeFile(
      path.join(workspaceRoot, '.auto', 'log.jsonl'),
      `${JSON.stringify({
        run: 1,
        status: 'kept',
        metric: 42,
        description: 'baseline',
        commit: 'abc123',
        timestamp: '2026-07-08T00:00:00.000Z',
      })}\n`
    );

    const exported = runCli(['autoresearch', 'export']);

    expect(exported.exitCode).toBe(0);
    expect(exported.stdout).toContain('Dashboard exported');
    expect(await fs.pathExists(path.join(workspaceRoot, '.auto', 'dashboard.html'))).toBe(true);

    const finalized = runCli(['autoresearch', 'finalize']);

    expect(finalized.exitCode).toBe(0);
    expect(finalized.stdout).toContain('Finalize plan written');
    expect(await fs.pathExists(path.join(workspaceRoot, '.auto', 'finalize.md'))).toBe(true);
    expect(await fs.pathExists(path.join(workspaceRoot, '.auto', 'finalize-branches.json'))).toBe(true);

    const cleared = runCli(['autoresearch', 'clear', '--yes']);

    expect(cleared.exitCode).toBe(0);
    expect(cleared.stdout).toContain('Auto-research session cleared');
    expect(await fs.pathExists(path.join(workspaceRoot, '.auto', 'state.json'))).toBe(false);

    const noHyphenStart = runCli(['autoresearch', 'optimize', 'bundle', 'size']);

    expect(noHyphenStart.exitCode).toBe(0);
    expect(noHyphenStart.stdout).toContain('Auto-research session started: optimize bundle size');
    expect(noHyphenStart.stdout).toContain('Loop instruction');

    const state = await fs.readJson(path.join(workspaceRoot, '.auto', 'state.json'));
    expect(state).toEqual(expect.objectContaining({
      active: true,
      goal: 'optimize bundle size',
    }));
  });
});
