/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for experiment CLI subcommands (autohand experiments list/enable/disable/status)
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

describe('experiments CLI subcommands', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-experiments-test-'));
    configPath = path.join(tmpDir, 'config.json');
    await fs.ensureDir(tmpDir);
    await fs.writeJson(configPath, {
      provider: 'openrouter',
      openrouter: { apiKey: 'test-key' },
      api: { baseUrl: 'http://127.0.0.1:9' },
      mcp: { enabled: false, servers: [] },
    });
    await fs.writeJson(path.join(tmpDir, 'feature-flags.json'), {
      success: true,
      environment: 'production',
      evaluatedAt: new Date().toISOString(),
      ttlSeconds: 300,
      flags: [{
        key: 'remote_search',
        enabled: true,
        reason: 'match',
        userOverridable: true,
      }],
    });
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  function runCli(args: string): { stdout: string; exitCode: number } {
    const runnerArgs = USES_BUN
      ? [CLI_ENTRY, ...args.trim().split(/\s+/)]
      : ['--import', TSX_LOADER, CLI_ENTRY, ...args.trim().split(/\s+/)];
    const result = spawnSync(process.execPath, runnerArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 25_000,
      env: {
        ...process.env,
        AUTOHAND_HOME: tmpDir,
        AUTOHAND_CONFIG: configPath,
      },
    });
    return {
      stdout: (result.stdout ?? '') + (result.stderr ?? ''),
      exitCode: result.status ?? 1,
    };
  }

  it('lists experiment states', () => {
    const result = runCli('experiments list');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('mcp');
    expect(result.stdout).toContain('false');
    expect(result.stdout).toContain('prompt_suggestions');
    expect(result.stdout).toContain('remote_search');
  });

  it('enables and disables a feature in config', () => {
    const enable = runCli('experiments enable mcp');
    expect(enable.exitCode).toBe(0);
    expect(enable.stdout).toContain('Enabled mcp');
    expect(fs.readJsonSync(configPath).mcp.enabled).toBe(true);

    const disable = runCli('experiments disable mcp');
    expect(disable.exitCode).toBe(0);
    expect(disable.stdout).toContain('Disabled mcp');
    expect(fs.readJsonSync(configPath).mcp.enabled).toBe(false);
  });

  it('shows one feature status', () => {
    const result = runCli('experiments status mcp');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('mcp');
    expect(result.stdout).toContain('Enabled: false');
  });

  it('does not register the removed features compatibility command', () => {
    const result = runCli('features status mcp');

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain('Enabled:');
  });
});
