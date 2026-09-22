/** @license Apache-2.0 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { LoadedConfig } from '../../types.js';
import { AUTOHAND_HOME } from '../../constants.js';
import { getOrCreateCodingAgentDeviceId } from '../../sync/CodingAgentControlPlane.js';
import { killAfter } from '../../utils/processTimeout.js';
import { isTraceMonitoringEnabled, TRACE_CONSENT_VERSION } from './consent.js';

const SETTINGS_SCHEMA_VERSION = 1 as const;
const DEFAULT_API_BASE_URL = 'https://api.autohand.ai';
const MAX_INPUT_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const COMMAND_TIMEOUT_MS = 15_000;

export interface AhTracesSettings {
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  consentVersion: number;
  enabled: boolean;
  cloudSync: boolean;
  contentMode: 'metadata' | 'full';
  discoveryMap: boolean;
  pollIntervalMs?: number;
  apiBaseUrl: string;
  authToken?: string;
  deviceId: string;
}

export interface AhTracesInvocation {
  input?: string;
  signal?: AbortSignal;
}

export interface AhTracesProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type AhTracesRunner = (
  args: readonly string[],
  invocation: AhTracesInvocation,
) => Promise<AhTracesProcessResult>;

export type AhTracesRuntimeResult =
  | { status: 'disabled' }
  | { status: 'running'; pid: number; restarted: boolean }
  | { status: 'error'; code: 'unavailable' };

export interface ReconcileAhTracesOptions {
  strict?: boolean;
  run?: AhTracesRunner;
  deviceId?: string;
  environment?: NodeJS.ProcessEnv;
  hasRuntimeArtifacts?: () => boolean;
  signal?: AbortSignal;
}

function abortError(): Error {
  const error = new Error('ahtraces command was aborted.');
  error.name = 'AbortError';
  return error;
}

function appendBounded(current: string, chunk: Buffer, streamName: string): string {
  const next = current + chunk.toString('utf8');
  if (Buffer.byteLength(next) > MAX_OUTPUT_BYTES) {
    throw new Error(`ahtraces ${streamName} exceeded its output limit.`);
  }
  return next;
}

export function resolveAhTracesExecutable(
  environment: NodeJS.ProcessEnv = process.env,
  currentExecutable = process.execPath,
  platform: NodeJS.Platform = process.platform,
): string {
  const explicit = environment.AUTOHAND_AHTRACES_EXECUTABLE?.trim()
    || environment.AUTOHAND_TRACES_PATH?.trim();
  if (explicit) return explicit;
  const pathApi = platform === 'win32' ? path.win32 : path;
  return pathApi.join(
    pathApi.dirname(currentExecutable),
    platform === 'win32' ? 'ahtraces.exe' : 'ahtraces',
  );
}

export async function runAhTracesProcess(
  args: readonly string[],
  invocation: AhTracesInvocation = {},
): Promise<AhTracesProcessResult> {
  if (invocation.signal?.aborted) throw abortError();
  if (invocation.input && Buffer.byteLength(invocation.input) > MAX_INPUT_BYTES) {
    throw new Error('ahtraces input exceeded its size limit.');
  }

  const child = spawn(resolveAhTracesExecutable(), [...args], {
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return collectAhTracesProcess(child, invocation);
}

function collectAhTracesProcess(
  child: ChildProcessWithoutNullStreams,
  invocation: AhTracesInvocation,
): Promise<AhTracesProcessResult> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const cleanup = (): void => {
      invocation.signal?.removeEventListener('abort', onAbort);
    };
    const finish = (error?: Error, exitCode?: number): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    };
    const terminate = (error: Error): void => {
      child.kill('SIGTERM');
      killAfter(child, 500, () => child.kill('SIGKILL'));
      finish(error);
    };
    const onAbort = (): void => terminate(abortError());

    invocation.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        stdout = appendBounded(stdout, chunk, 'stdout');
      } catch (error) {
        terminate(error as Error);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      try {
        stderr = appendBounded(stderr, chunk, 'stderr');
      } catch (error) {
        terminate(error as Error);
      }
    });
    child.once('error', (error) => finish(error));
    child.once('close', (code) => {
      if (timedOut) {
        finish(new Error('ahtraces command timed out.'));
        return;
      }
      finish(undefined, code ?? 1);
    });
    child.stdin.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') finish(error);
    });
    child.stdin.end(invocation.input);
    killAfter(child, COMMAND_TIMEOUT_MS, () => {
      timedOut = true;
      child.kill('SIGTERM');
      killAfter(child, 500, () => child.kill('SIGKILL'));
    });
  });
}

export function createAhTracesSettings(
  config: LoadedConfig,
  deviceId: string,
  environment: NodeJS.ProcessEnv = process.env,
): AhTracesSettings {
  const enabled = isTraceMonitoringEnabled(config);
  const cloudSync = enabled && config.traces?.cloudSync === true;
  const configuredApi = config.api?.baseUrl?.trim()
    || environment.AUTOHAND_API_URL?.trim()
    || DEFAULT_API_BASE_URL;
  const apiBaseUrl = configuredApi.replace(/\/+$/u, '');
  new URL(apiBaseUrl);
  const authToken = cloudSync
    ? config.auth?.token?.trim() || environment.AUTOHAND_API_KEY?.trim()
    : undefined;
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    consentVersion: TRACE_CONSENT_VERSION,
    enabled,
    cloudSync,
    contentMode: enabled && config.traces?.contentMode === 'full' ? 'full' : 'metadata',
    discoveryMap: enabled && config.traces?.discoveryMap !== false,
    ...(config.traces?.pollIntervalMs === undefined
      ? {}
      : { pollIntervalMs: config.traces.pollIntervalMs }),
    apiBaseUrl,
    ...(authToken ? { authToken } : {}),
    deviceId,
  };
}

function defaultHasRuntimeArtifacts(): boolean {
  const directory = path.join(AUTOHAND_HOME, 'traces');
  return ['daemon.json', 'daemon.lock', 'checkpoints.json', 'work-map.json']
    .some((fileName) => existsSync(path.join(directory, fileName)));
}

function parseReconcileResult(output: string): Exclude<AhTracesRuntimeResult, { status: 'error' }> {
  const value = JSON.parse(output.trim()) as unknown;
  if (!value || typeof value !== 'object' || !('status' in value)) {
    throw new Error('ahtraces returned an invalid reconcile response.');
  }
  const result = value as Record<string, unknown>;
  if (result.status === 'disabled') return { status: 'disabled' };
  if (result.status === 'running'
    && Number.isSafeInteger(result.pid)
    && typeof result.restarted === 'boolean') {
    return { status: 'running', pid: Number(result.pid), restarted: result.restarted };
  }
  throw new Error('ahtraces returned an invalid reconcile response.');
}

export function shouldReconcileAhTracesAtStartup(
  bare: boolean,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return !bare && environment.AUTOHAND_CODE_SIMPLE !== '1';
}

export async function reconcileAhTraces(
  config: LoadedConfig,
  options: ReconcileAhTracesOptions = {},
): Promise<AhTracesRuntimeResult> {
  try {
    const enabled = isTraceMonitoringEnabled(config);
    if (!enabled && !(options.hasRuntimeArtifacts ?? defaultHasRuntimeArtifacts)()) {
      return { status: 'disabled' };
    }
    const deviceId = options.deviceId ?? await getOrCreateCodingAgentDeviceId();
    const settings = createAhTracesSettings(config, deviceId, options.environment);
    const result = await (options.run ?? runAhTracesProcess)(['reconcile', '--json'], {
      input: `${JSON.stringify(settings)}\n`,
      signal: options.signal,
    });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `ahtraces exited with code ${result.exitCode}.`);
    }
    return parseReconcileResult(result.stdout);
  } catch (error) {
    if (options.strict) throw error;
    return { status: 'error', code: 'unavailable' };
  }
}
