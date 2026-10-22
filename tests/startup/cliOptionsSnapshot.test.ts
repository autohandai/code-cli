/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { Command, Option } from 'commander';
import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

interface OptionSurface {
  flags: string;
  required: boolean;
  optional: boolean;
  variadic: boolean;
  negate: boolean;
  hasDefault: boolean;
  defaultValue: unknown;
}

interface CommandSurface {
  command: string;
  options: OptionSurface[];
}

const snapshotUrl = new URL('./__snapshots__/cli-options.json', import.meta.url);
const snapshotPath = 'tests/startup/__snapshots__/cli-options.json';

function readMainSnapshot(directory: string): CommandSurface[] | null {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: 'pipe' });
  let entry: string;
  try {
    entry = git('ls-tree', '--name-only', 'origin/main', '--', snapshotPath);
  } catch (cause) {
    throw new Error('CLI option compatibility requires origin/main. Run git fetch origin main before testing.', { cause });
  }
  return entry.trim() ? JSON.parse(git('show', `origin/main:${snapshotPath}`)) : null;
}

function captureOptions(program: Command, parents: string[] = []): CommandSurface[] {
  const names = [...parents, program.name()];
  const options = program.options.map(option => ({
    flags: option.flags,
    required: option.required,
    optional: option.optional,
    variadic: option.variadic,
    negate: option.negate,
    hasDefault: option.defaultValue !== undefined,
    defaultValue: option.defaultValue === undefined ? null : option.defaultValue,
  })).sort((left, right) => left.flags < right.flags ? -1 : left.flags > right.flags ? 1 : 0);
  return [
    { command: names.join(' '), options },
    ...program.commands.flatMap(command => captureOptions(command, names)),
  ].sort((left, right) => left.command < right.command ? -1 : left.command > right.command ? 1 : 0);
}

function compatibilityErrors(previous: CommandSurface[], current: CommandSurface[]): string[] {
  const errors: string[] = [];
  for (const command of previous) {
    const actualCommand = current.find(candidate => candidate.command === command.command);
    if (!actualCommand) {
      errors.push(`Removed command: ${command.command}`);
      continue;
    }
    for (const option of command.options) {
      const actualOption = actualCommand.options.find(candidate => candidate.flags === option.flags);
      if (!actualOption) errors.push(`Removed option: ${command.command} ${option.flags}`);
      else if (!isDeepStrictEqual(actualOption, option)) errors.push(`Changed option: ${command.command} ${option.flags}`);
    }
  }
  return errors;
}

function fixture(): Command {
  const program = new Command('autohand')
    .option('-d, --debug', 'Debug logging', false)
    .option('--mode <mode>', 'Runtime mode', 'interactive');
  program.command('sessions').command('list')
    .option('--all', 'Include all sessions', false);
  program.command('login');
  return program;
}

describe('CLI option surface compatibility', () => {
  it('matches the real entrypoint and only permits additive snapshot updates', async () => {
    const { program } = await import('../../src/index.js');
    expect(program).toBeInstanceOf(Command);
    const current = captureOptions(program);
    const mainSnapshot = readMainSnapshot(fileURLToPath(new URL('../../', import.meta.url)));
    expect(compatibilityErrors(mainSnapshot ?? [], current)).toEqual([]);
    if (process.env.UPDATE_CLI_OPTIONS_SNAPSHOT === '1') {
      if (process.env.CI) throw new Error('Update the CLI option snapshot locally, never in CI.');
      let previous: CommandSurface[] = [];
      try {
        previous = JSON.parse(await readFile(snapshotUrl, 'utf8'));
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      }
      const errors = compatibilityErrors(previous, current);
      if (errors.length) throw new Error(errors.join('\n'));
      await mkdir(new URL('./__snapshots__/', import.meta.url), { recursive: true });
      await writeFile(snapshotUrl, JSON.stringify(current, null, 2) + '\n');
    }
    const expected: CommandSurface[] = JSON.parse(await readFile(snapshotUrl, 'utf8'));
    expect(compatibilityErrors(expected, current)).toEqual([]);
    expect(current).toEqual(expected);
  }, 30_000);

  it('captures hidden flags, negation, variadic arity and nested commands with no options', () => {
    const program = fixture().addOption(new Option('--internal <value>').hideHelp())
      .option('--no-browser').option('--add-dir <paths...>');
    const snapshot = captureOptions(program);
    const root = snapshot.find(command => command.command === 'autohand');
    expect(root?.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ flags: '--internal <value>', required: true, optional: false }),
      expect.objectContaining({ flags: '--no-browser', negate: true, hasDefault: false }),
      expect.objectContaining({ flags: '--add-dir <paths...>', variadic: true }),
    ]));
    expect(snapshot).toContainEqual({ command: 'autohand login', options: [] });
    expect(snapshot.find(command => command.command === 'autohand sessions list')?.options)
      .toEqual([expect.objectContaining({ flags: '--all', defaultValue: false, hasDefault: true })]);
  });

  it('permits new options and commands without weakening existing contracts', () => {
    const previous = captureOptions(fixture());
    const next = fixture().option('--print');
    next.commands[0].commands[0].option('--limit <n>');
    next.command('purge').option('--dry-run');
    expect(compatibilityErrors(previous, captureOptions(next))).toEqual([]);
    expect(captureOptions(next)).not.toEqual(previous);
  });

  it('rejects removal of root flags, nested flags, and commands with no options', () => {
    const previous = captureOptions(fixture());
    const next = fixture();
    next.options.shift();
    next.commands[0].commands[0].options.pop();
    next.commands.pop();
    expect(compatibilityErrors(previous, captureOptions(next))).toEqual([
      'Removed option: autohand -d, --debug',
      'Removed command: autohand login',
      'Removed option: autohand sessions list --all',
    ]);
  });

  it.each([
    { required: true }, { optional: true }, { variadic: true }, { negate: true },
    { defaultValue: true }, { defaultValue: undefined }, { defaultValue: null },
  ])('rejects changing an existing option contract: %j', change => {
    const previous = captureOptions(fixture());
    const next = fixture();
    Object.assign(next.options[0], change);
    expect(compatibilityErrors(previous, captureOptions(next))).toEqual(['Changed option: autohand -d, --debug']);
  });

  it('rejects changing an existing flag spelling', () => {
    const previous = captureOptions(fixture());
    const next = fixture();
    next.options[0].flags = '-d, --debug [filter]';
    expect(compatibilityErrors(previous, captureOptions(next))).toEqual(['Removed option: autohand -d, --debug']);
  });

  it('checks committed main so manually editing the golden cannot approve a regression', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'autohand-option-snapshot-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: 'pipe' });
    const commit = () => git('-c', 'user.name=Option snapshot test', '-c', 'user.email=test@example.com',
      '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Option fixture');
    try {
      git('init');
      commit();
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      expect(readMainSnapshot(directory)).toBeNull();
      const original = captureOptions(fixture());
      const file = path.join(directory, 'tests/startup/__snapshots__/cli-options.json');
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(original));
      git('add', '.');
      commit();
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      const changed = fixture();
      changed.options[0].optional = true;
      const rewrittenGolden = captureOptions(changed);
      await writeFile(file, JSON.stringify(rewrittenGolden));
      expect(compatibilityErrors(readMainSnapshot(directory) ?? [], rewrittenGolden))
        .toEqual(['Changed option: autohand -d, --debug']);
      git('update-ref', '-d', 'refs/remotes/origin/main');
      expect(() => readMainSnapshot(directory)).toThrow('git fetch origin main');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
