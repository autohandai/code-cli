/** @license Apache-2.0 */
import { describe, expect, it, vi } from 'vitest';
import { createResizeWriteMetadata, observeResizeWrite, resizeWritePayload } from '../../src/testing/scenarios/resizeWriteMetadata.js';

describe('resize fixture write metadata', () => {
  it('forwards split multibyte and non-UTF8 chunks unchanged when only observing metadata', () => {
    const chunks = [Uint8Array.from([0xe2]), Uint8Array.from([0x82, 0xac]), Buffer.from([0xff, 0xfe])];
    const forwarded = chunks.map(chunk => resizeWritePayload(chunk, undefined));
    for (let index = 0; index < chunks.length; index += 1) {
      expect(forwarded[index]?.chunk).toBe(chunks[index]);
      expect(forwarded[index]?.bytes).toBe(chunks[index]?.byteLength);
    }
    const actual = Buffer.concat(forwarded.map(payload => typeof payload.chunk === 'string' ? Buffer.from(payload.chunk) : payload.chunk));
    expect(actual).toEqual(Buffer.from([0xe2, 0x82, 0xac, 0xff, 0xfe]));
  });

  it.each<{ chunk: string | Uint8Array; encoding?: BufferEncoding; bytes: number }>([
    { chunk: 'é', encoding: 'latin1', bytes: 1 },
    { chunk: 'abcd', encoding: 'utf16le', bytes: 8 },
    { chunk: 'w6k=', encoding: 'base64', bytes: 2 },
    { chunk: Uint8Array.from([1, 2, 3, 4]).subarray(1, 3), encoding: 'utf16le', bytes: 2 },
  ])('measures the actual payload type and encoding $encoding', ({ chunk, encoding, bytes }) => {
    const payload = resizeWritePayload(chunk, encoding);
    expect(payload.chunk).toBe(chunk);
    expect(payload.bytes).toBe(bytes);
  });

  it('limits payload transformations to explicit viewport-marker or unsupported-sync modes', () => {
    const chunk = Buffer.from('\x1b[?2026htext\x1b[?2026l');
    expect(resizeWritePayload(chunk, undefined, { unsupportedSync: true }).chunk).toBe('text');
    const marked = resizeWritePayload('text', undefined, { marker: '\x1b]777;resize-fixture;100;30\x07' });
    expect(marked.chunk).toBe('\x1b]777;resize-fixture;100;30\x07text');
    expect(marked.bytes).toBe(Buffer.byteLength(marked.chunk));
  });

  it('flushes a record appended between the last write continuation and pending cleanup', async () => {
    const persist = vi.fn(async (_content: string) => {});
    const metadata = createResizeWriteMetadata('unused', { persist });
    metadata.record({ sequence: 1 });
    await Promise.resolve();
    metadata.record({ sequence: 2 });
    await metadata.flush();
    expect(persist.mock.calls.at(-1)?.[0]).toContain('"sequence":2');
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('waits for a new write chain scheduled while flush is awaiting pending cleanup', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const persist = vi.fn(async (_content: string) => { if (persist.mock.calls.length === 2) await gate; });
    const metadata = createResizeWriteMetadata('unused', { persist });
    metadata.record({ sequence: 1 });
    await Promise.resolve();
    metadata.record({ sequence: 2 });
    let finished = false;
    const flush = metadata.flush().then(() => { finished = true; });
    await vi.waitFor(() => { expect(persist).toHaveBeenCalledTimes(2); });
    expect(finished).toBe(false);
    release?.();
    await flush;
    expect(finished).toBe(true);
  });

  it.each([undefined, null, new Error('write failed')])('records write-start before delegation and preserves completion %s', error => {
    let timestamp = 10;
    const record = vi.fn();
    const complete = vi.fn();
    const result = observeResizeWrite({
      sequence: 1, bytes: 250, snapshot: () => ({ timestamp, columns: 100, rows: 30, streamed: 40 }), record, complete,
      write: callback => {
        expect(record.mock.calls[0]?.[0]).toEqual({ kind: 'write-start', sequence: 1, bytes: 250,
          timestamp: 10, columns: 100, rows: 30, streamed: 40 });
        timestamp = 12;
        callback(error);
        timestamp = 13;
        return false;
      },
    });
    expect(result).toBe(false);
    expect(complete).toHaveBeenCalledExactlyOnceWith(error);
    expect(record.mock.calls[1]?.[0]).toMatchObject({ kind: 'complete', sequence: 1, timestamp: 12, error: error != null });
    expect(record.mock.calls[2]?.[0]).toMatchObject({ kind: 'write-return', sequence: 1, timestamp: 13, backpressured: true });
  });

  it('rejects limits that cannot retain a bounded tail', () => {
    expect(() => createResizeWriteMetadata('unused', { maxRecords: 0 })).toThrow('Resize metadata bounds');
    expect(() => createResizeWriteMetadata('unused', { maxBytes: 64 })).toThrow('Resize metadata bounds');
  });

  it('persists a bounded tail while one slow writer is in flight', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const persist = vi.fn(async (_content: string) => { await gate; });
    const metadata = createResizeWriteMetadata('unused', { persist, maxRecords: 2, maxBytes: 512 });
    for (let sequence = 0; sequence < 100; sequence += 1) metadata.record({ sequence });
    expect(persist).toHaveBeenCalledTimes(1);
    release?.();
    await metadata.flush();
    expect(persist).toHaveBeenCalledTimes(2);
    const latest = persist.mock.calls.at(-1)?.[0] ?? '';
    expect(latest.trim().split('\n').map((line: string) => JSON.parse(line))).toEqual([
      { sequence: 98 }, { sequence: 99 }, { kind: 'metadata-overflow', dropped: 98 },
    ]);
    expect(Buffer.byteLength(latest)).toBeLessThanOrEqual(512);
  });

  it('caps bytes, reports oversized records, and retains late events', async () => {
    const persist = vi.fn(async (_content: string) => {});
    const metadata = createResizeWriteMetadata('unused', { persist, maxRecords: 100, maxBytes: 256 });
    metadata.record({ oversized: 'x'.repeat(512) });
    for (let sequence = 0; sequence < 30; sequence += 1) metadata.record({ sequence, value: 'x'.repeat(40) });
    await metadata.flush();
    const latest = persist.mock.calls.at(-1)?.[0] ?? '';
    expect(Buffer.byteLength(latest)).toBeLessThanOrEqual(256);
    expect(latest).toContain('"sequence":29');
    expect(latest).not.toContain('"sequence":0,');
    expect(latest).toContain('"kind":"metadata-overflow"');
  });

  it('surfaces persistence failure on flush without rejecting the producer', async () => {
    const error = new Error('write failed');
    const persist = vi.fn(async () => { throw error; });
    const metadata = createResizeWriteMetadata('unused', { persist });
    expect(() => metadata.record({ sequence: 1 })).not.toThrow();
    await expect(metadata.flush()).rejects.toBe(error);
    metadata.record({ sequence: 2 });
    await expect(metadata.flush()).rejects.toBe(error);
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
