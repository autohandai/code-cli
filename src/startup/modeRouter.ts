/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { resolveAutoModeLaunchMode } from '../modes/autoModeRouting.js';
import type { CLIOptions } from '../types.js';

export type ProtocolLaunchMode = 'rpc' | 'acp' | 'standard';
export type PostAuthLaunchMode =
  | 'teammate'
  | 'auto-unavailable'
  | 'auto-standalone'
  | 'auto-interactive'
  | 'standard';
export type AgentLaunchMode = 'fork' | 'command' | 'resume' | 'interactive';

export function resolveProtocolLaunchMode(options: { mode?: string }): ProtocolLaunchMode {
  if (options.mode === 'rpc' || options.mode === 'acp') {
    return options.mode;
  }
  return 'standard';
}

export function resolvePostAuthLaunchMode(options: {
  mode?: string;
  autoMode?: string;
  prompt?: string;
  argv: string[];
  stdinIsTTY: boolean;
}): PostAuthLaunchMode {
  if (options.mode === 'teammate') {
    return 'teammate';
  }
  const autoMode = resolveAutoModeLaunchMode({
    hasAutoModeFlag: options.argv.some((arg) => arg === '--auto-mode'),
    autoModeTask: options.autoMode,
    prompt: options.prompt,
    stdinIsTTY: options.stdinIsTTY,
  });
  if (autoMode === 'unavailable') return 'auto-unavailable';
  if (autoMode === 'standalone') return 'auto-standalone';
  if (autoMode === 'interactive') return 'auto-interactive';
  return 'standard';
}

export function resolveAgentLaunchMode(options: CLIOptions): AgentLaunchMode {
  if (options.fork) return 'fork';
  if (options.prompt) return 'command';
  if (options.resumeSessionId) return 'resume';
  return 'interactive';
}
