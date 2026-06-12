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

describe('config CLI subcommands', () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-config-cli-test-'));
    configPath = path.join(tmpDir, 'config.json');
    await fs.writeJson(configPath, {
      provider: 'openrouter',
      openrouter: { model: 'openai/gpt-4o-mini' },
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
        AUTOHAND_DISABLE_AUTO_REPORT: '1',
      },
    });
    return {
      stdout: (result.stdout ?? '') + (result.stderr ?? ''),
      exitCode: result.status ?? 1,
    };
  }

  it('prints config set usage errors without unhandled rejection reporting', () => {
    const result = runCli('config set provider');

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('Usage: autohand config set <key> <value>');
    expect(result.stdout).not.toContain('Unhandled Rejection');
  });

  it('sets provider API keys without echoing the raw secret', () => {
    const result = runCli('config set openrouter.apiKey sk-openrouter-secret');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Set openrouter.apiKey = ****');
    expect(result.stdout).not.toContain('sk-openrouter-secret');
    expect(fs.readJsonSync(configPath).openrouter.apiKey).toBe('sk-openrouter-secret');
  });

  it('prints invalid config parse errors without unhandled rejection reporting', async () => {
    await fs.writeFile(configPath, '{ provider: openrouter');

    const result = runCli('--permissions');

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('Failed to parse config');
    expect(result.stdout).not.toContain('Unhandled Rejection');
  });
});
