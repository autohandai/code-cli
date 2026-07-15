/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawnSync } from 'node:child_process';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const CLI_ENTRY = path.join(ROOT, 'src/index.ts');
const TSX_LOADER = path.join(ROOT, 'node_modules/tsx/dist/loader.mjs');
const USES_BUN = process.execPath.includes('bun');
const EXAMPLES_ROOT = path.join(ROOT, 'examples', 'extensions');
const EXAMPLE_IDS = [
  'autohand.code-health',
  'autohand.git-insights',
  'autohand.release-assistant',
  'autohand.security-audit',
  'autohand.test-triage',
] as const;

describe('extensions CLI command', () => {
  let tempRoot: string;
  let workspaceRoot: string;
  let sourceRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-extensions-cli-'));
    workspaceRoot = path.join(tempRoot, 'workspace');
    sourceRoot = path.join(tempRoot, 'source');
    await fs.ensureDir(workspaceRoot);
    await fs.ensureDir(path.join(sourceRoot, 'tools'));
    await fs.writeJson(path.join(sourceRoot, 'autohand.extension.json'), {
      schemaVersion: 1,
      extensionApi: 1,
      id: 'autohand.git-insights',
      name: 'Git Insights',
      version: '1.0.0',
      description: 'Inspect repository history.',
      contributes: { tools: ['tools/recent-history.json'] },
    });
    await fs.writeJson(path.join(sourceRoot, 'tools', 'recent-history.json'), {
      name: 'recent_history',
      description: 'Show recent commits',
      parameters: { type: 'object', properties: {} },
      handler: 'git log -10 --oneline',
      source: 'user',
    });
  });

  afterEach(async () => {
    await fs.remove(tempRoot);
  });

  function runCli(args: string[]) {
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
        AUTOHAND_HOME: path.join(tempRoot, 'home'),
        AUTOHAND_DISABLE_AUTO_REPORT: '1',
        AUTOHAND_NO_BANNER: '1',
      },
    });
    return {
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
      code: result.status ?? 1,
    };
  }

  it('renders the complete extension lifecycle help tree', () => {
    const result = runCli(['extensions', '--help']);

    expect(result.code).toBe(0);
    expect(result.output).toContain('validate');
    expect(result.output).toContain('install');
    expect(result.output).toContain('enable');
    expect(result.output).toContain('disable');
    expect(result.output).toContain('remove');
    expect(result.output).toContain('doctor');
  });

  it('validates, installs, inspects, disables, enables, and removes across fresh processes', () => {
    const validated = runCli(['extensions', 'validate', sourceRoot, '--json']);
    expect(validated.code).toBe(0);
    expect(JSON.parse(validated.output)).toMatchObject({ valid: true, id: 'autohand.git-insights' });

    const installed = runCli(['extensions', 'install', sourceRoot]);
    expect(installed).toMatchObject({ code: 0 });
    expect(installed.output).toContain('Installed autohand.git-insights@1.0.0');

    const listed = runCli(['extensions', 'list', '--json']);
    expect(listed.code).toBe(0);
    expect(JSON.parse(listed.output).extensions).toEqual([
      expect.objectContaining({ id: 'autohand.git-insights', disabled: false, tools: ['recent_history'] }),
    ]);

    const shown = runCli(['extensions', 'show', 'autohand.git-insights']);
    expect(shown.code).toBe(0);
    expect(shown.output).toContain('Tools: recent_history');

    expect(runCli(['extensions', 'disable', 'autohand.git-insights']).code).toBe(0);
    expect(JSON.parse(runCli(['extensions', 'list', '--json']).output).extensions[0].disabled).toBe(true);
    expect(runCli(['extensions', 'enable', 'autohand.git-insights']).code).toBe(0);

    const refused = runCli(['extensions', 'remove', 'autohand.git-insights']);
    expect(refused.code).toBe(1);
    expect(refused.output).toMatch(/requires --yes/i);
    const removed = runCli(['extensions', 'remove', 'autohand.git-insights', '--yes']);
    expect(removed, removed.output).toMatchObject({ code: 0 });
    expect(JSON.parse(runCli(['extensions', 'list', '--json']).output).extensions).toEqual([]);
  });

  it('installs project scope under the selected workspace', async () => {
    const result = runCli([
      '--path',
      workspaceRoot,
      'extensions',
      'install',
      sourceRoot,
      '--scope',
      'project',
    ]);

    expect(result.code).toBe(0);
    expect(await fs.pathExists(path.join(
      workspaceRoot,
      '.autohand',
      'extensions',
      'autohand.git-insights',
      'autohand.extension.json',
    ))).toBe(true);
  });

  it('validates and runs the full fresh-process lifecycle for all five public examples', () => {
    for (const id of EXAMPLE_IDS) {
      const source = path.join(EXAMPLES_ROOT, id);
      const validated = runCli(['extensions', 'validate', source, '--json']);
      expect(validated, validated.output).toMatchObject({ code: 0 });
      expect(JSON.parse(validated.output)).toMatchObject({ valid: true, id });

      const installed = runCli(['extensions', 'install', source]);
      expect(installed, installed.output).toMatchObject({ code: 0 });
    }

    const installed = JSON.parse(runCli(['extensions', 'list', '--json']).output) as {
      extensions: Array<{ id: string; disabled: boolean }>;
    };
    expect(installed.extensions.map((extension) => extension.id)).toEqual(EXAMPLE_IDS);

    for (const id of EXAMPLE_IDS) {
      const disabled = runCli(['extensions', 'disable', id]);
      expect(disabled, disabled.output).toMatchObject({ code: 0 });
      const disabledState = JSON.parse(runCli(['extensions', 'show', id, '--json']).output) as {
        disabled: boolean;
      };
      expect(disabledState.disabled).toBe(true);

      const enabled = runCli(['extensions', 'enable', id]);
      expect(enabled, enabled.output).toMatchObject({ code: 0 });
      const removed = runCli(['extensions', 'remove', id, '--yes']);
      expect(removed, removed.output).toMatchObject({ code: 0 });
    }

    expect(JSON.parse(runCli(['extensions', 'list', '--json']).output).extensions).toEqual([]);
  }, 120_000);
});
