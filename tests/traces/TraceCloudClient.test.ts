import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TraceUpload } from '../../src/traces/model.js';
import { TraceCloudClient } from '../../src/traces/TraceCloudClient.js';

function upload(id = 'trace-1'): TraceUpload {
  return {
    schemaVersion: 1,
    traceId: id,
    sourceExternalIdHash: 'a'.repeat(64),
    sourceFingerprint: 'sha256:fixture',
    contentMode: 'metadata',
    harness: 'autohand',
    status: 'completed',
    usage: { input: 10, output: 2, total: 12, provenance: 'actual' },
    relationships: [],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TraceCloudClient', () => {
  it('rejects insecure remote or credential-bearing API endpoints before upload', () => {
    const options = {
      authToken: 'account-token',
      clientVersion: '0.9.0',
      deviceId: 'device-1',
    };

    expect(() => new TraceCloudClient({
      ...options,
      apiBaseUrl: 'http://collector.example.test',
    })).toThrow('HTTPS URL or localhost');
    expect(() => new TraceCloudClient({
      ...options,
      apiBaseUrl: 'https://user:password@api.autohand.ai',
    })).toThrow('HTTPS URL or localhost');
    expect(() => new TraceCloudClient({
      ...options,
      apiBaseUrl: 'http://localhost:8787',
    })).not.toThrow();
  });

  it('uploads an authenticated bounded batch and validates acknowledgements', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      accepted: ['trace-1'],
      rejected: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new TraceCloudClient({
      apiBaseUrl: 'https://api.autohand.ai/',
      authToken: 'account-token',
      clientVersion: '0.9.0',
      deviceId: 'device-1',
    });

    await expect(client.uploadBatch([upload()])).resolves.toEqual({
      accepted: ['trace-1'],
      rejected: [],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.autohand.ai/v1/traces/batch');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer account-token',
      'Content-Type': 'application/json',
      'X-CLI-Version': '0.9.0',
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      schemaVersion: 1,
      deviceId: 'device-1',
      traces: [{ traceId: 'trace-1', contentMode: 'metadata' }],
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects oversized batches before making a network request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new TraceCloudClient({
      apiBaseUrl: 'https://api.autohand.ai',
      authToken: 'account-token',
      clientVersion: '0.9.0',
      deviceId: 'device-1',
    });

    await expect(client.uploadBatch(Array.from({ length: 51 }, (_, index) => upload(`trace-${index}`))))
      .rejects.toThrow('at most 50');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects contradictory or duplicate trace acknowledgements', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      accepted: ['trace-1'],
      rejected: [{ traceId: 'trace-1', code: 'invalid' }],
    })));
    const client = new TraceCloudClient({
      apiBaseUrl: 'https://api.autohand.ai',
      authToken: 'account-token',
      clientVersion: '0.9.0',
      deviceId: 'device-1',
    });

    await expect(client.uploadBatch([upload()]))
      .rejects.toThrow('exactly once');
  });

  it('splits full-content uploads into complete acknowledgements below the 4 MiB wire limit', async () => {
    const requestSizes: number[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body);
      requestSizes.push(Buffer.byteLength(body));
      const envelope = JSON.parse(body) as { traces: TraceUpload[] };
      return Response.json({
        accepted: envelope.traces.map((trace) => trace.traceId),
        rejected: [],
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new TraceCloudClient({
      apiBaseUrl: 'https://api.autohand.ai',
      authToken: 'account-token',
      clientVersion: '0.9.0',
      deviceId: 'device-1',
    });
    const traces = Array.from({ length: 5 }, (_, index): TraceUpload => ({
      ...upload(`trace-${index}`),
      contentMode: 'full',
      messages: [{
        id: `message-${index}`,
        role: 'assistant',
        order: 0,
        usage: { provenance: 'unavailable' },
        parts: [{ type: 'text', text: 'x'.repeat(1_100_000) }],
      }],
    }));

    await expect(client.uploadBatch(traces)).resolves.toEqual({
      accepted: traces.map((trace) => trace.traceId),
      rejected: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestSizes.every((size) => size <= 4 * 1024 * 1024)).toBe(true);
  });

  it('releases unread response bodies on non-success status', async () => {
    const cancel = vi.fn(async () => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '60' }),
      body: { cancel },
    })));
    const client = new TraceCloudClient({
      apiBaseUrl: 'https://api.autohand.ai',
      authToken: 'account-token',
      clientVersion: '0.9.0',
      deviceId: 'device-1',
    });

    await expect(client.uploadBatch([upload()])).rejects.toMatchObject({
      name: 'TraceCloudError',
      status: 429,
      retryAfterMs: 60_000,
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('stops reading and cancels an oversized successful acknowledgement', async () => {
    const cancel = vi.fn(async () => {});
    const releaseLock = vi.fn();
    const read = vi.fn(async () => ({
      done: false,
      value: new Uint8Array((256 * 1024) + 1),
    }));
    const text = vi.fn(async () => 'x'.repeat((256 * 1024) + 1));
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: { getReader: () => ({ read, cancel, releaseLock }) },
      text,
    })));
    const client = new TraceCloudClient({
      apiBaseUrl: 'https://api.autohand.ai',
      authToken: 'account-token',
      clientVersion: '0.9.0',
      deviceId: 'device-1',
    });

    await expect(client.uploadBatch([upload()]))
      .rejects.toThrow('acknowledgement exceeded its size limit');
    expect(read).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
    expect(text).not.toHaveBeenCalled();
  });
});
