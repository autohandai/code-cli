import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess, type SpawnOptions, type SpawnSyncReturns } from 'node:child_process';
import { PeerError } from './PeerProtocol.js';
import { capturePeerProcess } from './PeerProcessIdentity.js';
import type { ResourceCoordinatorClient, ResourceCommand, ResourceReservation } from './ResourceCoordinator.js';

export interface CommandCoordinationContext {
  coordinator: ResourceCoordinatorClient;
  requestId?: string;
  signal?: AbortSignal;
  waitTimeoutMs?: number;
  onWaiting?: (activity: { phase: 'waiting_resource'; resource: string; requestId: string }) => void;
  onRecoveryRequired?: (error: Error) => void;
}

const contexts = new AsyncLocalStorage<CommandCoordinationContext>();
const processLaunches = new WeakMap<ChildProcess, CoordinatedCommandLaunch>();

export function withCommandCoordination<T>(context: CommandCoordinationContext, operation: () => T): T {
  return contexts.run(context, operation);
}

export function getCommandCoordination(): CommandCoordinationContext | undefined { return contexts.getStore(); }

export async function executeCoordinatedFile(command: ResourceCommand, options: { input?: string; timeoutMs?: number; maxBuffer?: number; signal?: AbortSignal } = {}): Promise<SpawnSyncReturns<string>> {
  options = { ...options, signal: options.signal ?? contexts.getStore()?.signal };
  const child = await spawnCoordinatedProcess(command, { stdio: 'pipe', windowsHide: true }, options.signal);
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let failure: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const terminate = (error: Error) => {
      if (failure) return;
      failure = error;
      signalCoordinatedProcess(child);
      killTimer = setTimeout(() => signalCoordinatedProcess(child, 'SIGKILL'), 1_000);
      killTimer.unref?.();
    };
    const abort = () => terminate(new DOMException('Command aborted.', 'AbortError'));
    const timer = setTimeout(() => terminate(new Error('Command execution timed out.')), options.timeoutMs ?? 120_000);
    const maxBuffer = options.maxBuffer ?? 8 * 1024 * 1024;
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (data: string) => { stdout += data; if (Buffer.byteLength(stdout) > maxBuffer) terminate(new Error('Command output limit exceeded.')); });
    child.stderr?.on('data', (data: string) => { stderr += data; if (Buffer.byteLength(stderr) > maxBuffer) terminate(new Error('Command error output limit exceeded.')); });
    child.once('error', error => { failure = error; });
    child.stdin?.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') terminate(error); });
    child.once('close', (status, signal) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', abort);
      void waitForProcessPublication(child).then(() => {
        if (failure) reject(failure);
        else resolve({ pid: child.pid ?? 0, output: [null, stdout, stderr], stdout, stderr, status, signal });
      }, reject);
    });
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdin?.end(options.input);
    if (options.signal?.aborted) abort();
  });
}

export async function waitForProcessPublication(child: ChildProcess): Promise<void> {
  await processLaunches.get(child)?.waitForPublication();
}

export function signalCoordinatedProcess(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (processLaunches.has(child) && child.pid) {
    try { process.kill(-child.pid, signal); return; } catch { /* The owned group may already have exited. */ }
  }
  child.kill(signal);
}

export async function spawnCoordinatedProcess(command: ResourceCommand, options: SpawnOptions = {}, signal?: AbortSignal): Promise<ChildProcess> {
  const coordinated = await prepareCommandCoordination(command, signal);
  try {
    signal?.throwIfAborted();
    const child = spawn(command.file, command.args, { ...options, cwd: command.cwd, ...(coordinated ? { detached: true } : {}) });
    coordinated?.observe(child);
    return child;
  } catch (error) {
    await coordinated?.failed(error);
    throw error;
  }
}

export async function prepareCommandCoordination(command: ResourceCommand, signal?: AbortSignal): Promise<CoordinatedCommandLaunch | undefined> {
  const context = contexts.getStore();
  if (!context) return undefined;
  signal ??= context.signal;
  if (signal?.aborted) throw new DOMException('Command wait aborted.', 'AbortError');
  const requirements = await context.coordinator.commandRequirements(command);
  if (process.platform === 'win32') throw new PeerError('UNSUPPORTED_PLATFORM', 'Resource enforcement requires a verified Windows job adapter.');
  const tickets: Array<{ requestId: string; epoch: number }> = [];
  const allocated = new Set<string>();
  const reservations: ResourceReservation[] = [];
  const launchId = randomUUID();
  try {
    for (const requirement of requirements) {
      const requested = await context.coordinator.claimCommand({ resource: requirement.resource, command, launchId,
        ...(context.requestId ? { requestId: context.requestId } : {}),
      });
      const requestId = requested.requestId;
      if (!requestId) throw new PeerError('RECOVERY_REQUIRED', 'The coordinator did not return a resource ticket.');
      allocated.add(requestId);
      try { context.onWaiting?.({ phase: 'waiting_resource', resource: requirement.resource, requestId }); } catch { /* Presentation cannot grant a command. */ }
      const granted = await context.coordinator.waitForGrant(requestId, { timeoutMs: context.waitTimeoutMs ?? 300_000, signal });
      if (granted.resource !== requirement.resource) throw new PeerError('SCOPE_DENIED', 'The supplied reservation belongs to a different resource.');
      tickets.push({ requestId, epoch: granted.epoch });
    }
    for (const ticket of tickets) {
      if (signal?.aborted) throw new DOMException('Command wait aborted.', 'AbortError');
      reservations.push(await context.coordinator.beforeSpawn({ ...ticket, command }));
    }
    await context.coordinator.beginLaunch?.(launchId, command, reservations.map(reservation => reservation.reservationId));
    return new CoordinatedCommandLaunch(context, reservations, launchId);
  } catch (error) {
    await Promise.allSettled(reservations.map(reservation => context.coordinator.confirmSpawnFailure(reservation.reservationId)));
    await Promise.allSettled([...allocated].map(requestId => context.coordinator.coordinate({ operation: 'cancel_request', requestId })));
    throw error;
  }
}

export class CoordinatedCommandLaunch {
  private resolveStarted = () => {};
  private rejectStarted: (error: unknown) => void = () => {};
  readonly started = new Promise<void>((resolve, reject) => { this.resolveStarted = resolve; this.rejectStarted = reject; });
  private spawnSeen = false;
  private observed = false;
  private completionStarted = false;
  private recoveryReported = false;
  private publishing: Promise<void> = Promise.resolve();

  constructor(private readonly context: CommandCoordinationContext, private readonly reservations: ResourceReservation[], private readonly launchId: string = randomUUID()) {
    void this.started.catch(() => {});
  }

  observe(child: ChildProcess): void {
    if (this.observed) throw new PeerError('RESOURCE_BUSY', 'The spawn reservation has already been attached to a process.');
    this.observed = true;
    processLaunches.set(child, this);
    child.once('spawn', () => {
      this.spawnSeen = true;
      this.publishing = this.publish(child);
      void this.publishing.then(this.resolveStarted, error => { this.rejectStarted(error); this.report(error); });
    });
    child.once('error', error => {
      if (!this.spawnSeen) void this.failed(error);
    });
    child.once('close', () => { if (this.spawnSeen) void this.drain(); });
  }

  observePty(child: { readonly pid?: number; onExit(callback: () => void): { dispose(): void } }): void {
    if (this.observed) throw new PeerError('RESOURCE_BUSY', 'The spawn reservation is already attached to a process.');
    this.observed = true;
    this.spawnSeen = true;
    let exited = false;
    let finishExit = () => {};
    const exit = new Promise<void>(resolve => { finishExit = resolve; });
    this.publishing = this.publishProcess(child.pid, () => exited, () => exit);
    const subscription = child.onExit(() => {
      exited = true;
      finishExit();
      subscription?.dispose();
      void this.drain();
    });
    void this.publishing.then(this.resolveStarted, error => { this.rejectStarted(error); this.report(error); });
  }

  async failed(error: unknown): Promise<void> {
    if (this.spawnSeen) return;
    await Promise.allSettled(this.reservations.map(reservation => this.context.coordinator.confirmSpawnFailure(reservation.reservationId)));
    await this.context.coordinator.finishLaunch?.(this.launchId, true).catch(error => this.report(error));
    this.rejectStarted(error);
  }

  async waitForPublication(): Promise<void> {
    try { await this.started; } catch (error) { if (this.spawnSeen) throw error; }
  }

  private async publish(child: ChildProcess): Promise<void> {
    return this.publishProcess(child.pid, () => child.exitCode !== null || child.signalCode !== null,
      () => new Promise<void>(resolve => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once('exit', () => resolve()); }));
  }

  private async publishProcess(pid: number | undefined, exited: () => boolean, waitForExit: () => Promise<void>): Promise<void> {
    if (!pid) throw new PeerError('RECOVERY_REQUIRED', 'The command spawned without a verifiable process ID.');
    const proof = await capturePeerProcess(pid);
    if (!proof && !exited()) await waitForExit();
    const identity = proof ?? { pid, processGroupId: pid, startedAt: `observed-exit:${this.launchId}` };
    await this.context.coordinator.publishLaunch?.(this.launchId, identity);
    for (const reservation of this.reservations) await this.context.coordinator.recordSpawn(reservation.reservationId, identity);
  }

  private async drain(): Promise<void> {
    if (this.completionStarted) return;
    this.completionStarted = true;
    try { await this.publishing; } catch { return; }
    const pending = new Set(this.reservations.map(reservation => reservation.reservationId));
    let launchPending = true;
    const check = async (): Promise<void> => {
      for (const reservationId of pending) {
        try {
          await this.context.coordinator.complete(reservationId);
          pending.delete(reservationId);
        } catch (error) {
          if (error instanceof PeerError && error.code === 'UNKNOWN_TARGET') pending.delete(reservationId);
          else if (!(error instanceof PeerError) || error.code !== 'RESOURCE_BUSY') { this.report(error); pending.delete(reservationId); }
        }
      }
      if (launchPending) {
        try { await this.context.coordinator.finishLaunch?.(this.launchId); launchPending = false; }
        catch (error) { if (!(error instanceof PeerError) || error.code !== 'RESOURCE_BUSY') { this.report(error); launchPending = false; } }
      }
      if (pending.size || launchPending) {
        const timer = setTimeout(() => { void check(); }, 100);
        timer.unref?.();
      }
    };
    await check();
  }

  private report(error: unknown): void {
    if (this.recoveryReported) return;
    this.recoveryReported = true;
    try { this.context.onRecoveryRequired?.(error instanceof Error ? error : new Error(String(error))); } catch { /* Recovery evidence stays in durable resource state. */ }
  }
}
