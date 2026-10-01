/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installComputerUsePostinstall } from '../scripts/install-computer-use.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('computer control installation integration', () => {
  it.runIf(process.platform !== 'win32')('fails the Unix installer when the required component fails', async () => {
    const script = await readFile('install.sh', 'utf8');
    const functionSource = script.slice(script.indexOf('install_computer_control() {'), script.indexOf('\nmain() {'));
    const result = spawnSync('/bin/sh', ['-c', [
      'info() { echo "$*"; }', 'warn() { echo "$*"; }', 'success() { echo "$*"; }',
      functionSource, 'install_computer_control /usr/bin/false',
    ].join('\n')], { encoding: 'utf8', env: { ...process.env, AUTOHAND_SKIP_COMPUTER_CONTROL_INSTALL: '0' } });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('autohand computer install');
    expect(result.stdout).not.toContain('still ready');
  });

  it('allows an explicit headless opt-out before npm postinstall', async () => {
    const runCli = vi.fn();
    await expect(installComputerUsePostinstall({
      packageRoot: '/fixture-without-cli', environment: { AUTOHAND_SKIP_COMPUTER_CONTROL_INSTALL: '1' }, runCli,
    })).resolves.toEqual({ status: 'skipped-disabled' });
    expect(runCli).not.toHaveBeenCalled();
  });

  it('installs native computer control and the branded macOS permission host after Autohand', async () => {
    const script = await readFile('install.sh', 'utf8');
    expect(script).toContain('install_computer_control');
    expect(script).toContain('computer install --non-interactive');
    expect(script).not.toContain('computer install --non-interactive --bin-dir');
    expect(script).toContain('Computer control');
    expect(script).toContain('Autohand Computer Use.app');
    expect(script).toContain('AUTOHAND_COMPUTER_USE_APP_SOURCE');
    expect(script).toContain('Autohand Computer Use is ready');
  });

  it('installs computer use into its Autohand-owned Windows directory', async () => {
    const script = await readFile('install.ps1', 'utf8');
    expect(script).toContain('Install-ComputerControl');
    expect(script).toContain('computer install --non-interactive');
    expect(script).not.toContain('computer install --non-interactive --bin-dir');
    expect(script).toContain('Computer control');
  });

  it('includes computer control in published npm installation', async () => {
    const manifest = JSON.parse(await readFile('package.json', 'utf8')) as {
      files: string[];
      scripts: { postinstall: string };
    };
    expect(manifest.scripts.postinstall).toContain('node scripts/install-computer-use.mjs');
    expect(manifest.files).toContain('scripts/install-computer-use.mjs');
    expect(manifest.files).toContain('docs/computer-control.md');
    expect(manifest.files).toContain('native/macos/prebuilt');
  });

  it('skips computer control postinstall in an unbuilt source checkout', async () => {
    const packageRoot = await mkdtemp(path.join(tmpdir(), 'autohand-computer-postinstall-'));
    temporaryDirectories.push(packageRoot);
    await mkdir(path.join(packageRoot, '.git'));
    const runCli = vi.fn();

    await expect(installComputerUsePostinstall({ packageRoot, runCli })).resolves.toEqual({
      status: 'skipped-development',
    });
    expect(runCli).not.toHaveBeenCalled();
  });

  it('runs the built computer control command for a published package', async () => {
    const packageRoot = await mkdtemp(path.join(tmpdir(), 'autohand-computer-postinstall-'));
    temporaryDirectories.push(packageRoot);
    const distDirectory = path.join(packageRoot, 'dist');
    await mkdir(distDirectory);
    await writeFile(path.join(distDirectory, 'index.js'), [
      "const expected = ['computer', 'install', '--non-interactive', '--postinstall', '--bin-dir', 'vendor'];",
      'if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expected)) process.exit(2);',
    ].join('\n'));

    await expect(installComputerUsePostinstall({ packageRoot })).resolves.toEqual({
      status: 'completed',
    });
  });

  it('rejects a published package that is missing its built CLI', async () => {
    const packageRoot = await mkdtemp(path.join(tmpdir(), 'autohand-computer-postinstall-'));
    temporaryDirectories.push(packageRoot);

    await expect(installComputerUsePostinstall({ packageRoot })).rejects.toThrow(
      'The Autohand package is missing dist/index.js',
    );
  });
});
