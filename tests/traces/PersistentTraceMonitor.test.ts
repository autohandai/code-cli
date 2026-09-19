import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoadedConfig } from '../../src/types.js';
import type { NormalizedTrace } from '../../src/traces/model.js';
import type { WorkMapModule } from '../../src/traces/WorkMapModule.js';
import { PersistentTraceMonitor } from '../../src/traces/daemon/PersistentTraceMonitor.js';
import type { AhTracesRuntimePaths } from '../../src/traces/runtimePaths.js';
import { TraceCloudError } from '../../src/traces/TraceCloudClient.js';

const roots: string[] = [];
const TRACE_ID = 'tr_0123456789abcdef0123456789abcdef';

async function paths(): Promise<AhTracesRuntimePaths> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ahtraces-monitor-test-'));
  roots.push(directory);
  return {
    directory,
    stateFile: path.join(directory, 'daemon.json'),
    daemonLock: path.join(directory, 'daemon.lock'),
    supervisorLock: path.join(directory, 'supervisor.lock'),
    checkpointsFile: path.join(directory, 'checkpoints.json'),
    workMapFile: path.join(directory, 'work-map.json'),
    socketPath: path.join(directory, 'control.sock'),
  };
}

function config(overrides: Partial<LoadedConfig> = {}): LoadedConfig {
  return {
    configPath: '/tmp/config.json',
    traces: {
      enabled: true,
      cloudSync: false,
      contentMode: 'metadata',
      discoveryMap: true,
      pollIntervalMs: 60_000,
    },
    auth: { token: 'account-token' },
    ...overrides,
  } as LoadedConfig;
}

function trace(fingerprint = 'sha256:one'): NormalizedTrace {
  return {
    schemaVersion: 1,
    id: TRACE_ID,
    source: {
      harness: 'autohand',
      externalId: 'private-session',
      recordPath: '/Users/private/session.jsonl',
      fingerprint,
    },
    agent: { name: 'Autohand' },
    project: { path: '/Users/private/project' },
    status: 'completed',
    model: 'gpt-6',
    provider: 'openai',
    reasoningEffort: 'high',
    usage: { input: 10, output: 2, total: 12, provenance: 'actual' },
    relationships: [],
    messages: [{
      id: 'message-one',
      role: 'user',
      order: 0,
      usage: { provenance: 'unavailable' },
      parts: [{ type: 'text', text: 'never persist or upload without full consent' }],
    }],
    provenance: {
      adapterVersion: 1,
      parsedAt: '2026-09-18T00:00:00.000Z',
      completeness: 'complete',
      warnings: [],
    },
  };
}

function workMapModule(sample = trace()): Pick<WorkMapModule, 'scan'> {
  return {
    scan: vi.fn(async () => ({
      traces: [sample],
      coverage: [{
        harness: 'autohand',
        filesScanned: 1,
        bytesRead: 100,
        warnings: 0,
      truncated: false,
      sessions: 1,
      }],
      sourceFiles: [{
        harness: 'autohand',
        key: 'src_one',
        fingerprint: sample.source.fingerprint,
        changed: true,
        parsed: true,
        traceIds: [sample.id],
      }],
    })),
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => fs.remove(root)));
});

describe('PersistentTraceMonitor', () => {
  it('writes only a safe local Work Map and leaves no timer behind after stop', async () => {
    vi.useFakeTimers();
    const baseline = vi.getTimerCount();
    const runtimePaths = await paths();
    const module = workMapModule();
    const createClient = vi.fn();
    const monitor = new PersistentTraceMonitor({
      paths: runtimePaths,
      loadConfig: async () => config(),
      workMap: module as WorkMapModule,
      createClient,
      clientVersion: '0.9.0',
      deviceId: 'device-1',
    });

    await monitor.start();

    const serialized = await fs.readFile(runtimePaths.workMapFile, 'utf8');
    expect(serialized).toContain('"outputContainsAggregatesOnly": true');
    expect(serialized).not.toContain('never persist');
    expect(serialized).not.toContain('/Users/private');
    expect(createClient).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(baseline + 1);

    await monitor.stop();
    expect(vi.getTimerCount()).toBe(baseline);
  });

  it('interrupts an in-flight scan so a configuration refresh is applied immediately', async () => {
    vi.useFakeTimers();
    const runtimePaths = await paths();
    const sample = trace();
    const snapshot = {
      traces: [sample],
      coverage: [{
        harness: 'autohand' as const,
        filesScanned: 1,
        bytesRead: 100,
        warnings: 0,
        truncated: false,
        sessions: 1,
      }],
      sourceFiles: [{
        harness: 'autohand' as const,
        key: 'src_one',
        fingerprint: sample.source.fingerprint,
        changed: true,
        parsed: true,
        traceIds: [sample.id],
      }],
    };
    let scanNumber = 0;
    let finishSecondScan: (() => void) | undefined;
    const scan = vi.fn((_request, signal?: AbortSignal) => {
      scanNumber += 1;
      if (scanNumber !== 2) return Promise.resolve(snapshot);
      return new Promise<typeof snapshot>((resolve, reject) => {
        finishSecondScan = () => resolve(snapshot);
        signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    });
    const monitor = new PersistentTraceMonitor({
      paths: runtimePaths,
      loadConfig: async () => config(),
      workMap: { scan } as unknown as WorkMapModule,
      clientVersion: '0.9.0',
      deviceId: 'device-1',
    });

    await monitor.start();
    const inFlightScan = monitor.refreshConfig();
    await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(2));

    const refresh = monitor.refreshConfig();
    await Promise.resolve();
    finishSecondScan?.();
    await Promise.all([inFlightScan, refresh]);

    expect(scan).toHaveBeenCalledTimes(3);
    await monitor.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uploads metadata only after explicit cloud consent and checkpoints accepted traces', async () => {
    vi.useFakeTimers();
    const runtimePaths = await paths();
    const module = workMapModule();
    const uploadBatch = vi.fn(async () => ({ accepted: [TRACE_ID], rejected: [] }));
    const createClient = vi.fn(() => ({ uploadBatch }));
    const monitor = new PersistentTraceMonitor({
      paths: runtimePaths,
      loadConfig: async () => config({ traces: {
        enabled: true,
        cloudSync: true,
        contentMode: 'metadata',
        discoveryMap: true,
        pollIntervalMs: 60_000,
      } }),
      workMap: module as WorkMapModule,
      createClient,
      clientVersion: '0.9.0',
      deviceId: 'device-1',
    });

    await monitor.start();
    await monitor.refreshConfig();

    expect(uploadBatch).toHaveBeenCalledOnce();
    const uploaded = uploadBatch.mock.calls[0][0];
    expect(uploaded).toEqual([expect.objectContaining({
      traceId: TRACE_ID,
      contentMode: 'metadata',
      model: 'gpt-6',
      reasoningEffort: 'high',
    })]);
    expect(uploaded[0]).not.toHaveProperty('messages');
    const checkpoint = await fs.readJson(runtimePaths.checkpointsFile);
    expect(checkpoint.uploaded[TRACE_ID]).toMatchObject({
      fingerprint: 'sha256:one',
      contentMode: 'metadata',
    });
    await monitor.stop();
  });

  it('stops monitoring when the master switch is disabled and never scans or uploads', async () => {
    const runtimePaths = await paths();
    await fs.writeJson(runtimePaths.workMapFile, { stale: true });
    await fs.writeJson(runtimePaths.checkpointsFile, { stale: true });
    const module = workMapModule();
    const onDisabled = vi.fn();
    const createClient = vi.fn();
    const monitor = new PersistentTraceMonitor({
      paths: runtimePaths,
      loadConfig: async () => config({ traces: { enabled: false, cloudSync: true, contentMode: 'full' } }),
      workMap: module as WorkMapModule,
      createClient,
      clientVersion: '0.9.0',
      deviceId: 'device-1',
      onDisabled,
    });

    await monitor.start();

    expect(onDisabled).toHaveBeenCalledOnce();
    expect(module.scan).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(await fs.pathExists(runtimePaths.workMapFile)).toBe(false);
    expect(await fs.pathExists(runtimePaths.checkpointsFile)).toBe(false);
    await monitor.stop();
  });

  it('removes a stale Work Map when local discovery projection is disabled', async () => {
    const runtimePaths = await paths();
    await fs.writeJson(runtimePaths.workMapFile, { stale: true });
    const monitor = new PersistentTraceMonitor({
      paths: runtimePaths,
      loadConfig: async () => config({ traces: {
        enabled: true,
        cloudSync: false,
        contentMode: 'metadata',
        discoveryMap: false,
        pollIntervalMs: 60_000,
      } }),
      workMap: workMapModule() as WorkMapModule,
      clientVersion: '0.9.0',
      deviceId: 'device-1',
    });

    await monitor.start();

    expect(await fs.pathExists(runtimePaths.workMapFile)).toBe(false);
    expect(await fs.pathExists(runtimePaths.checkpointsFile)).toBe(true);
    await monitor.stop();
  });

  it('requires an authenticated account even when cloud sync is selected', async () => {
    const runtimePaths = await paths();
    const module = workMapModule();
    const createClient = vi.fn();
    const monitor = new PersistentTraceMonitor({
      paths: runtimePaths,
      loadConfig: async () => config({
        auth: undefined,
        traces: { enabled: true, cloudSync: true, contentMode: 'full' },
      }),
      workMap: module as WorkMapModule,
      createClient,
      clientVersion: '0.9.0',
      deviceId: 'device-1',
    });

    await monitor.start();

    expect(createClient).not.toHaveBeenCalled();
    await monitor.stop();
  });

  it('reuses aggregate-only summaries when native source fingerprints are unchanged', async () => {
    vi.useFakeTimers();
    const runtimePaths = await paths();
    const sample = trace('sha256:' + 'a'.repeat(64));
    const scan = vi.fn()
      .mockResolvedValueOnce({
        traces: [sample],
        coverage: [{
          harness: 'autohand', filesScanned: 1, bytesRead: 100,
          warnings: 0, truncated: false, sessions: 1,
        }],
        sourceFiles: [{
          harness: 'autohand', key: 'src_one', fingerprint: sample.source.fingerprint,
          changed: true, parsed: true, traceIds: [sample.id],
        }],
      })
      .mockResolvedValueOnce({
        traces: [],
        coverage: [{
          harness: 'autohand', filesScanned: 0, bytesRead: 0,
          warnings: 0, truncated: false, sessions: 0,
        }],
        sourceFiles: [{
          harness: 'autohand', key: 'src_one', fingerprint: sample.source.fingerprint,
          changed: false, parsed: true, traceIds: [],
        }],
      });
    const monitor = new PersistentTraceMonitor({
      paths: runtimePaths,
      loadConfig: async () => config(),
      workMap: { scan } as unknown as WorkMapModule,
      clientVersion: '0.9.0',
      deviceId: 'device-1',
    });

    await monitor.start();
    await monitor.refreshConfig();

    expect(scan.mock.calls[1][2]).toEqual({
      knownFingerprints: { src_one: sample.source.fingerprint },
    });
    const map = await fs.readJson(runtimePaths.workMapFile);
    expect(map.sessions.total).toBe(1);
    expect(map.dimensions.models).toEqual([{ name: 'gpt-6', sessions: 1, tokens: 12 }]);
    const checkpointText = await fs.readFile(runtimePaths.checkpointsFile, 'utf8');
    expect(checkpointText).not.toContain('never persist');
    expect(checkpointText).not.toContain('/Users/private');
    expect(checkpointText).not.toContain('private-session');
    await monitor.stop();
  });

  it('drops checkpoint sources whose harness identifier is not canonical', async () => {
    vi.useFakeTimers();
    const runtimePaths = await paths();
    await fs.writeJson(runtimePaths.checkpointsFile, {
      schemaVersion: 1,
      uploaded: {
        'native-private-id': {
          fingerprint: `sha256:${'b'.repeat(64)}`,
          contentMode: 'metadata',
          uploadedAt: '2026-09-18T00:00:00.000Z',
        },
      },
      files: {
        src_untrusted: {
          harness: 'unknown-agent',
          fingerprint: `sha256:${'a'.repeat(64)}`,
          traces: [],
          updatedAt: '2026-09-18T00:00:00.000Z',
        },
      },
    });
    const scan = vi.fn(async () => ({ traces: [], coverage: [], sourceFiles: [] }));
    const monitor = new PersistentTraceMonitor({
      paths: runtimePaths,
      loadConfig: async () => config(),
      workMap: { scan } as unknown as WorkMapModule,
      clientVersion: '0.9.0',
      deviceId: 'device-1',
    });

    await monitor.start();

    expect(scan.mock.calls[0]?.[2]).toEqual({ knownFingerprints: {} });
    const cleaned = await fs.readJson(runtimePaths.checkpointsFile);
    expect(cleaned.files).toEqual({});
    expect(cleaned.uploaded).toEqual({});
    await monitor.stop();
  });

  it('removes cached sessions after a complete scan observes that their source was deleted', async () => {
    vi.useFakeTimers();
    const runtimePaths = await paths();
    const sample = trace('sha256:' + 'c'.repeat(64));
    const scan = vi.fn()
      .mockResolvedValueOnce({
        traces: [sample],
        coverage: [{
          harness: 'autohand', filesScanned: 1, bytesRead: 100,
          warnings: 0, truncated: false, sessions: 1,
        }],
        sourceFiles: [{
          harness: 'autohand', key: 'src_one', fingerprint: sample.source.fingerprint,
          changed: true, parsed: true, traceIds: [sample.id],
        }],
      })
      .mockResolvedValueOnce({
        traces: [],
        coverage: [{
          harness: 'autohand', filesScanned: 0, bytesRead: 0,
          warnings: 0, truncated: false, sessions: 0,
        }],
        sourceFiles: [],
      });
    const monitor = new PersistentTraceMonitor({
      paths: runtimePaths,
      loadConfig: async () => config(),
      workMap: { scan } as unknown as WorkMapModule,
      clientVersion: '0.9.0',
      deviceId: 'device-1',
    });

    await monitor.start();
    await monitor.refreshConfig();

    const map = await fs.readJson(runtimePaths.workMapFile);
    const checkpoints = await fs.readJson(runtimePaths.checkpointsFile);
    expect(map.sessions.total).toBe(0);
    expect(checkpoints.files).toEqual({});
    await monitor.stop();
  });

  it('retains cached sessions when source discovery reports a warning', async () => {
    vi.useFakeTimers();
    const runtimePaths = await paths();
    const sample = trace('sha256:' + 'd'.repeat(64));
    const scan = vi.fn()
      .mockResolvedValueOnce({
        traces: [sample],
        coverage: [{
          harness: 'autohand', filesScanned: 1, bytesRead: 100,
          warnings: 0, truncated: false, sessions: 1,
        }],
        sourceFiles: [{
          harness: 'autohand', key: 'src_one', fingerprint: sample.source.fingerprint,
          changed: true, parsed: true, traceIds: [sample.id],
        }],
      })
      .mockResolvedValueOnce({
        traces: [],
        coverage: [{
          harness: 'autohand', filesScanned: 0, bytesRead: 0,
          warnings: 1, truncated: false, sessions: 0,
        }],
        sourceFiles: [],
      });
    const monitor = new PersistentTraceMonitor({
      paths: runtimePaths,
      loadConfig: async () => config(),
      workMap: { scan } as unknown as WorkMapModule,
      clientVersion: '0.9.0',
      deviceId: 'device-1',
    });

    await monitor.start();
    await monitor.refreshConfig();

    const map = await fs.readJson(runtimePaths.workMapFile);
    expect(map.sessions.total).toBe(1);
    await monitor.stop();
  });

  it('keeps the daemon alive and honors Retry-After after a transient cloud failure', async () => {
    vi.useFakeTimers();
    const runtimePaths = await paths();
    const module = workMapModule();
    const uploadBatch = vi.fn()
      .mockRejectedValueOnce(new TraceCloudError('rate limited', 429, 5_000))
      .mockResolvedValue({ accepted: [TRACE_ID], rejected: [] });
    const monitor = new PersistentTraceMonitor({
      paths: runtimePaths,
      loadConfig: async () => config({ traces: {
        enabled: true,
        cloudSync: true,
        contentMode: 'metadata',
        discoveryMap: true,
        pollIntervalMs: 60_000,
      } }),
      workMap: module as WorkMapModule,
      createClient: () => ({ uploadBatch }),
      clientVersion: '0.9.0',
      deviceId: 'device-1',
    });

    await expect(monitor.start()).resolves.toBeUndefined();
    expect(uploadBatch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(uploadBatch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await monitor.refreshConfig();
    expect(uploadBatch).toHaveBeenCalledTimes(2);

    await monitor.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rereads unchanged native files before full-content upload consent takes effect', async () => {
    vi.useFakeTimers();
    const runtimePaths = await paths();
    const sample = trace('sha256:' + 'b'.repeat(64));
    const scan = vi.fn(async () => ({
      traces: [sample],
      coverage: [{
        harness: 'autohand', filesScanned: 1, bytesRead: 100,
        warnings: 0, truncated: false, sessions: 1,
      }],
      sourceFiles: [{
        harness: 'autohand', key: 'src_one', fingerprint: sample.source.fingerprint,
        changed: true, parsed: true, traceIds: [sample.id],
      }],
    }));
    let loaded = config();
    const uploadBatch = vi.fn(async () => ({ accepted: [TRACE_ID], rejected: [] }));
    const monitor = new PersistentTraceMonitor({
      paths: runtimePaths,
      loadConfig: async () => loaded,
      workMap: { scan } as unknown as WorkMapModule,
      createClient: () => ({ uploadBatch }),
      clientVersion: '0.9.0',
      deviceId: 'device-1',
    });

    await monitor.start();
    loaded = config({ traces: {
      enabled: true,
      cloudSync: true,
      contentMode: 'full',
      discoveryMap: true,
      pollIntervalMs: 60_000,
    } });
    await monitor.refreshConfig();

    expect(scan.mock.calls[1][2]).toEqual({ knownFingerprints: {} });
    expect(uploadBatch.mock.calls[0][0][0]).toMatchObject({
      contentMode: 'full',
      messages: [{ parts: [{ text: 'never persist or upload without full consent' }] }],
    });
    await monitor.stop();
  });
});
