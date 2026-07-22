/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  normalizeContextCompactOption,
  normalizeInitialCliOptions,
  normalizePromptAndProtocolOptions,
  normalizeSearchEngineOption,
  normalizeTmuxWorktreeOption,
  type RootCliOptions,
} from '../../src/startup/cliOptions.js';

describe('CLI option normalization', () => {
  it('normalizes Commander boolean option values and yes aliases', () => {
    const options: RootCliOptions = { y: true };
    Reflect.set(options, 'prompt', true);
    Reflect.set(options, 'autoMode', true);
    Reflect.set(options, 'goal', true);

    normalizeInitialCliOptions(options, {});

    expect(options).toMatchObject({ yes: true, goal: '' });
    expect(options.prompt).toBeUndefined();
    expect(options.autoMode).toBeUndefined();
  });

  it('preserves flag prompts over positional prompts and otherwise uses the positional prompt', () => {
    const explicit: RootCliOptions = { prompt: 'from flag' };
    const positional: RootCliOptions = {};

    normalizePromptAndProtocolOptions('from positional', explicit);
    normalizePromptAndProtocolOptions('from positional', positional);

    expect(explicit.prompt).toBe('from flag');
    expect(positional.prompt).toBe('from positional');
  });

  it('lets --acp override a conflicting explicit protocol mode', () => {
    const options: RootCliOptions = { acp: true, mode: 'rpc' };

    normalizePromptAndProtocolOptions(undefined, options);

    expect(options.mode).toBe('acp');
  });

  it('applies prompt-file aliases after inline aliases', () => {
    const options: RootCliOptions = {
      systemPrompt: 'inline system',
      systemPromptFile: 'system.md',
      appendSystemPrompt: 'inline append',
      appendSystemPromptFile: 'append.md',
    };

    normalizeInitialCliOptions(options, {});

    expect(options.sysPrompt).toBe('system.md');
    expect(options.appendSysPrompt).toBe('append.md');
  });

  it('keeps bare-mode startup restrictions together', () => {
    const environment: NodeJS.ProcessEnv = {};
    const options: RootCliOptions = { bare: true };

    normalizeInitialCliOptions(options, environment);

    expect(environment.AUTOHAND_CODE_SIMPLE).toBe('1');
    expect(options).toMatchObject({
      syncSettings: false,
      contextCompact: false,
      browser: false,
    });
  });

  it('normalizes hidden Chrome compatibility options to the canonical browser option', () => {
    const canonical = {} as RootCliOptions;
    const legacyEnabled = {} as RootCliOptions;
    const legacyDisabled = {} as RootCliOptions;
    Reflect.set(canonical, 'browser', true);
    Reflect.set(legacyEnabled, 'chrome', true);
    Reflect.set(legacyDisabled, 'chrome', false);

    expect(normalizeInitialCliOptions(canonical, {})).toEqual({});
    expect(normalizeInitialCliOptions(legacyEnabled, {})).toEqual({
      deprecatedBrowserOption: '--chrome',
    });
    expect(normalizeInitialCliOptions(legacyDisabled, {})).toEqual({
      deprecatedBrowserOption: '--no-chrome',
    });

    expect(Reflect.get(canonical, 'browser')).toBe(true);
    expect(Reflect.get(legacyEnabled, 'browser')).toBe(true);
    expect(Reflect.get(legacyDisabled, 'browser')).toBe(false);
    expect(Reflect.has(legacyEnabled, 'chrome')).toBe(false);
    expect(Reflect.has(legacyDisabled, 'chrome')).toBe(false);
  });

  it('gives an explicit canonical browser option precedence over a legacy alias', () => {
    const options = {} as RootCliOptions;
    Reflect.set(options, 'browser', false);
    Reflect.set(options, 'chrome', true);

    expect(normalizeInitialCliOptions(options, {})).toEqual({
      deprecatedBrowserOption: '--chrome',
    });
    expect(Reflect.get(options, 'browser')).toBe(false);
    expect(Reflect.has(options, 'chrome')).toBe(false);
  });

  it('defaults tmux sessions to worktree isolation and rejects an explicit opt-out', () => {
    const defaults: RootCliOptions = { tmux: true };
    const conflict: RootCliOptions = { tmux: true, worktree: false };

    expect(normalizeTmuxWorktreeOption(defaults)).toBeNull();
    expect(defaults.worktree).toBe(true);
    expect(normalizeTmuxWorktreeOption(conflict)).toBe(
      '--tmux cannot be used with --no-worktree',
    );
  });

  it('maps context compaction and canonicalizes search providers', () => {
    const options: RootCliOptions = { cc: false };
    Reflect.set(options, 'searchEngine', 'GOOGLE');

    normalizeContextCompactOption(options);
    const error = normalizeSearchEngineOption(options);

    expect(error).toBeNull();
    expect(options.contextCompact).toBe(false);
    expect(options.searchEngine).toBe('google');
  });

  it('reports the existing search-provider validation message', () => {
    const options: RootCliOptions = {
      path: '../workspace',
      displayLanguage: 'pt-br',
      dryRun: true,
    };
    Reflect.set(options, 'searchEngine', 'unknown');

    expect(normalizeSearchEngineOption(options)).toBe(
      'Invalid search engine: unknown. Valid options: browser-profile, exa, google, brave, duckduckgo, parallel',
    );
    expect(options).toMatchObject({
      path: '../workspace',
      displayLanguage: 'pt-br',
      dryRun: true,
    });
  });
});
