/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SlashCommand } from '../core/slashCommands.js';
import type { MobileConnection } from '../mobile/MobileRelay.js';

export const metadata: SlashCommand = {
  command: '/devices',
  description: 'view the phone paired with this session, or unpair it',
  implemented: true,
  subcommands: [{ name: 'unpair', description: 'Disconnect the paired phone from this session' }],
};

export interface DevicesContext {
  /** The session's phone pairing; absent or null when nothing is paired. */
  connection?: () => MobileConnection | null;
  /** Revoke the pairing. Resolves false when there was nothing to unpair. */
  unpair?: () => Promise<boolean>;
  now?: () => number;
}

const NOT_PAIRED = 'No phone is paired with this session.\nPair one with /mobile.';
const USAGE = 'Usage: /devices [unpair]';

function elapsed(since: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - since) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

function describe(connection: MobileConnection, now: number): string {
  if (!connection.connected) {
    return [
      'Mobile devices',
      '',
      `… Waiting for a phone to scan the pairing code · ${connection.mode} mode`,
      '',
      'Cancel the pairing with /devices unpair.',
    ].join('\n');
  }
  const since = connection.connectedAt === undefined ? '' : ` · connected ${elapsed(connection.connectedAt, now)}`;
  return [
    'Mobile devices',
    '',
    `✓ Autohand Mobile${since} · ${connection.mode} mode`,
    '',
    'Unpair it with /devices unpair. The phone stays signed in; it only loses this session.',
  ].join('\n');
}

export async function devices(ctx: DevicesContext, args: string[] = []): Promise<string> {
  const [action, ...rest] = args;
  if (rest.length > 0 || (action !== undefined && action !== 'unpair')) return USAGE;

  const connection = ctx.connection?.() ?? null;
  if (action === undefined) return connection ? describe(connection, (ctx.now ?? Date.now)()) : NOT_PAIRED;
  if (!connection || !ctx.unpair) return NOT_PAIRED;

  try {
    if (!(await ctx.unpair())) return NOT_PAIRED;
  } catch (error) {
    return `Could not unpair the phone: ${error instanceof Error ? error.message : String(error)}`;
  }
  return 'Phone unpaired. It can no longer send work to this session.\nPair again with /mobile.';
}
