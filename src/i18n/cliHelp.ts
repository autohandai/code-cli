/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Localized `--help` output for the commander program.
 *
 * Option and command descriptions are registered in English at import time,
 * before the display language is known. Commander asks the Help object for
 * every description and heading while rendering, so the translation happens
 * there. Anything without a key keeps its registered English text.
 */

import { Help, type Argument, type Command, type Option } from 'commander';
import { detectLocale } from './localeDetector.js';
import { initI18n, isInitialized, t } from './index.js';

function toCamel(value: string): string {
  return value.replace(/^-+/, '').replace(/[-_]+([a-z0-9])/gi, (_, c: string) => c.toUpperCase());
}

function commandPath(cmd: Command): string[] {
  const names: string[] = [];
  let current: Command | null = cmd;
  while (current?.parent) {
    names.unshift(toCamel(current.name()));
    current = current.parent;
  }
  return names;
}

/**
 * Root `--dry-run` -> `cli.options.dryRun`; `mcp add --scope` ->
 * `cli.commands.mcp.add.options.scope`. Subcommands reuse flag names with
 * different meanings, so their keys are scoped to the command.
 */
export function cliOptionKey(option: Pick<Option, 'long' | 'short'>, cmd?: Command): string | null {
  const flag = option.long ?? option.short;
  if (!flag) return null;
  // Commander's built-in --help/--version read the same on every command.
  const path = cmd && flag !== '--help' && flag !== '--version' ? commandPath(cmd) : [];
  return path.length === 0
    ? `cli.options.${toCamel(flag)}`
    : `cli.commands.${path.join('.')}.options.${toCamel(flag)}`;
}

/** Root `[prompt]` -> `cli.arguments.prompt`; `mcp add <name>` -> `cli.commands.mcp.add.arguments.name`. */
export function cliArgumentKey(argumentName: string, cmd?: Command): string {
  const path = cmd ? commandPath(cmd) : [];
  const name = toCamel(argumentName);
  return path.length === 0 ? `cli.arguments.${name}` : `cli.commands.${path.join('.')}.arguments.${name}`;
}

/** Root -> `cli.rootDescription`; `mcp add` -> `cli.commands.mcp.add`. */
export function cliCommandKey(cmd: Command): string {
  const path = commandPath(cmd);
  return path.length === 0 ? 'cli.rootDescription' : `cli.commands.${path.join('.')}.description`;
}

const HEADING_KEYS: Record<string, string> = {
  'Usage:': 'cli.help.usage',
  'Options:': 'cli.help.options',
  'Global Options:': 'cli.help.globalOptions',
  'Commands:': 'cli.help.commands',
  'Arguments:': 'cli.help.arguments',
};

function translateOr(key: string | null, fallback: string): string {
  if (!key) return fallback;
  const value = t(key);
  return value === key ? fallback : value;
}

/** Value of `--display-language` in argv, if present. */
export function readDisplayLanguageArg(argv: readonly string[] = process.argv): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--display-language') return argv[i + 1];
    if (arg.startsWith('--display-language=')) return arg.slice('--display-language='.length);
  }
  return undefined;
}

/**
 * Help renders before the CLI action initializes i18n, so pick up the locale
 * from `--display-language` or the environment (AUTOHAND_LOCALE, LC_ALL, LANG).
 */
export function ensureHelpLocale(argv: readonly string[] = process.argv): void {
  if (isInitialized()) return;
  const { locale } = detectLocale({ cliOverride: readDisplayLanguageArg(argv) });
  void initI18n(locale);
}

export function localizeCommanderHelp(program: Command): Command {
  // Commander renders one command's help at a time; remember which, so option
  // descriptions resolve against that command's keys.
  let renderingCommand: Command | undefined;
  return program.configureHelp({
    formatHelp(cmd: Command, helper: Help): string {
      renderingCommand = cmd;
      try {
        return Help.prototype.formatHelp.call(this, cmd, helper);
      } finally {
        renderingCommand = undefined;
      }
    },
    commandDescription(cmd: Command): string {
      ensureHelpLocale();
      return translateOr(cliCommandKey(cmd), Help.prototype.commandDescription.call(this, cmd));
    },
    subcommandDescription(cmd: Command): string {
      ensureHelpLocale();
      return translateOr(cliCommandKey(cmd), Help.prototype.subcommandDescription.call(this, cmd));
    },
    optionDescription(option: Option): string {
      ensureHelpLocale();
      const rendered = Help.prototype.optionDescription.call(this, option);
      const original = option.description ?? '';
      const localized = translateOr(cliOptionKey(option, renderingCommand), original);
      const withDescription = original && rendered.startsWith(original)
        ? localized + rendered.slice(original.length)
        : rendered;
      return withDescription.replace(/\(default: /, `(${t('cli.help.default')}: `);
    },
    argumentDescription(argument: Argument): string {
      ensureHelpLocale();
      const rendered = Help.prototype.argumentDescription.call(this, argument);
      const original = argument.description ?? '';
      const localized = translateOr(cliArgumentKey(argument.name(), renderingCommand), original);
      const withDescription = original && rendered.startsWith(original)
        ? localized + rendered.slice(original.length)
        : rendered;
      return withDescription.replace(/\(default: /, `(${t('cli.help.default')}: `);
    },
    styleTitle(title: string): string {
      ensureHelpLocale();
      return translateOr(HEADING_KEYS[title] ?? null, title);
    },
  });
}
