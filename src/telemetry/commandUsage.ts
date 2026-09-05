/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandUseData, CommandUseSurface } from './types.js';

export interface BuildCommandUseDataOptions {
  command: string;
  args?: readonly string[];
  knownSubcommands?: readonly string[];
  surface: CommandUseSurface;
}

function normalizedCommandParts(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

/**
 * Build low-cardinality command telemetry without retaining free-form input.
 */
export function buildCommandUseData(
  options: BuildCommandUseDataOptions,
): CommandUseData {
  const [command, embeddedSubcommand] = normalizedCommandParts(options.command);
  const firstArgument = options.args?.[0];
  const knownSubcommand = firstArgument && options.knownSubcommands?.includes(firstArgument)
    ? firstArgument
    : undefined;
  const subcommand = embeddedSubcommand ?? knownSubcommand;

  return {
    command: command ?? options.command,
    ...(subcommand ? { subcommand } : {}),
    surface: options.surface,
  };
}
