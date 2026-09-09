/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Command } from 'commander';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config.js';
import discoveryWorkerSource from './workerSource.js';
import { FFFSearchProvider } from '../search/fffSearchProvider.js';
import { getUserSkillLocations } from '../constants.js';
import { createDiscoveryAnalyzer } from './analysis.js';
import { createDiscoveryProgress } from './progress.js';
import type { DiscoveryProgressEvent } from './DiscoveryProgress.js';

type DiscoveryOptions = {
  workspace?: string;
  json?: boolean;
  dryRun?: boolean;
  select?: string;
  depth?: string;
  skillQuery?: string;
  behavior?: boolean;
  github?: boolean;
  analyze?: boolean;
  withReport?: boolean;
  push?: boolean;
};
type RootOptions = {
  config?: string;
  path?: string;
  dir?: string;
  json?: string | boolean;
  dryRun?: boolean;
};

export function isDiscoveryInvocation(
  program: Command,
  argv: string[]
): boolean {
  for (let index = 2; index < argv.length; index++) {
    const value = argv[index];
    if (value === '--') return argv[index + 1] === 'discovery';
    if (!value.startsWith('-')) return value === 'discovery';
    const option = program.options.find(
      (item) => item.long === value.split('=')[0] || item.short === value
    );
    if (!option) return false;
    if (
      !value.includes('=') &&
      (option.required || option.optional) &&
      argv[index + 1] &&
      !argv[index + 1].startsWith('-')
    )
      index++;
  }
  return false;
}

export function registerDiscoveryCommand(program: Command): void {
  program
    .command('discovery [action]')
    .description(
      'Discover repository workflows locally; list or push drafts to Build my agent'
    )
    .option(
      '--workspace <path>',
      'Repository to scan (defaults to --path or the current directory)'
    )
    .option('--json', 'Emit machine-readable results')
    .option('--dry-run', 'Preview without writing files or uploading workflows')
    .option('--select <id,id>', 'List or push selected local workflow IDs')
    .option(
      '--depth <0|1|2>',
      'Search for projects up to two directory levels below the workspace',
      '2'
    )
    .option('--skill-query <text>', 'Filter skill names and descriptions')
    .option('--no-behavior', 'Skip local user message history')
    .option(
      '--github',
      'Include merged pull requests using the authenticated gh CLI'
    )
    .option(
      '--analyze',
      'Refine recommendations with the discovery analysis skill'
    )
    .option(
      '--with-report',
      'Upload derived findings and request hosted workflow matches'
    )
    .option(
      '--push',
      'Scan, save and upload suggested workflows with their findings'
    )
    .addHelpText(
      'after',
      '\nActions: scan (default), list, push\n\nExamples:\n  autohand discovery\n  autohand discovery push --dry-run\n  autohand discovery push --select repository-onboarding,ci-diagnosis\n\nScan and list work offline. Push reuses AUTOHAND_API_KEY or your stored Autohand credential.\n'
    )
    .action(async (action: string | undefined, options: DiscoveryOptions) => {
      const mode = action ?? 'scan';
      if (!['scan', 'list', 'push'].includes(mode))
        throw new Error(
          'Use autohand discovery, discovery list, or discovery push.'
        );
      const root = program.opts<RootOptions>();
      const workspace =
        options.workspace ?? root.path ?? root.dir ?? process.cwd();
      const dryRun = options.dryRun || root.dryRun;
      const args = [
        mode,
        '--workspace',
        workspace,
        ...(options.json || root.json !== undefined ? ['--json'] : []),
        ...(dryRun ? ['--dry-run'] : []),
        ...(options.select ? ['--select', options.select] : []),
        ...(options.depth ? ['--depth', options.depth] : []),
        ...(options.skillQuery ? ['--skill-query', options.skillQuery] : []),
        ...(options.behavior === false ? ['--no-behavior'] : []),
        ...(options.github ? ['--github'] : []),
        ...(options.analyze ? ['--analyze'] : []),
        ...(options.withReport ? ['--with-report'] : []),
        ...(options.push ? ['--push'] : []),
      ];
      if (process.env.AUTOHAND_DISCOVERY_CHILD === '1') {
        await runEmbeddedDiscovery(args, root.config);
        return;
      }
      let credential: string | undefined;
      if (((mode === 'push' || options.push) && !dryRun) || options.analyze) {
        credential = process.env.AUTOHAND_API_KEY?.trim();
        if (!credential) {
          const config = await loadConfig(root.config, undefined, {
            createIfMissing: false,
            initializeTheme: false,
          });
          credential = config.auth?.token;
        }
      }
      process.exitCode = await spawnDiscoveryProcess(
        args,
        credential,
        root.config
      );
    });
}

export function discoveryProcessArguments(
  args: string[],
  entry = process.argv[1],
  execArgs = process.execArgv
): string[] {
  if (!entry) throw new Error('Could not locate the Autohand executable.');
  const compiled = entry.includes('$bunfs');
  return [...(compiled ? [] : [...execArgs, entry]), 'discovery', ...args];
}

export async function spawnDiscoveryProcess(
  args: string[],
  credential?: string,
  configPath?: string
): Promise<number> {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    AUTOHAND_DISCOVERY_CHILD: '1',
  };
  delete environment.AUTOHAND_API_KEY;
  if (credential) environment.AUTOHAND_API_KEY = credential;
  const childArgs = discoveryProcessArguments(args);
  if (configPath)
    childArgs.splice(childArgs.indexOf('discovery'), 0, '--config', configPath);
  const child = spawn(process.execPath, childArgs, {
    cwd: process.cwd(),
    env: environment,
    stdio: 'inherit',
    shell: false,
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
      child.once('error', () =>
        reject(
          new Error(
            'Could not start the discovery subprocess. Check your Autohand installation.'
          )
        )
      );
      child.once('close', (code, signal) =>
        resolve(
          cancelled === 'SIGINT' || signal === 'SIGINT'
            ? 130
            : cancelled === 'SIGTERM' || signal === 'SIGTERM'
              ? 143
              : (code ?? 1)
        )
      );
    });
  } finally {
    if (deadline) clearTimeout(deadline);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
}

async function runEmbeddedDiscovery(
  args: string[],
  configPath?: string
): Promise<void> {
  const temporary = await mkdtemp(
    path.join(tmpdir(), 'autohand-discovery-worker-')
  );
  const controller = new AbortController();
  const interrupt = () => {
    process.exitCode = 130;
    controller.abort(new Error('Discovery cancelled.'));
  };
  const terminate = () => {
    process.exitCode = 143;
    controller.abort(new Error('Discovery cancelled.'));
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  const progress = createDiscoveryProgress({
    json: args.includes('--json') || args.includes('--dry-run'),
    analyze: args.includes('--analyze'),
    cancel: interrupt,
  });
  let finder: FFFSearchProvider | undefined;
  try {
    const file = path.join(temporary, 'discovery.mjs');
    await writeFile(file, discoveryWorkerSource, { flag: 'wx', mode: 0o600 });
    const worker = (await import(pathToFileURL(file).href)) as {
      runDiscovery: (
        args: string[],
        options: {
          signal: AbortSignal;
          home: string;
          agentHomes: { autohand?: string; claude?: string; codex?: string };
          skillLocations: {
            basePath: string;
            agent: string;
            scope: 'user';
            repository: string;
          }[];
          progress: (event: DiscoveryProgressEvent) => void;
          output: (text: string) => void;
          findFiles: (
            root: string,
            query: string,
            limit: number
          ) => Promise<string[]>;
          analyze: (prompt: string, signal?: AbortSignal) => Promise<string>;
        }
      ) => Promise<void>;
    };
    if (typeof worker.runDiscovery !== 'function')
      throw new Error(
        'The embedded discovery worker is incompatible. Rebuild Autohand.'
      );
    const home = process.env.AUTOHAND_DISCOVERY_HOME ?? homedir();
    const workspaceIndex = args.indexOf('--workspace');
    const workspace =
      workspaceIndex >= 0 ? args[workspaceIndex + 1] : process.cwd();
    await worker.runDiscovery(args, {
      signal: controller.signal,
      home,
      agentHomes: process.env.AUTOHAND_DISCOVERY_HOME
        ? { autohand: process.env.AUTOHAND_HOME }
        : {
            autohand: process.env.AUTOHAND_HOME,
            claude: process.env.CLAUDE_CONFIG_DIR,
            codex: process.env.CODEX_HOME,
          },
      skillLocations: getUserSkillLocations(
        home,
        path.join(
          process.env.AUTOHAND_HOME ?? path.join(home, '.autohand'),
          'skills'
        )
      ).map((location) => ({
        basePath: location.basePath,
        agent: location.source.replace(/-user$/, ''),
        scope: 'user',
        repository: '.',
      })),
      progress: (event) => progress.update(event),
      output: (text) => {
        progress.finish();
        console.log(text);
      },
      findFiles: async (root, query, limit) => {
        finder ??= await FFFSearchProvider.create(root);
        return (await finder.fileSearch({ query, limit }))
          .split('\n')
          .map((line) => line.replace(/^\[[^\]]+\]\s*/, '').trim())
          .filter((line) => line.endsWith('SKILL.md'));
      },
      analyze: createDiscoveryAnalyzer({ cwd: workspace, configPath }),
    });
  } catch (error) {
    process.exitCode ||= 1;
    console.error(
      (error instanceof Error ? error.message : 'Discovery failed.').replace(
        /\bahc_[A-Za-z0-9_-]+/g,
        '[redacted]'
      )
    );
  } finally {
    progress.finish();
    finder?.destroy();
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
    await rm(temporary, { recursive: true, force: true });
  }
}
