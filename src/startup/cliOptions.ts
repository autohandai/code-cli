/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CLIOptions, SearchProvider } from '../types.js';
import { isTmuxEnabled } from '../utils/tmux.js';

const SEARCH_PROVIDERS = [
  'browser-profile',
  'exa',
  'google',
  'brave',
  'duckduckgo',
  'parallel',
] as const satisfies readonly SearchProvider[];

export interface RootCliOptions extends CLIOptions {
  mode?: string;
  acp?: boolean;
  y?: boolean;
  cc?: boolean;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  skillInstall?: string | boolean;
  project?: boolean;
  settings?: boolean;
  setup?: boolean;
  about?: boolean;
  learn?: boolean;
  learnUpdate?: boolean;
  offline?: boolean;
}

export function normalizeInitialCliOptions(
  options: RootCliOptions,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const prompt: unknown = options.prompt;
  if (prompt === true) {
    options.prompt = undefined;
  }
  if (options.y === true) {
    options.yes = true;
  }
  const autoMode: unknown = options.autoMode;
  if (autoMode === true) {
    options.autoMode = undefined;
  }
  const goal: unknown = options.goal;
  if (goal === true) {
    options.goal = '';
  }
  if (options.systemPrompt) {
    options.sysPrompt = options.systemPrompt;
  }
  if (options.systemPromptFile) {
    options.sysPrompt = options.systemPromptFile;
  }
  if (options.appendSystemPrompt) {
    options.appendSysPrompt = options.appendSystemPrompt;
  }
  if (options.appendSystemPromptFile) {
    options.appendSysPrompt = options.appendSystemPromptFile;
  }
  if (options.bare) {
    environment.AUTOHAND_CODE_SIMPLE = '1';
    options.syncSettings = false;
    options.contextCompact = false;
    options.noChrome = true;
  }
}

export function normalizePromptAndProtocolOptions(
  positionalPrompt: string | undefined,
  options: RootCliOptions,
): void {
  if (positionalPrompt && !options.prompt) {
    options.prompt = positionalPrompt;
  }
  if (options.acp) {
    options.mode = 'acp';
  }
}

export function normalizeTmuxWorktreeOption(options: RootCliOptions): string | null {
  if (!isTmuxEnabled(options.tmux)) {
    return null;
  }
  if (options.worktree === false) {
    return '--tmux cannot be used with --no-worktree';
  }
  if (options.worktree === undefined) {
    options.worktree = true;
  }
  return null;
}

export function normalizeContextCompactOption(options: RootCliOptions): void {
  if (options.cc !== undefined) {
    options.contextCompact = options.cc;
  }
}

export function normalizeSearchEngineOption(options: RootCliOptions): string | null {
  const searchEngine: unknown = options.searchEngine;
  if (typeof searchEngine !== 'string' || searchEngine.length === 0) {
    return null;
  }
  const provider = searchEngine.toLowerCase();
  if (isSearchProvider(provider)) {
    options.searchEngine = provider;
    return null;
  }
  return `Invalid search engine: ${provider}. Valid options: ${SEARCH_PROVIDERS.join(', ')}`;
}

function isSearchProvider(value: string): value is SearchProvider {
  return SEARCH_PROVIDERS.some((provider) => provider === value);
}
