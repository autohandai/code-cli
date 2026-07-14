/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface CliOwnedBackgroundService {
  start(): void;
  stop(): void | Promise<void>;
  shutdown?(options?: { timeoutMs?: number }): Promise<void>;
}

export interface CliRuntimeProcess {
  on(event: 'exit' | 'SIGINT' | 'SIGTERM', listener: () => void): this;
  off(event: 'exit' | 'SIGINT' | 'SIGTERM', listener: () => void): this;
}

export interface CliBackgroundStartup<
  AuthUser,
  VersionResult,
  Service extends CliOwnedBackgroundService = CliOwnedBackgroundService,
> {
  resolveAuthAndVersion(): Promise<{
    authUser: AuthUser | null;
    versionResult: VersionResult | null;
  }>;
  onVersionResult(result: VersionResult): void;
  shouldStartSync(authUser: AuthUser): boolean;
  createSyncService(authUser: AuthUser): Promise<Service>;
}

export interface CliRuntimeResourceOwnerOptions<
  Service extends CliOwnedBackgroundService = CliOwnedBackgroundService,
> {
  process: CliRuntimeProcess;
  stopPing(): void | Promise<void>;
  setSyncService(service: Service | null): void;
  onSignal(signal: 'SIGINT' | 'SIGTERM'): void | Promise<void>;
  shutdownTimeoutMs?: number;
}

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2500;

function cliAbortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('CLI lifecycle aborted', 'AbortError');
}

export function awaitCliLifecycleStep<T>(
  task: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    void task.catch(() => undefined);
    return Promise.reject(cliAbortReason(signal));
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort);
      reject(cliAbortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void task.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export class CliRuntimeResourceOwner<
  AuthUser,
  VersionResult,
  Service extends CliOwnedBackgroundService = CliOwnedBackgroundService,
> {
  private readonly runtimeProcess: CliRuntimeProcess;
  private readonly stopPingCallback: () => void | Promise<void>;
  private readonly setSyncServiceCallback: (
    service: Service | null,
  ) => void;
  private readonly onSignal: (
    signal: 'SIGINT' | 'SIGTERM',
  ) => void | Promise<void>;
  private readonly shutdownTimeoutMs: number;

  private generation = 0;
  private closed = false;
  private listenersInstalled = false;
  private pingStarted = false;
  private pingStopPromise: Promise<void> | null = null;
  private startupPromise: Promise<void> | null = null;
  private syncService: Service | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private registryCleared = false;
  private signalHandlingStarted = false;
  private readonly serviceStopPromises = new WeakMap<object, Promise<void>>();

  private readonly handleExit = (): void => {
    void this.shutdown();
  };

  private readonly handleSigint = (): void => {
    this.startSignalShutdown('SIGINT');
  };

  private readonly handleSigterm = (): void => {
    this.startSignalShutdown('SIGTERM');
  };

  constructor(options: CliRuntimeResourceOwnerOptions<Service>) {
    this.runtimeProcess = options.process;
    this.stopPingCallback = options.stopPing;
    this.setSyncServiceCallback = options.setSyncService;
    this.onSignal = options.onSignal;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    this.installProcessListeners();
  }

  startPing(startPing: () => void): void {
    if (this.closed || this.pingStarted) return;
    this.pingStarted = true;
    this.installProcessListeners();
    startPing();
  }

  startBackgroundStartup(
    startup: CliBackgroundStartup<AuthUser, VersionResult, Service>,
  ): void {
    if (this.closed || this.startupPromise) return;
    this.installProcessListeners();
    const generation = this.generation;
    const startupPromise = this.runBackgroundStartup(startup, generation)
      .catch(() => {
        // Auth, update, and sync startup are deliberately non-critical.
      });
    this.startupPromise = startupPromise;
  }

  shutdown(): Promise<void> {
    if (!this.shutdownPromise) {
      this.shutdownPromise = this.performShutdown();
    }
    return this.shutdownPromise;
  }

  private async runBackgroundStartup(
    startup: CliBackgroundStartup<AuthUser, VersionResult, Service>,
    generation: number,
  ): Promise<void> {
    const { authUser, versionResult } = await startup.resolveAuthAndVersion();
    if (!this.isGenerationActive(generation)) return;

    if (versionResult) {
      startup.onVersionResult(versionResult);
    }
    if (!authUser || !startup.shouldStartSync(authUser)) return;

    const service = await startup.createSyncService(authUser);
    if (!this.isGenerationActive(generation)) {
      await this.stopService(service);
      return;
    }

    this.syncService = service;
    try {
      service.start();
      if (!this.isGenerationActive(generation)) {
        this.syncService = null;
        await this.stopService(service);
        return;
      }
      this.setSyncServiceCallback(service);
    } catch {
      this.syncService = null;
      await this.stopService(service);
    }
  }

  private isGenerationActive(generation: number): boolean {
    return !this.closed && generation === this.generation;
  }

  private installProcessListeners(): void {
    if (this.listenersInstalled) return;
    this.listenersInstalled = true;
    this.runtimeProcess.on('exit', this.handleExit);
    this.runtimeProcess.on('SIGINT', this.handleSigint);
    this.runtimeProcess.on('SIGTERM', this.handleSigterm);
  }

  private removeProcessListeners(): void {
    if (!this.listenersInstalled) return;
    this.listenersInstalled = false;
    this.runtimeProcess.off('exit', this.handleExit);
    this.runtimeProcess.off('SIGINT', this.handleSigint);
    this.runtimeProcess.off('SIGTERM', this.handleSigterm);
  }

  private startSignalShutdown(signal: 'SIGINT' | 'SIGTERM'): void {
    if (this.signalHandlingStarted) return;
    this.signalHandlingStarted = true;
    this.closed = true;
    this.generation++;
    this.removeProcessListeners();
    void Promise.resolve()
      .then(() => this.onSignal(signal))
      .catch(() => undefined);
  }

  private async performShutdown(): Promise<void> {
    this.closed = true;
    this.generation++;
    this.removeProcessListeners();

    if (!this.registryCleared) {
      this.registryCleared = true;
      try {
        this.setSyncServiceCallback(null);
      } catch {
        // Resource teardown remains best-effort.
      }
    }

    const service = this.syncService;
    this.syncService = null;
    const work = [
      this.stopPing(),
      ...(service ? [this.stopService(service)] : []),
      ...(this.startupPromise ? [this.startupPromise] : []),
    ];
    await this.waitWithDeadline(Promise.allSettled(work));
  }

  private stopPing(): Promise<void> {
    if (!this.pingStarted) return Promise.resolve();
    if (!this.pingStopPromise) {
      this.pingStopPromise = Promise.resolve()
        .then(() => this.stopPingCallback())
        .then(() => undefined)
        .catch(() => undefined);
    }
    return this.pingStopPromise;
  }

  private stopService(service: Service): Promise<void> {
    const existing = this.serviceStopPromises.get(service);
    if (existing) return existing;

    const stopping = Promise.resolve()
      .then(async () => {
        if (service.shutdown) {
          await service.shutdown({ timeoutMs: this.shutdownTimeoutMs });
        } else {
          await service.stop();
        }
      })
      .catch(() => undefined);
    this.serviceStopPromises.set(service, stopping);
    return stopping;
  }

  private async waitWithDeadline(work: Promise<unknown>): Promise<void> {
    let deadline: ReturnType<typeof setTimeout> | null = null;
    const timedOut = new Promise<void>((resolve) => {
      deadline = setTimeout(resolve, this.shutdownTimeoutMs);
      deadline.unref?.();
    });
    try {
      await Promise.race([work.then(() => undefined), timedOut]);
    } finally {
      if (deadline) clearTimeout(deadline);
    }
  }
}
