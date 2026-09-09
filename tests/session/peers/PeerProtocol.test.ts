import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { PeerFrameDecoder, RpcConnection, decodeRpcFrame } from '../../../src/session/peers/PeerProtocol.js';

describe('bounded JSON-RPC framing', () => {
  it('decodes split and coalesced frames without corrupting split UTF-8 code points', () => {
    const decoder = new PeerFrameDecoder();
    const first = { jsonrpc: '2.0', id: 'a', method: 'peer.send', params: { content: '🦊こんにちは' } };
    const second = { jsonrpc: '2.0', id: 'b', result: { state: 'accepted' } };
    const bytes = Buffer.from(`${JSON.stringify(first)}\n${JSON.stringify(second)}\n`);
    const frames: unknown[] = [];
    for (const byte of bytes) frames.push(...decoder.push(Buffer.from([byte])));
    expect(frames).toEqual([first, second]);
    expect(decoder.bufferedBytes).toBe(0);
  });

  it('bounds incomplete frames before parsing or accumulating unbounded bytes', () => {
    const decoder = new PeerFrameDecoder({ maxFrameBytes: 32 });
    decoder.push(Buffer.from('{"unfinished":"'));
    expect(() => decoder.push(Buffer.alloc(33, 120))).toThrow(/frame|limit/i);
    expect(decoder.bufferedBytes).toBeLessThanOrEqual(32);
  });

  it('accepts an exact frame limit and rejects one extra byte', () => {
    const frame = JSON.stringify({ jsonrpc: '2.0', id: 'a', result: 'yes' });
    const exact = new PeerFrameDecoder({ maxFrameBytes: Buffer.byteLength(frame) });
    expect(exact.push(Buffer.from(`${frame}\n`))).toHaveLength(1);
    const short = new PeerFrameDecoder({ maxFrameBytes: Buffer.byteLength(frame) - 1 });
    expect(() => short.push(Buffer.from(`${frame}\n`))).toThrow(/frame|limit/i);
  });

  it.each([
    'null', '[]', 'true', '{}', '{',
    '{"jsonrpc":"1.0","id":"x","method":"peer.send"}',
    '{"jsonrpc":"2.0","id":{},"method":"peer.send"}',
    '{"jsonrpc":"2.0","id":"x","method":42}',
    '{"jsonrpc":"2.0","id":"x","result":true,"error":{"code":-1,"message":"bad"}}',
    '{"jsonrpc":"2.0","id":"x","error":{"code":"wrong","message":42}}',
    '{"jsonrpc":"2.0","method":"peer.send","params":"not-an-object"}',
  ])('rejects malformed RPC input %s', json => {
    expect(() => decodeRpcFrame(Buffer.from(json))).toThrow();
  });

  it('rejects malformed UTF-8 instead of replacing invalid bytes inside content', () => {
    const bytes = Buffer.concat([Buffer.from('{"jsonrpc":"2.0","id":"a","result":"'), Buffer.from([0xc0, 0xaf]), Buffer.from('"}')]);
    expect(() => decodeRpcFrame(bytes)).toThrow(/UTF|encoding/i);
  });

  it('never accepts a message delivery notification as an acknowledgement-bearing request', () => {
    const notification = decodeRpcFrame(Buffer.from('{"jsonrpc":"2.0","method":"peer.send","params":{"content":"hello"}}'));
    expect(notification).not.toHaveProperty('id');
  });
});

describe('bounded stream request lifecycle', () => {
  it('settles every outstanding request when its transport disconnects', async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const connection = new RpcConnection({ readable, writable, requestTimeoutMs: 10_000 });
    const one = expect(connection.request('peer.status', { messageId: 'one' })).rejects.toMatchObject({ code: 'DELIVERY_UNKNOWN' });
    const two = expect(connection.request('peer.status', { messageId: 'two' })).rejects.toMatchObject({ code: 'DELIVERY_UNKNOWN' });
    readable.destroy();
    await Promise.all([one, two]);
    expect(connection.pendingCount).toBe(0);
    connection.close();
  });

  it('limits in-flight calls and releases capacity after a response', async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    const connection = new RpcConnection({ readable, writable, maxPending: 1 });
    const requests: Array<{ id: string }> = [];
    writable.on('data', chunk => requests.push(JSON.parse(String(chunk))));
    const first = connection.request('peer.status', { messageId: 'one' });
    await expect(connection.request('peer.status', { messageId: 'two' })).rejects.toMatchObject({ code: 'QUEUE_FULL' });
    await Promise.resolve();
    readable.write(`${JSON.stringify({ jsonrpc: '2.0', id: requests[0].id, result: { state: 'accepted' } })}\n`);
    expect(await first).toEqual({ state: 'accepted' });
    expect(connection.pendingCount).toBe(0);
    connection.close();
  });

  it('honors writable backpressure without reordering or duplicating frames', async () => {
    const readable = new PassThrough();
    const writable = new PassThrough({ highWaterMark: 1 });
    const connection = new RpcConnection({ readable, writable });
    const first = connection.request('peer.status', { messageId: 'first' });
    const second = connection.request('peer.status', { messageId: 'second' });
    const requests: Array<{ id: string; params: { messageId: string } }> = [];
    writable.on('data', chunk => {
      const frame = JSON.parse(String(chunk));
      requests.push(frame);
      readable.write(`${JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: frame.params.messageId })}\n`);
    });
    expect(await Promise.all([first, second])).toEqual(['first', 'second']);
    expect(requests.map(frame => frame.params.messageId)).toEqual(['first', 'second']);
    connection.close();
  });

  it('returns an unknown delivery outcome on timeout and ignores a late response safely', async () => {
    const readable = new PassThrough();
    const writable = new PassThrough();
    let requestId = '';
    writable.on('data', chunk => { requestId = JSON.parse(String(chunk)).id; });
    const connection = new RpcConnection({ readable, writable, requestTimeoutMs: 5 });
    await expect(connection.request('peer.send', { content: 'uncertain' })).rejects.toMatchObject({ code: 'DELIVERY_UNKNOWN' });
    readable.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, result: { state: 'accepted' } })}\n`);
    expect(connection.pendingCount).toBe(0);
    connection.close();
  });
});
