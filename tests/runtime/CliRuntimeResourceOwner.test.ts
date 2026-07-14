import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  awaitCliLifecycleStep,
  CliRuntimeResourceOwner,
  type CliOwnedBackgroundService,
  type CliRuntimeProcess,
} from '../../src/runtime/CliRuntimeResourceOwner.js';

interface TestAuthUser {
  id: string;
}

interface TestVersion {
  latest: string;
}

class TestProcess extends EventEmitter implements CliRuntimeProcess {
  override on(event: 'exit' | 'SIGINT' | 'SIGTERM', listener: () => void): this {
    return super.on(event, listener);
  }

  override off(event: 'exit' | 'SIGINT' | 'SIGTERM', listener: () => void): this {
    return super.off(event, listener);
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function makeService() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  } satisfies CliOwnedBackgroundService;
}

describe('CliRuntimeResourceOwner', () => {
  it('settles a held startup step when the CLI lifecycle aborts', async () => {
    const controller = new AbortController();
    let rejectHeld!: (error: Error) => void;
    const held = new Promise<never>((_resolve, reject) => {
      rejectHeld = reject;
    });
    const raced = awaitCliLifecycleStep(held, controller.signal);
    const abortError = new DOMException('Received SIGTERM', 'AbortError');

    controller.abort(abortError);

    await expect(raced).rejects.toBe(abortError);
    rejectHeld(new Error('late setup failure'));
    await Promise.resolve();
  });

  it('owns startup, publication, exact listeners, and idempotent service cleanup', async () => {
    const runtimeProcess = new TestProcess();
    const service = makeService();
    const setSyncService = vi.fn();
    const stopPing = vi.fn().mockResolvedValue(undefined);
    const onVersionResult = vi.fn();
    const owner = new CliRuntimeResourceOwner<TestAuthUser, TestVersion>({
      process: runtimeProcess,
      stopPing,
      setSyncService,
      onSignal: vi.fn(),
      shutdownTimeoutMs: 100,
    });

    owner.startPing(vi.fn());
    owner.startBackgroundStartup({
      resolveAuthAndVersion: vi.fn().mockResolvedValue({
        authUser: { id: 'user-1' },
        versionResult: { latest: '2.0.0' },
      }),
      onVersionResult,
      shouldStartSync: () => true,
      createSyncService: vi.fn().mockResolvedValue(service),
    });
    await vi.waitFor(() => expect(setSyncService).toHaveBeenCalledWith(service));

    expect(service.start).toHaveBeenCalledOnce();
    expect(onVersionResult).toHaveBeenCalledWith({ latest: '2.0.0' });
    expect(runtimeProcess.listenerCount('exit')).toBe(1);
    expect(runtimeProcess.listenerCount('SIGINT')).toBe(1);
    expect(runtimeProcess.listenerCount('SIGTERM')).toBe(1);

    const firstShutdown = owner.shutdown();
    const secondShutdown = owner.shutdown();
    expect(firstShutdown).toBe(secondShutdown);
    await firstShutdown;

    expect(service.shutdown).toHaveBeenCalledOnce();
    expect(service.stop).not.toHaveBeenCalled();
    expect(stopPing).toHaveBeenCalledOnce();
    expect(setSyncService).toHaveBeenLastCalledWith(null);
    expect(runtimeProcess.listenerCount('exit')).toBe(0);
    expect(runtimeProcess.listenerCount('SIGINT')).toBe(0);
    expect(runtimeProcess.listenerCount('SIGTERM')).toBe(0);
  });

  it('closes the generation before held auth resolves', async () => {
    const runtimeProcess = new TestProcess();
    const authAndVersion = deferred<{
      authUser: TestAuthUser | null;
      versionResult: TestVersion | null;
    }>();
    const createSyncService = vi.fn();
    const setSyncService = vi.fn();
    const owner = new CliRuntimeResourceOwner<TestAuthUser, TestVersion>({
      process: runtimeProcess,
      stopPing: vi.fn(),
      setSyncService,
      onSignal: vi.fn(),
      shutdownTimeoutMs: 20,
    });
    owner.startPing(vi.fn());
    owner.startBackgroundStartup({
      resolveAuthAndVersion: () => authAndVersion.promise,
      onVersionResult: vi.fn(),
      shouldStartSync: () => true,
      createSyncService,
    });

    await owner.shutdown();
    authAndVersion.resolve({ authUser: { id: 'late' }, versionResult: null });
    await Promise.resolve();

    expect(createSyncService).not.toHaveBeenCalled();
    expect(setSyncService).toHaveBeenCalledOnce();
    expect(setSyncService).toHaveBeenCalledWith(null);
  });

  it('stops a service that resolves after shutdown without publishing it', async () => {
    const runtimeProcess = new TestProcess();
    const pendingService = deferred<CliOwnedBackgroundService>();
    const service = makeService();
    const setSyncService = vi.fn();
    const owner = new CliRuntimeResourceOwner<TestAuthUser, TestVersion>({
      process: runtimeProcess,
      stopPing: vi.fn(),
      setSyncService,
      onSignal: vi.fn(),
      shutdownTimeoutMs: 20,
    });
    owner.startPing(vi.fn());
    owner.startBackgroundStartup({
      resolveAuthAndVersion: vi.fn().mockResolvedValue({
        authUser: { id: 'user-1' },
        versionResult: null,
      }),
      onVersionResult: vi.fn(),
      shouldStartSync: () => true,
      createSyncService: () => pendingService.promise,
    });
    await Promise.resolve();

    await owner.shutdown();
    pendingService.resolve(service);
    await vi.waitFor(() => expect(service.shutdown).toHaveBeenCalledOnce());

    expect(service.start).not.toHaveBeenCalled();
    expect(setSyncService).not.toHaveBeenCalledWith(service);
  });

  it('contains startup creation failures and still cleans up ping and listeners', async () => {
    const runtimeProcess = new TestProcess();
    const stopPing = vi.fn();
    const setSyncService = vi.fn();
    const owner = new CliRuntimeResourceOwner<TestAuthUser, TestVersion>({
      process: runtimeProcess,
      stopPing,
      setSyncService,
      onSignal: vi.fn(),
    });
    owner.startPing(vi.fn());
    const createSyncService = vi.fn().mockRejectedValue(new Error('initialization failed'));
    owner.startBackgroundStartup({
      resolveAuthAndVersion: vi.fn().mockResolvedValue({
        authUser: { id: 'user-1' },
        versionResult: null,
      }),
      onVersionResult: vi.fn(),
      shouldStartSync: () => true,
      createSyncService,
    });

    await vi.waitFor(() => expect(createSyncService).toHaveBeenCalledOnce());

    await owner.shutdown();

    expect(stopPing).toHaveBeenCalledOnce();
    expect(setSyncService).toHaveBeenCalledWith(null);
    expect(runtimeProcess.eventNames()).toEqual([]);
  });

  it('starts signal cleanup without swallowing the active agent shutdown', async () => {
    const runtimeProcess = new TestProcess();
    const onSignal = vi.fn().mockResolvedValue(undefined);
    const stopPing = vi.fn();
    const authAndVersion = deferred<{
      authUser: TestAuthUser | null;
      versionResult: TestVersion | null;
    }>();
    const createSyncService = vi.fn();
    const owner = new CliRuntimeResourceOwner<TestAuthUser, TestVersion>({
      process: runtimeProcess,
      stopPing,
      setSyncService: vi.fn(),
      onSignal,
    });
    owner.startBackgroundStartup({
      resolveAuthAndVersion: () => authAndVersion.promise,
      onVersionResult: vi.fn(),
      shouldStartSync: () => true,
      createSyncService,
    });
    runtimeProcess.emit('SIGTERM');
    await vi.waitFor(() => expect(onSignal).toHaveBeenCalledWith('SIGTERM'));
    authAndVersion.resolve({ authUser: { id: 'late' }, versionResult: null });
    await Promise.resolve();

    expect(runtimeProcess.listenerCount('exit')).toBe(0);
    expect(runtimeProcess.listenerCount('SIGINT')).toBe(0);
    expect(runtimeProcess.listenerCount('SIGTERM')).toBe(0);
    expect(stopPing).not.toHaveBeenCalled();
    expect(createSyncService).not.toHaveBeenCalled();

    await owner.shutdown();
    expect(stopPing).not.toHaveBeenCalled();
  });

  it('uses one deadline for concurrent ping, sync, and startup drains', async () => {
    vi.useFakeTimers();
    try {
      const runtimeProcess = new TestProcess();
      const never = new Promise<void>(() => {});
      const service = makeService();
      service.shutdown.mockImplementation(() => never);
      const owner = new CliRuntimeResourceOwner<TestAuthUser, TestVersion>({
        process: runtimeProcess,
        stopPing: () => never,
        setSyncService: vi.fn(),
        onSignal: vi.fn(),
        shutdownTimeoutMs: 100,
      });
      owner.startPing(vi.fn());
      owner.startBackgroundStartup({
        resolveAuthAndVersion: vi.fn().mockResolvedValue({
          authUser: { id: 'user-1' },
          versionResult: null,
        }),
        onVersionResult: vi.fn(),
        shouldStartSync: () => true,
        createSyncService: vi.fn().mockResolvedValue(service),
      });
      await vi.advanceTimersByTimeAsync(0);

      let settled = false;
      const shutdown = owner.shutdown().then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(99);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await shutdown;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets a real process settle active work and exit after SIGTERM', async () => {
    const ownerUrl = pathToFileURL(
      path.resolve('src/runtime/CliRuntimeResourceOwner.ts'),
    ).href;
    const script = [
      `import { CliRuntimeResourceOwner } from ${JSON.stringify(ownerUrl)};`,
      'let pingTimer;',
      'let commandTimer = setInterval(() => {}, 1000);',
      'const owner = new CliRuntimeResourceOwner({',
      '  process,',
      '  stopPing: () => clearInterval(pingTimer),',
      '  setSyncService: () => {},',
      "  onSignal: async (signal) => { clearInterval(commandTimer); process.stdout.write(`signal:${signal}\\n`); await Promise.resolve(); await owner.shutdown(); },",
      '  shutdownTimeoutMs: 100,',
      '});',
      'owner.startPing(() => { pingTimer = setInterval(() => {}, 1000); });',
      'owner.startBackgroundStartup({',
      '  resolveAuthAndVersion: () => new Promise(() => {}),',
      '  onVersionResult: () => {},',
      '  shouldStartSync: () => false,',
      '  createSyncService: async () => { throw new Error("unexpected"); },',
      '});',
      "process.stdout.write('ready\\n');",
    ].join('\n');
    const child = spawn(process.execPath, [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      script,
    ], {
      cwd: path.resolve('.'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    try {
      await Promise.race([
        once(child.stdout, 'data'),
        once(child, 'exit').then(([code, signal]) => {
          throw new Error(`child exited before ready (${code ?? signal}): ${stderr}`);
        }),
      ]);
      expect(stdout).toContain('ready');

      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const [code, signal] = await Promise.race([
        exited,
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error(`child did not exit: ${stderr}`)), 1500);
        }),
      ]);

      expect(code).toBe(0);
      expect(signal).toBeNull();
      expect(stdout).toContain('signal:SIGTERM');
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }
  });
});
