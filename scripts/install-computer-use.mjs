#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const COMPUTER_INSTALL_ARGS = [
  'computer',
  'install',
  '--non-interactive',
  '--postinstall',
  '--bin-dir',
  'vendor',
];

function runComputerUseCli({ entrypoint, packageRoot, environment }) {
  const help = spawnSync(process.execPath, [entrypoint, '--help'], {
    cwd: packageRoot, env: environment, encoding: 'utf8', windowsHide: true,
    timeout: 30_000,
  });
  if (help.status !== 0 || !/^\s+computer(?:\s|$)/m.test(help.stdout ?? '')) {
    return { status: 'skipped-unsupported' };
  }
  const result = spawnSync(process.execPath, [entrypoint, ...COMPUTER_INSTALL_ARGS], {
    cwd: packageRoot,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const outcome = result.signal ? `signal ${result.signal}` : `code ${result.status ?? 'unknown'}`;
    throw new Error(`Autohand Computer Use postinstall exited with ${outcome}.`);
  }
}

export async function installComputerUsePostinstall(options = {}) {
  const packageRoot = options.packageRoot
    ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const environment = options.environment ?? process.env;
  if (environment.AUTOHAND_SKIP_COMPUTER_CONTROL_INSTALL === '1') {
    return { status: 'skipped-disabled' };
  }
  const sourceCheckout = existsSync(path.join(packageRoot, '.git'));
  const forceSourceInstall = environment.AUTOHAND_INSTALL_COMPUTER_USE === '1'
    || environment.AUTOHAND_INSTALL_CUA_DRIVER === '1';
  if (sourceCheckout && !forceSourceInstall) {
    return { status: 'skipped-development' };
  }

  const entrypoint = path.join(packageRoot, 'dist', 'index.js');
  if (!existsSync(entrypoint)) {
    throw new Error(
      sourceCheckout
        ? 'Build Autohand before forcing the computer-use postinstall in a source checkout.'
        : 'The Autohand package is missing dist/index.js. Reinstall autohand-cli.',
    );
  }

  const runCli = options.runCli ?? runComputerUseCli;
  try {
    const result = await runCli({ entrypoint, packageRoot, environment });
    return result ?? { status: 'completed' };
  } catch (error) {
    const warn = options.warn ?? console.warn;
    warn(`Warning: Optional Computer control could not be installed. Autohand CLI is ready. ${error instanceof Error ? error.message : String(error)}`);
    return { status: 'failed-optional' };
  }
}

function isMainModule() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isMainModule()) {
  installComputerUsePostinstall().then((result) => {
    if (result.status === 'skipped-unsupported') {
      console.log('Computer control arrives in the next release');
    }
    if (result.status === 'skipped-development') {
      console.log(
        'Skipping Autohand Computer Use postinstall in a source checkout. '
        + 'Set AUTOHAND_INSTALL_COMPUTER_USE=1 to install it after building.',
      );
    }
  }).catch((error) => {
    console.error(
      `Could not install Autohand Computer Use: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
