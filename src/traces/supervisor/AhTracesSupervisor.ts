/**
 * Version-aware process supervisor for the persistent ahtraces sidecar.
 *
 * @license Apache-2.0
 */

export interface AhTracesDaemonState {
  pid: number;
  instanceId: string;
  version: string;
  protocolVersion: number;
  /** Absolute config file monitored by this daemon. Missing only in legacy state. */
  configPath?: string;
  socketPath: string;
  controlToken: string;
  startedAt: string;
}

export function matchesAhTracesDaemonIdentity(
  persisted: AhTracesDaemonState,
  reported: AhTracesDaemonState | undefined,
): reported is AhTracesDaemonState {
  return reported?.instanceId === persisted.instanceId
    && reported.controlToken === persisted.controlToken;
}

export type AhTracesControlCommand =
  | { type: 'ping' }
  | { type: 'refresh-config' }
  | { type: 'shutdown' };

export interface AhTracesControlResponse {
  ok: boolean;
  state?: AhTracesDaemonState;
  error?: string;
}

export interface AhTracesSupervisorHost {
  readState(): Promise<AhTracesDaemonState | null>;
  request(
    state: AhTracesDaemonState,
    command: AhTracesControlCommand,
  ): Promise<AhTracesControlResponse>;
  launch(): Promise<AhTracesDaemonState>;
  /** Wait for a graceful shutdown to release the daemon process and lock. */
  waitForTermination(state: AhTracesDaemonState): Promise<boolean>;
  /** Force termination is allowed only after an authenticated control ping. */
  forceTerminate(state: AhTracesDaemonState): Promise<void>;
  /** Remove aggregate Work Map and parser checkpoints after consent is withdrawn. */
  clearLocalData(): Promise<void>;
  withReconcileLock<T>(operation: () => Promise<T>): Promise<T>;
}

export interface AhTracesSupervisorVersion {
  version: string;
  protocolVersion: number;
  configPath: string;
}

export type AhTracesSupervisorResult =
  | { status: 'disabled' }
  | { status: 'running'; pid: number; restarted: boolean };

export class AhTracesSupervisor {
  private activeReconcile: {
    enabled: boolean;
    promise: Promise<AhTracesSupervisorResult>;
  } | null = null;

  constructor(
    private readonly host: AhTracesSupervisorHost,
    private readonly current: AhTracesSupervisorVersion,
  ) {}

  reconcile(config: { enabled: boolean }): Promise<AhTracesSupervisorResult> {
    if (this.activeReconcile?.enabled === config.enabled) {
      return this.activeReconcile.promise;
    }

    const previous = this.activeReconcile?.promise.catch(() => undefined) ?? Promise.resolve();
    const promise = previous
      .then(() => this.host.withReconcileLock(() => this.reconcileLocked(config)))
      .finally(() => {
        if (this.activeReconcile?.promise === promise) {
          this.activeReconcile = null;
        }
      });
    this.activeReconcile = { enabled: config.enabled, promise };
    return promise;
  }

  private async reconcileLocked(config: { enabled: boolean }): Promise<AhTracesSupervisorResult> {
    const state = await this.host.readState();

    if (!config.enabled) {
      if (state) await this.stopVerified(state);
      await this.host.clearLocalData();
      return { status: 'disabled' };
    }

    if (!state) {
      const launched = await this.host.launch();
      return { status: 'running', pid: launched.pid, restarted: false };
    }

    const ping = await this.host.request(state, { type: 'ping' });
    const authenticatedState = ping.ok
      && matchesAhTracesDaemonIdentity(state, ping.state)
      ? ping.state
      : null;

    if (
      authenticatedState
      && authenticatedState.version === this.current.version
      && authenticatedState.protocolVersion === this.current.protocolVersion
      && authenticatedState.configPath === this.current.configPath
    ) {
      const refresh = await this.host.request(authenticatedState, { type: 'refresh-config' });
      if (refresh.ok) {
        return { status: 'running', pid: authenticatedState.pid, restarted: false };
      }
    }

    if (authenticatedState) {
      await this.stopAuthenticated(authenticatedState);
    }
    const launched = await this.host.launch();
    return { status: 'running', pid: launched.pid, restarted: true };
  }

  private async stopVerified(state: AhTracesDaemonState): Promise<void> {
    const ping = await this.host.request(state, { type: 'ping' });
    if (
      !ping.ok
      || !matchesAhTracesDaemonIdentity(state, ping.state)
    ) {
      return;
    }
    await this.stopAuthenticated(ping.state);
  }

  private async stopAuthenticated(state: AhTracesDaemonState): Promise<void> {
    const shutdown = await this.host.request(state, { type: 'shutdown' });
    if (shutdown.ok && await this.host.waitForTermination(state)) return;
    await this.host.forceTerminate(state);
  }
}
