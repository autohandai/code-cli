/** @license Apache-2.0 */
import { rename, writeFile } from 'node:fs/promises';

interface ResizeMetadataOptions {
  persist?: (content: string) => Promise<void>;
  maxRecords?: number;
  maxBytes?: number;
}

export function resizeWritePayload(chunk: string | Uint8Array, encoding: BufferEncoding | undefined,
  options: { marker?: string; unsupportedSync?: boolean } = {}): { chunk: string | Uint8Array; bytes: number } {
  let payload = chunk;
  if (options.marker || options.unsupportedSync) {
    const value = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    const output = options.unsupportedSync ? value.replaceAll(/\x1b\[\?2026[hl]/g, '') : value;
    payload = (options.marker ?? '') + output;
  }
  return { chunk: payload, bytes: typeof payload === 'string' ? Buffer.byteLength(payload, encoding) : payload.byteLength };
}

interface ResizeWriteObservation {
  sequence: number;
  bytes: number;
  snapshot(): { timestamp: number; columns: number | undefined; rows: number | undefined; streamed: number };
  record(value: object): void;
  write(complete: (error?: Error | null) => void): boolean;
  complete?: (error?: Error | null) => void;
}

export function observeResizeWrite(observation: ResizeWriteObservation): boolean {
  const { sequence, bytes, snapshot, record, write, complete } = observation;
  record({ ...snapshot(), kind: 'write-start', sequence, bytes });
  const result = write(error => {
    record({ ...snapshot(), kind: 'complete', sequence, error: error != null });
    complete?.(error);
  });
  record({ ...snapshot(), kind: 'write-return', sequence, backpressured: !result });
  return result;
}

export function createResizeWriteMetadata(file: string, options: ResizeMetadataOptions = {}): {
  record(value: object): void;
  flush(): Promise<void>;
} {
  const maxRecords = options.maxRecords ?? 4096;
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 128) {
    throw new Error('Resize metadata bounds must allow at least one record and 128 bytes');
  }
  const persist = options.persist ?? (async (content: string) => {
    await writeFile(`${file}.pending`, content);
    await rename(`${file}.pending`, file);
  });
  const records: { line: string; bytes: number }[] = [];
  let bytes = 0;
  let dropped = 0;
  let dirty = false;
  let pending: Promise<void> | undefined;
  let failure: unknown;
  let failed = false;

  const schedule = () => {
    if (pending || failed) return;
    pending = (async () => {
      do {
        dirty = false;
        const overflow = dropped ? JSON.stringify({ kind: 'metadata-overflow', dropped }) + '\n' : '';
        await persist(records.map(record => record.line).join('') + overflow);
      } while (dirty);
    })().catch(error => { failure = error; failed = true; }).finally(() => {
      pending = undefined;
      if (dirty && !failed) schedule();
    });
  };

  return {
    record(value) {
      const line = JSON.stringify(value) + '\n';
      const size = Buffer.byteLength(line);
      if (size > maxBytes - 64) {
        dropped += 1;
      } else {
        while (records.length >= maxRecords || bytes + size > maxBytes - 64) {
          bytes -= records.shift()!.bytes;
          dropped += 1;
        }
        records.push({ line, bytes: size });
        bytes += size;
      }
      dirty = true;
      schedule();
    },
    async flush() {
      while (pending) await pending;
      if (failed) throw failure;
    },
  };
}
