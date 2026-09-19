/** @license Apache-2.0 */
import net, { type Server, type Socket } from 'node:net';
import { promises as nodeFs } from 'node:fs';
import fs from 'fs-extra';
import { acquireFileLock, atomicWriteJson, type FileLockLease } from '../../utils/atomicFile.js';
import type { AhTracesRuntimePaths } from '../runtimePaths.js';
import type {
  AhTracesControlCommand,
  AhTracesControlResponse,
  AhTracesDaemonState,
} from '../supervisor/AhTracesSupervisor.js';

const CONTROL_REQUEST_LIMIT_BYTES = 16 * 1024;
const MAX_CONTROL_CONNECTIONS = 32;

export interface AhTracesMonitor {
  start(): Promise<void>;
  refreshConfig(): Promise<void>;
  stop(): Promise<void>;
}

export interface AhTracesDaemonOptions {
  paths: AhTracesRuntimePaths;
  version: string;
  protocolVersion: number;
  configPath: string;
  instanceId: string;
  controlToken: string;
  monitor: AhTracesMonitor;
}

interface ControlRequest {
  token: string;
  command: AhTracesControlCommand;
}

function isControlRequest(value: unknown): value is ControlRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const request = value as Partial<ControlRequest>;
  return typeof request.token === 'string'
    && typeof request.command === 'object'
    && request.command !== null
    && ['ping', 'refresh-config', 'shutdown'].includes(request.command.type);
}

export class AhTracesDaemon {
  private lease: FileLockLease | null = null;
  private server: Server | null = null;
  private readonly connections = new Set<Socket>();
  private state: AhTracesDaemonState | null = null;
  private stopping: Promise<void> | null = null;
  private resolveStopped: (() => void) | null = null;
  private readonly stopped = new Promise<void>((resolve) => {
    this.resolveStopped = resolve;
  });
  private readonly terminate = (): void => {
    void this.stop();
  };

  constructor(private readonly options: AhTracesDaemonOptions) {}

  async start(): Promise<void> {
    await fs.ensureDir(this.options.paths.directory, 0o700);
    this.lease = await acquireFileLock(this.options.paths.daemonLock, {
      staleMs: 30_000,
      waitTimeoutMs: 0,
    });
    if (!this.lease) {
      throw new Error('ahtraces is already running for this Autohand home.');
    }

    try {
      if (process.platform !== 'win32') {
        await nodeFs.unlink(this.options.paths.socketPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
      this.server = net.createServer((socket) => this.accept(socket));
      await new Promise<void>((resolve, reject) => {
        const server = this.server!;
        server.once('error', reject);
        server.listen(this.options.paths.socketPath, () => {
          server.off('error', reject);
          resolve();
        });
      });
      if (process.platform !== 'win32') {
        await nodeFs.chmod(this.options.paths.socketPath, 0o600);
      }

      this.state = {
        pid: process.pid,
        instanceId: this.options.instanceId,
        version: this.options.version,
        protocolVersion: this.options.protocolVersion,
        configPath: this.options.configPath,
        socketPath: this.options.paths.socketPath,
        controlToken: this.options.controlToken,
        startedAt: new Date().toISOString(),
      };
      await atomicWriteJson(this.options.paths.stateFile, this.state);
      await nodeFs.chmod(this.options.paths.stateFile, 0o600).catch(() => {});
      process.once('SIGINT', this.terminate);
      process.once('SIGTERM', this.terminate);
      await this.options.monitor.start();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = this.stopInternal();
    return this.stopping;
  }

  waitUntilStopped(): Promise<void> {
    return this.stopped;
  }

  private accept(socket: Socket): void {
    if (this.connections.size >= MAX_CONTROL_CONNECTIONS) {
      socket.destroy();
      return;
    }
    this.connections.add(socket);
    socket.setEncoding('utf8');
    socket.setTimeout(1_000, () => socket.destroy());
    socket.once('close', () => this.connections.delete(socket));
    socket.once('error', () => socket.destroy());
    let input = '';
    socket.on('data', (chunk: string) => {
      input += chunk;
      if (Buffer.byteLength(input) > CONTROL_REQUEST_LIMIT_BYTES) {
        this.respond(socket, { ok: false, error: 'Control request exceeded its size limit' });
        return;
      }
      const newline = input.indexOf('\n');
      if (newline < 0) return;
      socket.removeAllListeners('data');
      void this.handleLine(socket, input.slice(0, newline));
    });
  }

  private async handleLine(socket: Socket, line: string): Promise<void> {
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch {
      this.respond(socket, { ok: false, error: 'Invalid control request' });
      return;
    }
    if (!isControlRequest(request)) {
      this.respond(socket, { ok: false, error: 'Invalid control request' });
      return;
    }
    if (request.token !== this.options.controlToken) {
      this.respond(socket, { ok: false, error: 'Unauthorized control request' });
      return;
    }

    switch (request.command.type) {
      case 'ping':
        this.respond(socket, { ok: true, state: this.state ?? undefined });
        return;
      case 'refresh-config':
        this.respond(socket, { ok: true });
        void this.options.monitor.refreshConfig().catch(() => {});
        return;
      case 'shutdown':
        this.respond(socket, { ok: true }, () => {
          void this.stop();
        });
        return;
    }
  }

  private respond(socket: Socket, response: AhTracesControlResponse, onSent?: () => void): void {
    if (socket.destroyed) return;
    socket.end(`${JSON.stringify(response)}\n`, onSent);
  }

  private async stopInternal(): Promise<void> {
    process.off('SIGINT', this.terminate);
    process.off('SIGTERM', this.terminate);

    await this.options.monitor.stop().catch(() => {});
    for (const socket of this.connections) socket.destroy();
    this.connections.clear();
    if (this.server) {
      const server = this.server;
      this.server = null;
      await new Promise<void>((resolve) => server.close(() => resolve())).catch(() => {});
    }

    if (this.state) {
      try {
        const persisted = await fs.readJson(this.options.paths.stateFile) as Partial<AhTracesDaemonState>;
        if (persisted.instanceId === this.state.instanceId) {
          await nodeFs.unlink(this.options.paths.stateFile).catch(() => {});
        }
      } catch {
        // Missing or malformed state is already effectively removed.
      }
    }
    if (process.platform !== 'win32') {
      await nodeFs.unlink(this.options.paths.socketPath).catch(() => {});
    }
    await this.lease?.release().catch(() => {});
    this.lease = null;
    this.state = null;
    this.resolveStopped?.();
    this.resolveStopped = null;
  }
}
