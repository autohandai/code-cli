/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { InteractionMode } from '../core/agent/InteractionModeController.js';
import { resolveAutoModeLaunchMode } from '../modes/autoModeRouting.js';
import type { CLIOptions, PermissionMode } from '../types.js';

export type ProtocolLaunchMode = 'rpc' | 'acp' | 'standard';
export type InternalLaunchMode = 'teammate' | 'standard';
export type PostAuthLaunchMode =
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

export function resolveInternalLaunchMode(options: { mode?: string }): InternalLaunchMode {
  return options.mode === 'teammate' ? 'teammate' : 'standard';
}

export function resolvePostAuthLaunchMode(options: {
  mode?: string;
  autoMode?: string;
  prompt?: string;
  argv: string[];
  stdinIsTTY: boolean;
}): PostAuthLaunchMode {
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

export const DEFAULT_STARTUP_INTERACTION_MODE: InteractionMode = 'automode';

export interface StartupInteractionModeInput {
  options: Pick<
    CLIOptions,
    | 'interactiveAutoMode'
    | 'plan'
    | 'yolo'
    | 'restricted'
    | 'dryRun'
    | 'unrestricted'
    | 'yes'
    | 'prompt'
  > & { mode?: string };
  /** `ui.defaultInteractionMode` from the loaded config. */
  configuredMode?: InteractionMode;
  /** `permissions.mode` from the loaded config. */
  permissionMode?: PermissionMode;
  isInteractiveTerminal: boolean;
}

/**
 * Picks the interaction mode a session starts in. Auto mode is the default for
 * interactive terminals only: an explicit flag, a locked-down permission
 * config, or a launch nobody is watching always wins over it.
 */
export function resolveStartupInteractionMode(input: StartupInteractionModeInput): InteractionMode {
  const { options } = input;
  if (options.interactiveAutoMode) return 'automode';
  if (options.plan) return 'plan';
  if (options.yolo) return 'yolo';
  if (options.restricted || options.dryRun || options.unrestricted || options.yes) return 'default';
  if (options.prompt || resolveProtocolLaunchMode(options) !== 'standard') return 'default';
  if (resolveInternalLaunchMode(options) !== 'standard' || !input.isInteractiveTerminal) return 'default';
  if (input.permissionMode === 'restricted' || input.permissionMode === 'external') return 'default';
  return input.configuredMode ?? DEFAULT_STARTUP_INTERACTION_MODE;
}

export function applyStartupInteractionMode(options: CLIOptions, mode: InteractionMode): void {
  if (mode === 'automode') {
    options.interactiveAutoMode = true;
  } else if (mode === 'plan') {
    options.plan = true;
  } else if (mode === 'yolo') {
    options.yolo ??= 'allow:*';
  }
}
