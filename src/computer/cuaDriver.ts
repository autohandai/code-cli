/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFile } from 'node:child_process';
import { accessSync, constants as fsConstants, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { LoadedConfig, McpServerConfigEntry } from '../types.js';

export const CUA_DRIVER_VERSION = '0.28.2';
export const CUA_DRIVER_MCP_SERVER_NAME = 'cua-driver';

const executeFile = promisify(execFile);

export interface CuaDriverPathOptions {
  configuredPath?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  moduleDirectory?: string;
  executablePath?: string;
  entryPath?: string;
  isExecutable?: (candidate: string) => boolean;
}

export type CuaMcpIntegrationStatus = 'added' | 'existing' | 'disabled' | 'missing';

export interface CuaMcpIntegrationResult {
  status: CuaMcpIntegrationStatus;
  path?: string;
}

export interface CuaDriverInspectionReady {
  status: 'ready';
  path: string;
  version: string;
  supported: boolean;
}

export interface CuaDriverInspectionBroken {
  status: 'broken';
  path: string;
  error: string;
}

export type CuaDriverInspection = CuaDriverInspectionReady | CuaDriverInspectionBroken;

export interface CuaDriverExecuteResult {
  stdout: string;
  stderr: string;
}

export interface CuaDriverInspectionOptions {
  execute?: (command: string, args: string[]) => Promise<CuaDriverExecuteResult>;
}

function defaultIsExecutable(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
    accessSync(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function expandHome(candidate: string, homeDir: string): string {
  if (candidate === '~') return homeDir;
  if (candidate.startsWith('~/') || candidate.startsWith('~\\')) {
    return path.join(homeDir, candidate.slice(2));
  }
  return candidate;
}

function platformExecutableName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'cua-driver.exe' : 'cua-driver';
}

function uniqueCandidates(candidates: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = path.resolve(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

/** Resolve an existing driver without starting it or mutating user state. */
export function resolveCuaDriverPath(options: CuaDriverPathOptions = {}): string | null {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const executableName = platformExecutableName(platform);
  const moduleDirectory = options.moduleDirectory ?? path.dirname(fileURLToPath(import.meta.url));
  const executablePath = options.executablePath ?? process.execPath;
  const entryPath = options.entryPath ?? process.argv[1];
  const isExecutable = options.isExecutable ?? defaultIsExecutable;
  const configuredPath = options.configuredPath
    ? expandHome(options.configuredPath, homeDir)
    : undefined;
  const environmentPath = env.AUTOHAND_CUA_DRIVER_PATH
    ? expandHome(env.AUTOHAND_CUA_DRIVER_PATH, homeDir)
    : undefined;
  const pathCandidates = (env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, executableName));
  const entryDirectory = entryPath ? path.dirname(path.resolve(entryPath)) : undefined;
  const appBinary = path.join('CuaDriver.app', 'Contents', 'MacOS', 'cua-driver');
  const platformDefaults = platform === 'win32'
    ? [
        env.LOCALAPPDATA
          ? path.win32.join(env.LOCALAPPDATA, 'Programs', 'Cua', 'cua-driver', 'bin', executableName)
          : undefined,
        path.win32.join(homeDir, '.cua-driver', 'packages', 'current', executableName),
      ]
    : [
        path.join(homeDir, '.local', 'bin', executableName),
        path.join(homeDir, '.cua-driver', 'packages', 'current', executableName),
        ...(platform === 'darwin'
          ? [
              path.join('/Applications', appBinary),
              path.join(homeDir, 'Applications', appBinary),
            ]
          : []),
      ];
  const candidates = uniqueCandidates([
    configuredPath,
    environmentPath,
    ...pathCandidates,
    entryDirectory ? path.join(entryDirectory, executableName) : undefined,
    entryDirectory ? path.join(entryDirectory, '..', 'vendor', executableName) : undefined,
    path.join(path.dirname(executablePath), executableName),
    path.join(moduleDirectory, '..', 'vendor', executableName),
    path.join(moduleDirectory, '..', '..', 'vendor', executableName),
    ...platformDefaults,
  ]);
  return candidates.find(isExecutable) ?? null;
}

function isDisabledValue(value: string | undefined): boolean {
  return value !== undefined && /^(?:1|true|yes|on)$/iu.test(value.trim());
}

function isCuaServer(server: McpServerConfigEntry): boolean {
  const name = server.name.trim().toLowerCase();
  if (name === 'cua' || name === CUA_DRIVER_MCP_SERVER_NAME) return true;
  if (!server.command) return false;
  return path.basename(server.command).toLowerCase().replace(/\.exe$/u, '') === 'cua-driver';
}

/**
 * Add the built-in Cua MCP server to an isolated runtime config. Callers that
 * hold a persisted config should clone its MCP section first.
 */
export function ensureCuaMcpServer(
  config: LoadedConfig,
  options: {
    bare?: boolean;
    driverPath?: string | null;
    env?: NodeJS.ProcessEnv;
  } = {},
): CuaMcpIntegrationResult {
  const env = options.env ?? process.env;
  if (
    options.bare === true
    || config.mcp?.enabled === false
    || isDisabledValue(env.AUTOHAND_DISABLE_COMPUTER_USE)
  ) {
    return { status: 'disabled' };
  }

  const existing = config.mcp?.servers?.find(isCuaServer);
  if (existing) {
    return { status: 'existing', ...(existing.command ? { path: existing.command } : {}) };
  }

  const driverPath = options.driverPath === undefined
    ? resolveCuaDriverPath({ env })
    : options.driverPath;
  if (!driverPath) return { status: 'missing' };

  config.mcp = {
    ...config.mcp,
    servers: [
      ...(config.mcp?.servers ?? []),
      {
        name: CUA_DRIVER_MCP_SERVER_NAME,
        transport: 'stdio',
        command: driverPath,
        args: ['mcp'],
        autoConnect: true,
        env: {
          CUA_DRIVER_PERMISSION_MODE: 'standard',
          CUA_DRIVER_RS_TELEMETRY_ENABLED: '0',
        },
      },
    ],
  };
  return { status: 'added', path: driverPath };
}

/** Build the effective MCP list without persisting Autohand's built-in entry. */
export function resolveRuntimeMcpServers(
  config: LoadedConfig,
  options: Parameters<typeof ensureCuaMcpServer>[1] = {},
): McpServerConfigEntry[] {
  const runtimeConfig = {
    ...config,
    mcp: config.mcp
      ? { ...config.mcp, servers: [...(config.mcp.servers ?? [])] }
      : {},
  } as LoadedConfig;
  ensureCuaMcpServer(runtimeConfig, options);
  return runtimeConfig.mcp?.servers ?? [];
}

export function parseCuaDriverVersion(output: string): string | null {
  return /\bv?(\d+\.\d+\.\d+)(?:[-+][0-9A-Za-z.-]+)?\b/u.exec(output)?.[1] ?? null;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export async function inspectCuaDriver(
  driverPath: string,
  options: CuaDriverInspectionOptions = {},
): Promise<CuaDriverInspection> {
  const execute = options.execute ?? (async (command: string, args: string[]) => {
    const result = await executeFile(command, args, {
      encoding: 'utf8',
      timeout: 5_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  });
  try {
    const result = await execute(driverPath, ['--version']);
    const version = parseCuaDriverVersion(`${result.stdout}\n${result.stderr}`);
    if (!version) {
      return { status: 'broken', path: driverPath, error: 'Cua Driver returned an unrecognized version.' };
    }
    return {
      status: 'ready',
      path: driverPath,
      version,
      supported: compareVersions(version, CUA_DRIVER_VERSION) >= 0,
    };
  } catch (error) {
    return {
      status: 'broken',
      path: driverPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
