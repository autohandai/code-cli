#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveInstalledAhTracesPath } from './install-ahtraces.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configuredExecutable = process.env.AUTOHAND_AHTRACES_EXECUTABLE?.trim()
  || process.env.AUTOHAND_TRACES_PATH?.trim();
const executable = configuredExecutable || resolveInstalledAhTracesPath(packageRoot);

if (!configuredExecutable && !existsSync(executable)) {
  console.error(
    'ahtraces is not installed. Reinstall autohand-cli without --ignore-scripts, '
    + 'or install a native Autohand release.',
  );
  process.exitCode = 1;
} else {
  const child = spawn(executable, process.argv.slice(2), {
    stdio: 'inherit',
    windowsHide: true,
  });
  child.once('error', (error) => {
    console.error(`Could not start ahtraces: ${error.message}`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}
