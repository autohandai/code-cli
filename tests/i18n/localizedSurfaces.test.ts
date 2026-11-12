/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';
import { changeLanguage, formatList, initI18n, t, tPlural } from '../../src/i18n/index.js';
import { SLASH_COMMANDS } from '../../src/core/slashCommands.js';
import { cliCommandKey, cliOptionKey, localizeCommanderHelp } from '../../src/i18n/cliHelp.js';

afterEach(async () => {
  await changeLanguage('en');
});

describe('tPlural', () => {
  it('uses CLDR plural categories with English fallback', async () => {
    expect(tPlural('startup.workspaceTrust.projectHooks', 1)).toBe('1 project hook');
    expect(tPlural('startup.workspaceTrust.projectHooks', 3)).toBe('3 project hooks');
    await changeLanguage('ru');
    expect(tPlural('startup.workspaceTrust.projectHooks', 5)).toMatch(/^5 \S/);
    expect(tPlural('startup.workspaceTrust.projectHooks', 5)).not.toContain('project');
  });
});

describe('formatList', () => {
  it('joins with the locale conjunction', async () => {
    expect(formatList(['a', 'b', 'c'])).toBe('a, b, and c');
    await changeLanguage('ru');
    expect(formatList(['a', 'b'])).toBe('a и b');
  });
});

describe('slash command descriptions', () => {
  it('follow the display language after import', async () => {
    const login = SLASH_COMMANDS.find((cmd) => cmd.command === '/login');
    expect(login?.description).toBe('sign in to your Autohand account');
    await changeLanguage('ja');
    expect(login?.description).toBe(t('slashCommands.login'));
    expect(login?.description).not.toBe('sign in to your Autohand account');
  });
});

describe('localized --help', () => {
  function buildProgram(): Command {
    const program = localizeCommanderHelp(new Command());
    program.name('autohand').description('Autonomous coding agent').option('--dry-run', 'Preview actions without applying mutations');
    program.command('login').description('Sign in to your Autohand account');
    return program;
  }

  it('derives stable keys', () => {
    const program = buildProgram();
    expect(cliCommandKey(program)).toBe('cli.rootDescription');
    expect(cliCommandKey(program.commands[0])).toBe('cli.commands.login.description');
    expect(cliOptionKey({ long: '--dry-run', short: undefined })).toBe('cli.options.dryRun');
    expect(cliOptionKey({ long: '--help', short: '-h' }, program.commands[0])).toBe('cli.options.help');
  });

  it('renders headings, options and commands in the display language', async () => {
    // Help renders before the CLI initializes i18n; an initialized locale wins.
    await initI18n('kk');
    const help = buildProgram().helpInformation();
    expect(help).toContain(t('cli.help.usage'));
    expect(help).toContain(t('cli.options.dryRun'));
    expect(help).toContain(t('cli.commands.login.description'));
    expect(help).not.toContain('Preview actions without applying mutations');
    expect(help).not.toContain('Options:');
  });
});


describe('editor-approved terminology', () => {
  it.each([
    'commands.settings.search.provider',
    'commands.settings.search.providerDesc',
    'commands.status.provider',
  ])('uses the approved Japanese provider spelling for %s', async (key) => {
    await changeLanguage('ja');
    expect(t(key)).toContain('プロバイダー');
    expect(t(key)).not.toMatch(/プロバイダ(?!ー)/);
  });

  it.each(['Codex', 'Codex e Claude Code'])('describes detected agents without a number agreement for %s', async (agents) => {
    await changeLanguage('pt-br');
    expect(t('setup.keybindings.description', { agents })).toMatch(/^Encontrado: /);
    expect(t('setup.keybindings.description', { agents })).toContain(agents);
  });
});
