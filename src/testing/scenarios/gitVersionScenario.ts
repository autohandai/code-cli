/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function createStalledGitVersionPreload(directory: string): Promise<string> {
  const preload = path.join(directory, 'stalled-git-version.mjs');
  await writeFile(preload, `
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const execFileSync = childProcess.execFileSync;
const execSync = childProcess.execSync;
function stalledGit(args, options) {
  const output = args[0] === 'tag' ? 'v999.0.0\\n' : 'abcdef0123456\\n';
  return execFileSync(process.execPath, [
    '--eval',
    'process.on("SIGTERM", () => {}); setTimeout(() => process.stdout.write(process.argv[1]), 4000);',
    output,
  ], options);
}
childProcess.execFileSync = function(file, args, options) {
  if (file === 'git') return stalledGit(args, options);
  return execFileSync(file, args, options);
};
childProcess.execSync = function(command, options) {
  if (command === 'git rev-parse --short HEAD') return stalledGit(['rev-parse'], options);
  return execSync(command, options);
};
syncBuiltinESMExports();
`);
  return `--import=${pathToFileURL(preload).href}`;
}
