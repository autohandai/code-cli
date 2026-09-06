/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Command } from 'commander';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config.js';
import discoveryWorkerSource from './workerSource.js';

type DiscoveryOptions = { workspace?: string; json?: boolean; dryRun?: boolean; select?: string };
type RootOptions = { config?: string; path?: string; dir?: string; json?: string | boolean; dryRun?: boolean };

export function isDiscoveryInvocation(program: Command, argv: string[]): boolean {
  for (let index = 2; index < argv.length; index++) {
    const value = argv[index];
    if (value === '--') return argv[index + 1] === 'discovery';
    if (!value.startsWith('-')) return value === 'discovery';
    const option = program.options.find((item) => item.long === value.split('=')[0] || item.short === value);
    if (!option) return false;
    if (!value.includes('=') && (option.required || option.optional) && argv[index + 1] && !argv[index + 1].startsWith('-')) index++;
  }
  return false;
}

export function registerDiscoveryCommand(program: Command): void {
  program.command('discovery [action]')
    .description('Discover repository workflows locally; list or push drafts to Build my agent')
    .option('--workspace <path>', 'Repository to scan (defaults to --path or the current directory)')
    .option('--json', 'Emit machine-readable results')
    .option('--dry-run', 'Preview without writing files or uploading workflows')
    .option('--select <id,id>', 'List or push selected local workflow IDs')
    .addHelpText('after', '\nActions: scan (default), list, push\n\nExamples:\n  autohand discovery\n  autohand discovery push --dry-run\n  autohand discovery push --select repository-onboarding,ci-diagnosis\n\nScan and list work offline. Push reuses AUTOHAND_API_KEY or your stored Autohand credential.\n')
    .action(async (action: string | undefined, options: DiscoveryOptions) => {
      const mode = action ?? 'scan';
      if (!['scan', 'list', 'push'].includes(mode)) throw new Error('Use autohand discovery, discovery list, or discovery push.');
      const root = program.opts<RootOptions>();
      const workspace = options.workspace ?? root.path ?? root.dir ?? process.cwd();
      const dryRun = options.dryRun || root.dryRun;
      const args = [mode, '--workspace', workspace,
        ...(options.json || root.json !== undefined ? ['--json'] : []),
        ...(dryRun ? ['--dry-run'] : []),
        ...(options.select ? ['--select', options.select] : []),
      ];
      if (process.env.AUTOHAND_DISCOVERY_CHILD === '1') {
        await runEmbeddedDiscovery(args);
        return;
      }
      let credential: string | undefined;
      if (mode === 'push' && !dryRun) {
        credential = process.env.AUTOHAND_API_KEY?.trim();
        if (!credential) {
          const config = await loadConfig(root.config, undefined, { createIfMissing: false, initializeTheme: false });
          credential = config.auth?.token;
        }
      }
      process.exitCode = await spawnDiscoveryProcess(args, credential);
    });
}

export function discoveryProcessArguments(args: string[], entry = process.argv[1], execArgs = process.execArgv): string[] {
  if (!entry) throw new Error('Could not locate the Autohand executable.');
  const compiled = entry.includes('$bunfs');
  return [...(compiled ? [] : [...execArgs, entry]), 'discovery', ...args];
}

export async function spawnDiscoveryProcess(args: string[], credential?: string): Promise<number> {
  const environment: NodeJS.ProcessEnv = { ...process.env, AUTOHAND_DISCOVERY_CHILD: '1' };
  delete environment.AUTOHAND_API_KEY;
  if (credential) environment.AUTOHAND_API_KEY = credential;
  const child = spawn(process.execPath, discoveryProcessArguments(args), {
    cwd: process.cwd(), env: environment, stdio: 'inherit', shell: false,
  });
  let cancelled: NodeJS.Signals | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const cancel = (signal: NodeJS.Signals) => {
    if (cancelled) return;
    cancelled = signal;
    child.kill(signal);
    deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
    deadline.unref();
  };
  const interrupt = () => cancel('SIGINT');
  const terminate = () => cancel('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    return await new Promise<number>((resolve, reject) => {
      child.once('error', () => reject(new Error('Could not start the discovery subprocess. Check your Autohand installation.')));
      child.once('close', (code, signal) => resolve(cancelled === 'SIGINT' || signal === 'SIGINT' ? 130 : cancelled === 'SIGTERM' || signal === 'SIGTERM' ? 143 : code ?? 1));
    });
  } finally {
    if (deadline) clearTimeout(deadline);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
}

async function runEmbeddedDiscovery(args: string[]): Promise<void> {
  const temporary = await mkdtemp(path.join(tmpdir(), 'autohand-discovery-worker-'));
  const previous = process.argv;
  try {
    const file = path.join(temporary, 'discovery.mjs');
    await writeFile(file, discoveryWorkerSource, { flag: 'wx', mode: 0o600 });
    process.argv = [process.execPath, file, ...args];
    await import(pathToFileURL(file).href);
  } finally {
    process.argv = previous;
    await rm(temporary, { recursive: true, force: true });
  }
}
