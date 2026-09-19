/** @license Apache-2.0 */
import type {
  TraceSourceFileSnapshot,
  TraceSourceRegistry,
} from './adapters/sourceRegistry.js';
import type { NormalizedTrace, TraceHarness } from './model.js';
import {
  deriveWorkMap,
  type WorkMap,
  type WorkMapCoverageInput,
} from './workMap.js';

export interface WorkMapRequest {
  since?: string;
  workspace?: string;
  harnesses?: readonly TraceHarness[];
  maxTools?: number;
  maxWorkflows?: number;
  maxDimensions?: number;
}

export interface WorkMapScanSnapshot {
  traces: NormalizedTrace[];
  coverage: WorkMapCoverageInput[];
  sourceFiles: TraceSourceFileSnapshot[];
}

export interface WorkMapScanOptions {
  knownFingerprints?: Readonly<Record<string, string>>;
}

export interface WorkMapModuleOptions {
  maxConcurrency?: number;
  now?: () => Date;
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
    || (error instanceof Error && error.name === 'AbortError');
}

export class WorkMapModule {
  private readonly maxConcurrency: number;
  private readonly now: () => Date;

  constructor(
    private readonly registry: TraceSourceRegistry,
    options: WorkMapModuleOptions = {},
  ) {
    this.maxConcurrency = Math.max(1, Math.min(options.maxConcurrency ?? 3, 8));
    this.now = options.now ?? (() => new Date());
  }

  async scan(
    request: WorkMapRequest,
    signal?: AbortSignal,
    options: WorkMapScanOptions = {},
  ): Promise<WorkMapScanSnapshot> {
    signal?.throwIfAborted();
    const requested = new Set(request.harnesses ?? []);
    const adapters = this.registry.list().filter((adapter) => (
      requested.size === 0 || requested.has(adapter.harness)
    ));
    const traces: NormalizedTrace[] = [];
    const coverage: WorkMapCoverageInput[] = [];
    const sourceFiles: TraceSourceFileSnapshot[] = [];
    let next = 0;

    const worker = async (): Promise<void> => {
      while (next < adapters.length) {
        signal?.throwIfAborted();
        const adapter = adapters[next];
        next += 1;
        try {
          const result = await adapter.scan({
            signal,
            knownFingerprints: options.knownFingerprints,
          });
          traces.push(...result.traces);
          sourceFiles.push(...result.sourceFiles);
          coverage.push({
            harness: adapter.harness,
            filesScanned: result.filesScanned,
            bytesRead: result.bytesRead,
            warnings: result.warnings.length,
            truncated: result.truncated,
            sessions: result.traces.length,
          });
        } catch (error) {
          if (isAbort(error, signal)) throw error;
          coverage.push({
            harness: adapter.harness,
            filesScanned: 0,
            bytesRead: 0,
            warnings: 1,
            truncated: true,
            sessions: 0,
          });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(this.maxConcurrency, adapters.length) }, () => worker()),
    );
    traces.sort((left, right) => left.id.localeCompare(right.id));
    coverage.sort((left, right) => left.harness.localeCompare(right.harness));
    sourceFiles.sort((left, right) => left.key.localeCompare(right.key));
    return { traces, coverage, sourceFiles };
  }

  async map(request: WorkMapRequest, signal?: AbortSignal): Promise<WorkMap> {
    const snapshot = await this.scan(request, signal);
    signal?.throwIfAborted();
    return deriveWorkMap(snapshot.traces, {
      now: this.now(),
      since: request.since ?? '30d',
      workspace: request.workspace,
      harnesses: request.harnesses,
      coverage: snapshot.coverage,
      maxTools: request.maxTools,
      maxWorkflows: request.maxWorkflows,
      maxDimensions: request.maxDimensions,
    });
  }
}
