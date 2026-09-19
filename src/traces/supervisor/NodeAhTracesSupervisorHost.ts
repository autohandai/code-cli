/** @license Apache-2.0 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import fs from 'fs-extra';
import { withFileLock } from '../../utils/atomicFile.js';
import { killAfter } from '../../utils/processTimeout.js';
import type { AhTracesRuntimePaths } from '../runtimePaths.js';
import {
  matchesAhTracesDaemonIdentity,
  type AhTracesControlCommand,
  type AhTracesControlResponse,
  type AhTracesDaemonState,
  type AhTracesSupervisorHost,
} from './AhTracesSupervisor.js';

const execFileAsync = promisify(execFile);
const CONTROL_RESPONSE_LIMIT_BYTES = 64 * 1024;
const CONTROL_TIMEOUT_MS = 750;
const STARTUP_TIMEOUT_MS = 3_000;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 1_500;

interface AhTracesLaunchCommand {
  executable: string;
  args: string[];
}

export interface NodeAhTracesSupervisorHostOptions {
  paths: AhTracesRuntimePaths;
  launch?: () => Promise<AhTracesDaemonState>;
  launchCommand?: AhTracesLaunchCommand;
  configPath?: string;
  environment?: NodeJS.ProcessEnv;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isAhTracesDaemonState(value: unknown): value is AhTracesDaemonState {
  return isRecord(value)
    && Number.isSafeInteger(value.pid)
    && Number(value.pid) > 0
    && typeof value.instanceId === 'string'
    && value.instanceId.length > 0
    && typeof value.version === 'string'
    && Number.isSafeInteger(value.protocolVersion)
    && (value.configPath === undefined || (typeof value.configPath === 'string' && value.configPath.length > 0))
    && typeof value.socketPath === 'string'
    && typeof value.controlToken === 'string'
    && value.controlToken.length >= 16
    && typeof value.startedAt === 'string'
    && Number.isFinite(Date.parse(value.startedAt));
}

function isControlResponse(value: unknown): value is AhTracesControlResponse {
  return isRecord(value)
    && typeof value.ok === 'boolean'
    && (value.error === undefined || typeof value.error === 'string')
    && (value.state === undefined || isAhTracesDaemonState(value.state));
}

export function minimalAhTracesDaemonEnvironment(
  source: NodeJS.ProcessEnv,
  configPath: string | undefined,
): NodeJS.ProcessEnv {
  const allowed = [
    'PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TMPDIR', 'TEMP', 'TMP',
    'SystemRoot', 'WINDIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'KIMI_CODE_HOME', 'DSH_HOME',
    'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'AUTOHAND_HOME', 'AUTOHAND_API_URL', 'NODE_ENV',
  ];
  const environment: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    if (source[key] !== undefined) environment[key] = source[key];
  }
  if (configPath) environment.AUTOHAND_CONFIG = configPath;
  return environment;
}

export function resolveAhTracesLaunchCommand(
  environment: NodeJS.ProcessEnv = process.env,
): AhTracesLaunchCommand {
  const explicit = environment.AUTOHAND_AHTRACES_EXECUTABLE?.trim();
  if (explicit) return { executable: explicit, args: [] };

  const executableName = process.platform === 'win32' ? 'ahtraces.exe' : 'ahtraces';
  const siblingExecutable = path.join(path.dirname(process.execPath), executableName);
  if (siblingExecutable !== process.execPath && existsSync(siblingExecutable)) {
    return { executable: siblingExecutable, args: [] };
  }

  const entry = process.argv[1];
  if (entry && !entry.includes('$bunfs')) {
    const extension = path.extname(entry);
    const siblingEntry = path.join(path.dirname(entry), `ahtraces${extension || '.js'}`);
    if (existsSync(siblingEntry)) {
      return { executable: process.execPath, args: [...process.execArgv, siblingEntry] };
    }
  }

  throw new Error('Could not locate the ahtraces executable next to Autohand. Reinstall the current release.');
}

export class NodeAhTracesSupervisorHost implements AhTracesSupervisorHost {
  constructor(private readonly options: NodeAhTracesSupervisorHostOptions) {}

  async readState(): Promise<AhTracesDaemonState | null> {
    try {
      const value = await fs.readJson(this.options.paths.stateFile) as unknown;
      return isAhTracesDaemonState(value) ? value : null;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return null;
      return null;
    }
  }

  request(
    state: AhTracesDaemonState,
    command: AhTracesControlCommand,
  ): Promise<AhTracesControlResponse> {
    return new Promise((resolve) => {
      const socket = net.createConnection(state.socketPath);
      let settled = false;
      let response = '';
      const finish = (value: AhTracesControlResponse): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(value);
      };

      socket.setEncoding('utf8');
      socket.setTimeout(CONTROL_TIMEOUT_MS);
      socket.once('connect', () => {
        socket.write(`${JSON.stringify({ token: state.controlToken, command })}\n`);
      });
      socket.on('data', (chunk: string) => {
        response += chunk;
        if (Buffer.byteLength(response) > CONTROL_RESPONSE_LIMIT_BYTES) {
          finish({ ok: false, error: 'Control response exceeded its size limit' });
          return;
        }
        const newline = response.indexOf('\n');
        if (newline < 0) return;
        try {
          const parsed = JSON.parse(response.slice(0, newline)) as unknown;
          finish(isControlResponse(parsed)
            ? parsed
            : { ok: false, error: 'Invalid control response' });
        } catch {
          finish({ ok: false, error: 'Invalid control response' });
        }
      });
      socket.once('timeout', () => finish({ ok: false, error: 'Control request timed out' }));
      socket.once('error', () => finish({ ok: false, error: 'Control socket unavailable' }));
      socket.once('end', () => {
        if (!settled) finish({ ok: false, error: 'Control socket closed without a response' });
      });
    });
  }

  async launch(): Promise<AhTracesDaemonState> {
    if (this.options.launch) return this.options.launch();

    const command = this.options.launchCommand ?? resolveAhTracesLaunchCommand(this.options.environment);
    const instanceId = randomUUID();
    const child = spawn(command.executable, [
      ...command.args,
      '--daemon',
      '--instance-id',
      instanceId,
      ...(this.options.configPath ? ['--config', this.options.configPath] : []),
    ], {
      detached: true,
      stdio: 'ignore',
      shell: false,
      env: minimalAhTracesDaemonEnvironment(this.options.environment ?? process.env, this.options.configPath),
    });
    await this.awaitSpawn(child);
    child.unref();

    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const state = await this.readState();
      if (state?.instanceId === instanceId) {
        const ping = await this.request(state, { type: 'ping' });
        if (ping.ok && matchesAhTracesDaemonIdentity(state, ping.state)) return ping.state;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }

    child.kill('SIGTERM');
    killAfter(child, 500, () => child.kill('SIGKILL'));
    throw new Error('ahtraces did not become ready before its startup deadline.');
  }

  async forceTerminate(state: AhTracesDaemonState): Promise<void> {
    if (!await this.processBelongsToInstance(state)) {
      throw new Error('Refusing to terminate a process that is not the authenticated ahtraces instance.');
    }
    try {
      process.kill(state.pid, 'SIGTERM');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw error;
    }
    if (await this.waitForExit(state.pid, 750)) return;
    process.kill(state.pid, 'SIGKILL');
    await this.waitForExit(state.pid, 750);
  }

  waitForTermination(state: AhTracesDaemonState): Promise<boolean> {
    return this.waitForExit(state.pid, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
  }

  async clearLocalData(): Promise<void> {
    await Promise.all([
      fs.remove(this.options.paths.workMapFile),
      fs.remove(this.options.paths.checkpointsFile),
    ]);
  }

  withReconcileLock<T>(operation: () => Promise<T>): Promise<T> {
    return withFileLock(this.options.paths.supervisorLock, operation, {
      staleMs: 30_000,
      waitTimeoutMs: 3_500,
      retryDelayMs: 20,
    });
  }

  private awaitSpawn(child: ChildProcess): Promise<void> {
    return new Promise((resolve, reject) => {
      const onSpawn = (): void => {
        child.off('error', onError);
        resolve();
      };
      const onError = (): void => {
        child.off('spawn', onSpawn);
        reject(new Error('Could not start ahtraces. Reinstall the current Autohand release.'));
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });
  }

  private async processBelongsToInstance(state: AhTracesDaemonState): Promise<boolean> {
    if (process.platform === 'win32') return true;
    try {
      const { stdout } = await execFileAsync('ps', ['-p', String(state.pid), '-o', 'command='], {
        timeout: 500,
        encoding: 'utf8',
      });
      return stdout.includes('ahtraces') && stdout.includes(state.instanceId);
    } catch {
      return false;
    }
  }

  private async waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    return false;
  }
}
