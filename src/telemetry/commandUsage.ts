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

/**
 * Reports a top-level CLI command, e.g. `autohand mcp connect <name>`.
 *
 * Interactive slash commands are reported by `AgentCommandRuntime` before it
 * dispatches, so every one of them is covered by a single call site. Top-level
 * commands never reach that runtime — they run and exit without an agent — so
 * all 27 of them were invisible. This closes that gap from commander's
 * `preAction` hook rather than from 27 separate actions, so a command added
 * later is reported without anyone remembering to instrument it.
 *
 * Only the command path is recorded, never its arguments: those carry paths,
 * server names and prompts. `buildCommandUseData` keeps the subcommand only
 * when it matches a known one, so cardinality stays bounded.
 *
 * Never throws and never blocks the command it is reporting. Telemetry queues
 * to disk, so a process that exits immediately still delivers the event on a
 * later run rather than needing a network round trip first.
 */
export async function reportCliCommand(options: {
  commandPath: readonly string[];
  knownSubcommands?: readonly string[];
  loadConfig: () => Promise<{
    telemetry?: { enabled?: boolean; apiBaseUrl?: string; companySecret?: string };
    api?: { companySecret?: string };
    auth?: { token?: string };
  }>;
  clientVersion: string;
}): Promise<void> {
  try {
    const [command, ...rest] = options.commandPath.filter(Boolean);
    if (!command) return;

    const config = await options.loadConfig();
    // Opt-in, checked before anything is constructed: a user who has not
    // enabled telemetry must not have a client built for them at all.
    if (config.telemetry?.enabled !== true) return;

    const { TelemetryManager } = await import('./TelemetryManager.js');
    const manager = new TelemetryManager({
      enabled: true,
      apiBaseUrl: config.telemetry.apiBaseUrl || 'https://api.autohand.ai',
      companySecret: config.telemetry.companySecret || config.api?.companySecret || '',
      authToken: config.auth?.token,
      clientVersion: options.clientVersion,
    });

    await manager.trackCommand(
      buildCommandUseData({
        command,
        args: rest,
        knownSubcommands: options.knownSubcommands ?? rest.slice(0, 1),
        surface: 'cli',
      }),
    );
  } catch {
    // Reporting a command must never be the reason a command fails.
  }
}
