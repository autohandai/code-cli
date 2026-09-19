#!/usr/bin/env node
/** @license Apache-2.0 */
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { AUTOHAND_HOME } from './constants.js';
import { getOrCreateCodingAgentDeviceId } from './sync/CodingAgentControlPlane.js';
import { createTraceSourceRegistry } from './traces/adapters/sourceRegistry.js';
import { AhTracesDaemon } from './traces/daemon/AhTracesDaemon.js';
import { PersistentTraceMonitor } from './traces/daemon/PersistentTraceMonitor.js';
import { resolveAhTracesRuntimePaths } from './traces/runtimePaths.js';
import { NodeAhTracesSupervisorHost } from './traces/supervisor/NodeAhTracesSupervisorHost.js';
import {
  matchesAhTracesDaemonIdentity,
  type AhTracesDaemonState,
  type AhTracesSupervisorHost,
} from './traces/supervisor/AhTracesSupervisor.js';
import { WorkMapModule } from './traces/WorkMapModule.js';
import {
  AHTRACES_PROTOCOL_VERSION,
  getAhTracesDisplayVersion,
  getAhTracesVersion,
} from './traces/version.js';

type AhTracesCommand = 'daemon' | 'status' | 'stop' | 'version' | 'help';

export interface AhTracesArguments {
  command: AhTracesCommand;
  instanceId?: string;
  configPath?: string;
  json: boolean;
}

export function parseAhTracesArguments(argv: string[]): AhTracesArguments {
  let command: AhTracesCommand | undefined;
  let instanceId: string | undefined;
  let configPath: string | undefined;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--daemon') {
      command = 'daemon';
    } else if (argument === '--instance-id') {
      instanceId = argv[index + 1];
      index += 1;
    } else if (argument === '--config') {
      configPath = argv[index + 1];
      index += 1;
    } else if (argument === '--json') {
      json = true;
    } else if (argument === '--version' || argument === '-v') {
      command = 'version';
    } else if (argument === '--help' || argument === '-h') {
      command = 'help';
    } else if (!argument.startsWith('-') && (argument === 'status' || argument === 'stop')) {
      command = argument;
    } else {
      throw new Error(`Unknown ahtraces command: ${argument}`);
    }
  }
  command ??= 'help';
  if (command === 'daemon' && (!instanceId || !/^[A-Za-z0-9-]{1,128}$/u.test(instanceId))) {
    throw new Error('The internal daemon launch requires a valid --instance-id.');
  }
  if ((argv.includes('--config') && !configPath) || (argv.includes('--instance-id') && !instanceId)) {
    throw new Error('A required option value is missing.');
  }
  return {
    command,
    ...(instanceId ? { instanceId } : {}),
    ...(configPath ? { configPath } : {}),
    json,
  };
}

function runtimePaths() {
  return resolveAhTracesRuntimePaths({
    autohandHome: AUTOHAND_HOME,
    temporaryDirectory: os.tmpdir(),
  });
}

export function isMatchingLiveState(
  persisted: AhTracesDaemonState,
  reported: AhTracesDaemonState | undefined,
): boolean {
  return matchesAhTracesDaemonIdentity(persisted, reported);
}

async function runDaemon(argumentsValue: AhTracesArguments): Promise<number> {
  const configPath = argumentsValue.configPath ?? process.env.AUTOHAND_CONFIG;
  const readConfig = () => loadConfig(configPath, undefined, {
    createIfMissing: false,
    initializeTheme: false,
  });
  const initialConfig = await readConfig();
  if (initialConfig.traces?.enabled !== true) return 0;
  const paths = runtimePaths();
  const registry = createTraceSourceRegistry({
    homeDirectory: os.homedir(),
    autohandHome: AUTOHAND_HOME,
    environment: process.env,
  });
  const workMap = new WorkMapModule(registry);
  const monitor = new PersistentTraceMonitor({
    paths,
    loadConfig: readConfig,
    workMap,
    clientVersion: getAhTracesDisplayVersion(),
    deviceId: await getOrCreateCodingAgentDeviceId(),
    onDisabled: () => {
      void daemon.stop();
    },
  });
  const daemon = new AhTracesDaemon({
    paths,
    version: getAhTracesVersion(),
    protocolVersion: AHTRACES_PROTOCOL_VERSION,
    configPath: initialConfig.configPath,
    instanceId: argumentsValue.instanceId!,
    controlToken: randomBytes(32).toString('base64url'),
    monitor,
  });
  await daemon.start();
  await daemon.waitUntilStopped();
  return 0;
}

async function readLiveState() {
  const paths = runtimePaths();
  const host = new NodeAhTracesSupervisorHost({ paths, launch: async () => {
    throw new Error('launch is unavailable from status commands');
  } });
  const state = await host.readState();
  if (!state) return { host, state: null };
  const ping = await host.request(state, { type: 'ping' });
  return {
    host,
    state: ping.ok && isMatchingLiveState(state, ping.state) ? ping.state : null,
  };
}

async function runStatus(json: boolean): Promise<number> {
  const { state } = await readLiveState();
  const output = state
    ? { running: true, pid: state.pid, version: state.version, startedAt: state.startedAt }
    : { running: false };
  console.log(json ? JSON.stringify(output) : state
    ? `ahtraces is running (pid ${state.pid}, version ${state.version}).`
    : 'ahtraces is not running.');
  return state ? 0 : 1;
}

type AhTracesStopHost = Pick<
  AhTracesSupervisorHost,
  'request' | 'waitForTermination' | 'forceTerminate'
>;

export async function stopAuthenticatedDaemon(
  host: AhTracesStopHost,
  state: AhTracesDaemonState,
): Promise<void> {
  const response = await host.request(state, { type: 'shutdown' });
  if (!response.ok) throw new Error('The authenticated ahtraces daemon did not accept shutdown.');
  if (await host.waitForTermination(state)) return;
  await host.forceTerminate(state);
  if (!await host.waitForTermination(state)) {
    throw new Error('The authenticated ahtraces daemon did not stop.');
  }
}

async function runStop(json: boolean): Promise<number> {
  const { host, state } = await readLiveState();
  if (!state) {
    console.log(json ? JSON.stringify({ stopped: true, alreadyStopped: true }) : 'ahtraces is already stopped.');
    return 0;
  }
  await stopAuthenticatedDaemon(host, state);
  console.log(json ? JSON.stringify({ stopped: true, alreadyStopped: false }) : 'ahtraces stopped.');
  return 0;
}

function printHelp(): void {
  console.log([
    'Usage: ahtraces <command>',
    '',
    'Commands:',
    '  status       Show whether the Autohand trace monitor is running',
    '  stop         Stop the authenticated local trace monitor',
    '',
    'Options:',
    '  --json       Emit machine-readable status',
    '  -v, --version',
    '  -h, --help',
    '',
    'Trace collection and cloud sync are controlled in autohand settings.',
  ].join('\n'));
}

export async function runAhTraces(argv = process.argv.slice(2)): Promise<number> {
  const argumentsValue = parseAhTracesArguments(argv);
  if (argumentsValue.command === 'daemon') return runDaemon(argumentsValue);
  if (argumentsValue.command === 'status') return runStatus(argumentsValue.json);
  if (argumentsValue.command === 'stop') return runStop(argumentsValue.json);
  if (argumentsValue.command === 'version') {
    console.log(getAhTracesDisplayVersion());
    return 0;
  }
  printHelp();
  return 0;
}

function isMainModule(): boolean {
  if ((import.meta as ImportMeta & { main?: boolean }).main === true) return true;
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isMainModule()) {
  runAhTraces().then((code) => {
    process.exitCode = code;
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'ahtraces failed.');
    process.exitCode = 1;
  });
}
