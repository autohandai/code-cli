/** @license Apache-2.0 */
import fs from 'fs-extra';
import type { LoadedConfig } from '../../types.js';
import { atomicWriteJson } from '../../utils/atomicFile.js';
import { TraceCloudClient, TraceCloudError, type TraceBatchResult } from '../TraceCloudClient.js';
import type { NormalizedTrace, TraceContentMode, TraceHarness, TraceUpload } from '../model.js';
import { normalizedTraceSchema, projectTraceForUpload, traceHarnessSchema } from '../model.js';
import type { AhTracesRuntimePaths } from '../runtimePaths.js';
import type { WorkMapModule } from '../WorkMapModule.js';
import { deriveWorkMap, projectTraceForLocalIndex } from '../workMap.js';
import type { AhTracesMonitor } from './AhTracesDaemon.js';

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const INITIAL_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1_000;
const MAX_CHECKPOINTS = 100_000;
const UPLOAD_BATCH_SIZE = 50;

interface UploadedCheckpoint {
  fingerprint: string;
  contentMode: TraceContentMode;
  uploadedAt: string;
}

interface TraceCheckpoints {
  schemaVersion: 1;
  uploaded: Record<string, UploadedCheckpoint>;
  files: Record<string, CachedTraceSource>;
}

interface CachedTraceSource {
  indexVersion: 1 | 2;
  harness: TraceHarness;
  fingerprint: string;
  traces: NormalizedTrace[];
  updatedAt: string;
}

interface TraceUploader {
  uploadBatch(traces: readonly TraceUpload[], signal?: AbortSignal): Promise<TraceBatchResult>;
}

export interface PersistentTraceMonitorOptions {
  paths: AhTracesRuntimePaths;
  loadConfig: () => Promise<LoadedConfig>;
  workMap: WorkMapModule;
  createClient?: (options: ConstructorParameters<typeof TraceCloudClient>[0]) => TraceUploader;
  clientVersion: string;
  deviceId: string;
  onDisabled?: () => void;
  now?: () => Date;
}

function emptyCheckpoints(): TraceCheckpoints {
  return { schemaVersion: 1, uploaded: {}, files: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCheckpoints(value: unknown): TraceCheckpoints {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.uploaded)) {
    return emptyCheckpoints();
  }
  const uploaded: Record<string, UploadedCheckpoint> = {};
  for (const [traceId, entry] of Object.entries(value.uploaded).slice(-MAX_CHECKPOINTS)) {
    if (!/^tr_[a-f0-9]{32}$/u.test(traceId)
      || !isRecord(entry)
      || typeof entry.fingerprint !== 'string'
      || (entry.contentMode !== 'metadata' && entry.contentMode !== 'full')
      || typeof entry.uploadedAt !== 'string') continue;
    uploaded[traceId] = {
      fingerprint: entry.fingerprint,
      contentMode: entry.contentMode,
      uploadedAt: entry.uploadedAt,
    };
  }
  const files: Record<string, CachedTraceSource> = {};
  if (isRecord(value.files)) {
    for (const [sourceKey, entry] of Object.entries(value.files).slice(-MAX_CHECKPOINTS)) {
      const harness = isRecord(entry) ? traceHarnessSchema.safeParse(entry.harness) : undefined;
      if (!sourceKey.startsWith('src_')
        || !isRecord(entry)
        || !harness?.success
        || typeof entry.fingerprint !== 'string'
        || typeof entry.updatedAt !== 'string'
        || !Array.isArray(entry.traces)) continue;
      const traces = entry.traces
        .slice(0, 10_000)
        .map((trace) => normalizedTraceSchema.safeParse(trace))
        .filter((result) => result.success)
        .map((result) => result.data);
      if (traces.some((trace) => trace.source.harness !== harness.data)) continue;
      files[sourceKey] = {
        indexVersion: entry.indexVersion === 2 ? 2 : 1,
        harness: harness.data,
        fingerprint: entry.fingerprint,
        traces,
        updatedAt: entry.updatedAt,
      };
    }
  }
  return { schemaVersion: 1, uploaded, files };
}

function configuredPollInterval(config: LoadedConfig): number {
  const value = config.traces?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  return Math.max(1_000, Math.min(value, 3_600_000));
}

function apiBaseUrl(config: LoadedConfig): string {
  return config.traces?.apiBaseUrl
    ?? config.api?.baseUrl
    ?? 'https://api.autohand.ai';
}

function contentMode(config: LoadedConfig): TraceContentMode {
  return config.traces?.contentMode === 'full' ? 'full' : 'metadata';
}

export class PersistentTraceMonitor implements AhTracesMonitor {
  private readonly createClient: NonNullable<PersistentTraceMonitorOptions['createClient']>;
  private readonly now: () => Date;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private activeCycle: Promise<void> | null = null;
  private cycleController: AbortController | null = null;
  private started = false;
  private stopped = false;
  private disabledReported = false;
  private consecutiveFailures = 0;
  private nextDelayMs = DEFAULT_POLL_INTERVAL_MS;

  constructor(private readonly options: PersistentTraceMonitorOptions) {
    this.createClient = options.createClient ?? ((clientOptions) => new TraceCloudClient(clientOptions));
    this.now = options.now ?? (() => new Date());
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    await this.requestCycle();
  }

  async refreshConfig(): Promise<void> {
    if (!this.started || this.stopped) return;
    this.clearTimer();
    const active = this.activeCycle;
    if (active) {
      this.cycleController?.abort();
      await active;
    }
    if (this.stopped || this.disabledReported) return;
    this.clearTimer();
    await this.requestCycle();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimer();
    this.cycleController?.abort();
    await this.activeCycle?.catch((error: unknown) => {
      if (!(error instanceof Error) || error.name !== 'AbortError') throw error;
    });
    this.activeCycle = null;
    this.cycleController = null;
  }

  private requestCycle(): Promise<void> {
    if (this.activeCycle) return this.activeCycle;
    const promise = this.runCycle()
      .then(() => {
        this.consecutiveFailures = 0;
      })
      .catch((error: unknown) => {
        if (this.stopped && error instanceof Error && error.name === 'AbortError') return;
        this.consecutiveFailures += 1;
        const exponentialDelay = Math.min(
          INITIAL_RETRY_DELAY_MS * (2 ** Math.min(this.consecutiveFailures - 1, 10)),
          MAX_RETRY_DELAY_MS,
        );
        this.nextDelayMs = error instanceof TraceCloudError && error.retryAfterMs !== undefined
          ? Math.max(1_000, Math.min(error.retryAfterMs, MAX_RETRY_DELAY_MS))
          : exponentialDelay;
      })
      .finally(() => {
        if (this.activeCycle === promise) {
          this.activeCycle = null;
          this.cycleController = null;
          if (!this.stopped && !this.disabledReported) this.scheduleNext();
        }
      });
    this.activeCycle = promise;
    return promise;
  }

  private async runCycle(): Promise<void> {
    const config = await this.options.loadConfig();
    if (config.traces?.enabled !== true) {
      await Promise.all([
        fs.remove(this.options.paths.workMapFile),
        fs.remove(this.options.paths.checkpointsFile),
      ]);
      if (!this.disabledReported) {
        this.disabledReported = true;
        this.options.onDisabled?.();
      }
      return;
    }
    this.disabledReported = false;
    this.nextDelayMs = configuredPollInterval(config);
    const controller = new AbortController();
    this.cycleController = controller;
    const checkpoints = await this.loadCheckpoints();
    const snapshot = await this.options.workMap.scan(
      { since: '30d' },
      controller.signal,
      { knownFingerprints: this.knownFingerprints(checkpoints, config) },
    );
    controller.signal.throwIfAborted();
    const indexedTraces = this.updateCachedSources(checkpoints, snapshot);
    this.evictCheckpoints(checkpoints);
    await atomicWriteJson(this.options.paths.checkpointsFile, checkpoints);

    if (config.traces.discoveryMap !== false) {
      const map = deriveWorkMap(indexedTraces, {
        now: this.now(),
        since: '30d',
        coverage: snapshot.coverage,
      });
      await atomicWriteJson(this.options.paths.workMapFile, map);
    } else {
      await fs.remove(this.options.paths.workMapFile);
    }

    if (config.traces.cloudSync !== true || !config.auth?.token) return;
    const currentById = new Map(snapshot.traces.map((trace) => [trace.id, trace]));
    const uploadTraces = indexedTraces.map((trace) => currentById.get(trace.id) ?? trace);
    await this.uploadChanged(uploadTraces, config, checkpoints, controller.signal);
  }

  private async uploadChanged(
    traces: Awaited<ReturnType<WorkMapModule['scan']>>['traces'],
    config: LoadedConfig,
    checkpoints: TraceCheckpoints,
    signal: AbortSignal,
  ): Promise<void> {
    const mode = contentMode(config);
    const pending = traces.filter((trace) => {
      const checkpoint = checkpoints.uploaded[trace.id];
      return checkpoint?.fingerprint !== trace.source.fingerprint
        || checkpoint.contentMode !== mode;
    });
    if (pending.length === 0) return;
    const client = this.createClient({
      apiBaseUrl: apiBaseUrl(config),
      authToken: config.auth!.token!,
      clientVersion: this.options.clientVersion,
      deviceId: this.options.deviceId,
    });
    const tracesById = new Map(pending.map((trace) => [trace.id, trace]));
    for (let index = 0; index < pending.length; index += UPLOAD_BATCH_SIZE) {
      signal.throwIfAborted();
      const projected = pending
        .slice(index, index + UPLOAD_BATCH_SIZE)
        .map((trace) => projectTraceForUpload(trace, mode));
      const result = await client.uploadBatch(projected, signal);
      const timestamp = this.now().toISOString();
      for (const traceId of result.accepted) {
        const trace = tracesById.get(traceId);
        if (!trace) continue;
        checkpoints.uploaded[traceId] = {
          fingerprint: trace.source.fingerprint,
          contentMode: mode,
          uploadedAt: timestamp,
        };
      }
      this.evictCheckpoints(checkpoints);
      await atomicWriteJson(this.options.paths.checkpointsFile, checkpoints);
    }
  }

  private async loadCheckpoints(): Promise<TraceCheckpoints> {
    try {
      const stat = await fs.stat(this.options.paths.checkpointsFile);
      if (stat.size > 64 * 1024 * 1024) return emptyCheckpoints();
      return parseCheckpoints(await fs.readJson(this.options.paths.checkpointsFile) as unknown);
    } catch {
      return emptyCheckpoints();
    }
  }

  private evictCheckpoints(checkpoints: TraceCheckpoints): void {
    const entries = Object.entries(checkpoints.uploaded);
    if (entries.length > MAX_CHECKPOINTS) {
      entries.sort((left, right) => left[1].uploadedAt.localeCompare(right[1].uploadedAt));
      for (const [traceId] of entries.slice(0, entries.length - MAX_CHECKPOINTS)) {
        delete checkpoints.uploaded[traceId];
      }
    }
    const files = Object.entries(checkpoints.files);
    if (files.length <= MAX_CHECKPOINTS) return;
    files.sort((left, right) => left[1].updatedAt.localeCompare(right[1].updatedAt));
    for (const [sourceKey] of files.slice(0, files.length - MAX_CHECKPOINTS)) {
      delete checkpoints.files[sourceKey];
    }
  }

  private knownFingerprints(
    checkpoints: TraceCheckpoints,
    config: LoadedConfig,
  ): Record<string, string> {
    const mode = contentMode(config);
    return Object.fromEntries(Object.entries(checkpoints.files)
      .filter(([, source]) => {
        if (source.indexVersion !== 2) return false;
        if (config.traces?.cloudSync !== true || mode === 'metadata') return true;
        return source.traces.every((trace) => {
          const uploaded = checkpoints.uploaded[trace.id];
          return uploaded?.fingerprint === source.fingerprint && uploaded.contentMode === 'full';
        });
      })
      .map(([sourceKey, source]) => [sourceKey, source.fingerprint]));
  }

  private updateCachedSources(
    checkpoints: TraceCheckpoints,
    snapshot: Awaited<ReturnType<WorkMapModule['scan']>>,
  ): NormalizedTrace[] {
    const tracesById = new Map(snapshot.traces.map((trace) => [trace.id, trace]));
    const discovered = new Set(snapshot.sourceFiles.map((source) => source.key));
    const completeHarnesses = new Set(snapshot.coverage
      .filter((coverage) => !coverage.truncated && coverage.warnings === 0)
      .map((coverage) => coverage.harness));
    const timestamp = this.now().toISOString();

    for (const source of snapshot.sourceFiles) {
      if (!source.changed) continue;
      if (!source.parsed) continue;
      const traces = source.traceIds
        .map((traceId) => tracesById.get(traceId))
        .filter((trace): trace is NormalizedTrace => trace !== undefined)
        .map(projectTraceForLocalIndex);
      checkpoints.files[source.key] = {
        indexVersion: 2,
        harness: source.harness,
        fingerprint: source.fingerprint,
        traces,
        updatedAt: timestamp,
      };
    }
    for (const [sourceKey, source] of Object.entries(checkpoints.files)) {
      if (completeHarnesses.has(source.harness) && !discovered.has(sourceKey)) {
        delete checkpoints.files[sourceKey];
      }
    }

    const indexed = new Map<string, NormalizedTrace>();
    for (const source of Object.values(checkpoints.files)) {
      for (const trace of source.traces) indexed.set(trace.id, trace);
    }
    const referenced = new Set(snapshot.sourceFiles.flatMap((source) => source.traceIds));
    for (const trace of snapshot.traces) {
      if (!referenced.has(trace.id)) indexed.set(trace.id, projectTraceForLocalIndex(trace));
    }
    return [...indexed.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.requestCycle().catch(() => {});
    }, this.nextDelayMs);
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
