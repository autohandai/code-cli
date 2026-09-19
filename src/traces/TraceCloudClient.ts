/** @license Apache-2.0 */
import { discardResponseBody } from '../utils/responseBody.js';
import { TRACE_SCHEMA_VERSION, type TraceUpload } from './model.js';

const MAX_BATCH_TRACES = 50;
const MAX_BATCH_BYTES = 4 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

export interface TraceCloudClientOptions {
  apiBaseUrl: string;
  authToken: string;
  clientVersion: string;
  deviceId: string;
}

export interface TraceUploadRejection {
  traceId: string;
  code: string;
}

export interface TraceBatchResult {
  accepted: string[];
  rejected: TraceUploadRejection[];
}

export class TraceCloudError extends Error {
  readonly name = 'TraceCloudError';

  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 60 * 60 * 1_000);
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.max(0, Math.min(date - Date.now(), 60 * 60 * 1_000));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseResult(value: unknown, requested: ReadonlySet<string>): TraceBatchResult {
  if (!isRecord(value) || !Array.isArray(value.accepted) || !Array.isArray(value.rejected)) {
    throw new TraceCloudError('Trace API returned an invalid acknowledgement.');
  }
  const acknowledged = new Set<string>();
  const accepted: string[] = [];
  for (const entry of value.accepted) {
    if (typeof entry !== 'string' || !requested.has(entry) || acknowledged.has(entry)) {
      throw new TraceCloudError('Trace API must acknowledge every requested trace exactly once.');
    }
    acknowledged.add(entry);
    accepted.push(entry);
  }
  const rejected: TraceUploadRejection[] = [];
  for (const entry of value.rejected) {
    if (!isRecord(entry)
      || typeof entry.traceId !== 'string'
      || !requested.has(entry.traceId)
      || acknowledged.has(entry.traceId)
      || typeof entry.code !== 'string') {
      throw new TraceCloudError('Trace API must acknowledge every requested trace exactly once.');
    }
    acknowledged.add(entry.traceId);
    rejected.push({ traceId: entry.traceId, code: entry.code.slice(0, 64) });
  }
  if (acknowledged.size !== requested.size) {
    throw new TraceCloudError('Trace API must acknowledge every requested trace exactly once.');
  }
  return { accepted, rejected };
}

interface SerializedTraceBatch {
  traces: readonly TraceUpload[];
  body: string;
}

function validatedApiBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    const loopback = url.hostname === 'localhost'
      || url.hostname === '127.0.0.1'
      || url.hostname === '[::1]'
      || url.hostname === '::1';
    if (
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
      || url.username !== ''
      || url.password !== ''
      || url.search !== ''
      || url.hash !== ''
    ) {
      throw new Error('unsafe trace endpoint');
    }
    return url.toString().replace(/\/+$/u, '');
  } catch {
    throw new TraceCloudError('Trace API base URL must be an HTTPS URL or localhost.');
  }
}

function serializeEnvelope(deviceId: string, serializedTraces: readonly string[]): string {
  return `{"schemaVersion":${TRACE_SCHEMA_VERSION},"deviceId":${JSON.stringify(deviceId)},"traces":[${serializedTraces.join(',')}]}`;
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new TraceCloudError('Trace API returned an empty acknowledgement.');
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = '';
  let cancelled = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        cancelled = true;
        throw new TraceCloudError('Trace API acknowledgement exceeded its size limit.');
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (!cancelled) await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function boundedBatches(deviceId: string, traces: readonly TraceUpload[]): SerializedTraceBatch[] {
  const output: SerializedTraceBatch[] = [];
  let currentTraces: TraceUpload[] = [];
  let currentSerialized: string[] = [];
  for (const trace of traces) {
    const serialized = JSON.stringify(trace);
    const candidateSerialized = [...currentSerialized, serialized];
    const candidateBody = serializeEnvelope(deviceId, candidateSerialized);
    if (Buffer.byteLength(candidateBody) <= MAX_BATCH_BYTES) {
      currentTraces.push(trace);
      currentSerialized = candidateSerialized;
      continue;
    }
    if (currentTraces.length === 0) {
      throw new TraceCloudError(`Trace ${trace.traceId} exceeds the ${MAX_BATCH_BYTES}-byte request limit.`);
    }
    output.push({
      traces: currentTraces,
      body: serializeEnvelope(deviceId, currentSerialized),
    });
    const singleBody = serializeEnvelope(deviceId, [serialized]);
    if (Buffer.byteLength(singleBody) > MAX_BATCH_BYTES) {
      throw new TraceCloudError(`Trace ${trace.traceId} exceeds the ${MAX_BATCH_BYTES}-byte request limit.`);
    }
    currentTraces = [trace];
    currentSerialized = [serialized];
  }
  if (currentTraces.length > 0) {
    output.push({
      traces: currentTraces,
      body: serializeEnvelope(deviceId, currentSerialized),
    });
  }
  return output;
}

export class TraceCloudClient {
  private readonly apiBaseUrl: string;

  constructor(private readonly options: TraceCloudClientOptions) {
    this.apiBaseUrl = validatedApiBaseUrl(options.apiBaseUrl);
  }

  async uploadBatch(traces: readonly TraceUpload[], signal?: AbortSignal): Promise<TraceBatchResult> {
    if (traces.length === 0) return { accepted: [], rejected: [] };
    if (traces.length > MAX_BATCH_TRACES) {
      throw new TraceCloudError(`Trace batches contain at most ${MAX_BATCH_TRACES} traces.`);
    }
    const traceIds = new Set<string>();
    for (const trace of traces) {
      if (traceIds.has(trace.traceId)) throw new TraceCloudError('Trace batches cannot contain duplicate IDs.');
      traceIds.add(trace.traceId);
    }
    const accepted: string[] = [];
    const rejected: TraceUploadRejection[] = [];
    for (const batch of boundedBatches(this.options.deviceId, traces)) {
      signal?.throwIfAborted();
      const result = await this.uploadSerializedBatch(batch, signal);
      accepted.push(...result.accepted);
      rejected.push(...result.rejected);
    }
    return { accepted, rejected };
  }

  private async uploadSerializedBatch(
    batch: SerializedTraceBatch,
    signal?: AbortSignal,
  ): Promise<TraceBatchResult> {
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await fetch(`${this.apiBaseUrl}/v1/traces/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.options.authToken}`,
        'X-CLI-Version': this.options.clientVersion,
      },
      body: batch.body,
      signal: requestSignal,
    });
    if (!response.ok) {
      const retry = retryAfterMs(response.headers.get('retry-after'));
      discardResponseBody(response);
      throw new TraceCloudError(`Trace upload failed with HTTP ${response.status}.`, response.status, retry);
    }
    const responseText = await readBoundedResponseText(response);
    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      throw new TraceCloudError('Trace API returned invalid JSON.');
    }
    return parseResult(parsed, new Set(batch.traces.map((trace) => trace.traceId)));
  }
}
