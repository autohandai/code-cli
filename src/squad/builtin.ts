/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LoadedConfig, McpServerConfigEntry } from '../types.js';
import { resolveSquadBridgeUrl } from './SquadConnection.js';
import { createBridgeClient, createTools, createRpcHandler, serveStdio } from './vendor/runtime.mjs';

export interface SquadMcpOptions {
  env?: NodeJS.ProcessEnv;
  bare?: boolean;
  offline?: boolean;
  execPath?: string;
  entryPath?: string;
  compiled?: boolean;
}

export function ensureSquadMcpServer(config: LoadedConfig, options: SquadMcpOptions = {}): McpServerConfigEntry | undefined {
  const env = options.env ?? process.env;
  if (options.bare || options.offline || config.mcp?.enabled === false || env.AUTOHAND_SQUAD_TEAM_TOKEN || env.AUTOHAND_SQUAD_MEMBER || env.AUTOHAND_SQUAD_TEAM_URL || /^(1|true|yes)$/i.test(env.AUTOHAND_DISABLE_SQUAD || '')) return undefined;
  if (config.mcp?.servers?.some(server => server.name.replace(/_/g, '-').toLowerCase() === 'autohand-squad')) return undefined;
  const entry = options.entryPath ?? process.argv[1];
  const compiled = options.compiled ?? /(?:\$bunfs|~BUN)/.test(entry || '');
  if (!compiled && !entry) return undefined;
  return {
    name: 'autohand-squad', transport: 'stdio', stdioFraming: 'newline',
    command: options.execPath ?? process.execPath,
    args: [...(!compiled && entry ? [entry] : []), 'squad', 'mcp'],
    autoConnect: true,
    localOnly: true,
  };
}

export async function runSquadMcp(argv: string[] = [], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.AUTOHAND_SQUAD_TEAM_TOKEN || env.AUTOHAND_SQUAD_MEMBER || env.AUTOHAND_SQUAD_TEAM_URL) throw new Error('Managed Squad members must use their existing member MCP connection.');
  let bridge: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === '--bridge' && argv[index + 1]) bridge = argv[++index];
    else if (value.startsWith('--bridge=')) bridge = value.slice('--bridge='.length);
    else throw new Error('Usage: autohand squad mcp [--bridge http://127.0.0.1:19821]');
  }
  const origin = await resolveSquadBridgeUrl({ ...env, ...(bridge ? { AUTOHAND_SQUAD_BRIDGE_URL: bridge } : {}) });
  const handle = createRpcHandler(createTools(createBridgeClient(origin)), { bridgeUrl: origin });
  await serveStdio({ handle });
}
