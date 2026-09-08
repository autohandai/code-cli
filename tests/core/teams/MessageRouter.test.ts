import { describe, it, expect, vi } from 'vitest';
import { MessageRouter } from '../../../src/core/teams/MessageRouter.js';
import { PassThrough } from 'node:stream';

describe('MessageRouter', () => {
  it('should encode a JSON-RPC notification', () => {
    const line = MessageRouter.encode({
      method: 'team.ready',
      params: { name: 'researcher' },
    });
    const parsed = JSON.parse(line);
    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.method).toBe('team.ready');
    expect(parsed.params.name).toBe('researcher');
  });

  it('should decode incoming JSON-RPC lines from a stream', async () => {
    const stream = new PassThrough();
    const messages: unknown[] = [];

    const router = new MessageRouter();
    router.onMessage(stream, (msg) => messages.push(msg));

    const line = JSON.stringify({
      jsonrpc: '2.0',
      method: 'team.taskUpdate',
      params: { taskId: 'task-1', status: 'completed' },
    });
    stream.write(line + '\n');

    // Give event loop a tick
    await new Promise((r) => setTimeout(r, 10));

    expect(messages).toHaveLength(1);
    expect((messages[0] as any).method).toBe('team.taskUpdate');
  });

  it('should ignore non-JSON lines', async () => {
    const stream = new PassThrough();
    const messages: unknown[] = [];
    const router = new MessageRouter();
    router.onMessage(stream, (msg) => messages.push(msg));

    stream.write('not json\n');
    stream.write('also not json\n');

    await new Promise((r) => setTimeout(r, 10));
    expect(messages).toHaveLength(0);
  });

  it('should send a message to a writable stream', () => {
    const stream = new PassThrough();
    const chunks: string[] = [];
    stream.on('data', (chunk) => chunks.push(chunk.toString()));

    const router = new MessageRouter();
    router.send(stream, { method: 'team.assignTask', params: { task: {} } });

    expect(chunks).toHaveLength(1);
    const parsed = JSON.parse(chunks[0].trim());
    expect(parsed.method).toBe('team.assignTask');
  });

  it('ignores malformed message shapes before calling the receiver', () => {
    const stream = new PassThrough();
    const receive = vi.fn();
    const router = new MessageRouter();
    router.onMessage(stream, receive);

    for (const value of [null, [], { method: 3, params: {} }, { method: 'team.ready' },
      { method: 'team.ready', params: null }, { method: 'team.ready', params: [] }]) {
      stream.write(JSON.stringify(value) + '\n');
    }
    stream.write('{"method":"team.ready","params":{}}\n');

    expect(receive).toHaveBeenCalledExactlyOnceWith({ method: 'team.ready', params: {} });
  });

  it('forwards readline input errors without an unhandled error event', () => {
    const stream = new PassThrough();
    const onError = vi.fn();
    const router = new MessageRouter();
    router.onMessage(stream, vi.fn(), onError);
    const error = new Error('read failed');

    expect(() => stream.emit('error', error)).not.toThrow();
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  });

  it('handles input errors when no error callback is provided', () => {
    const stream = new PassThrough();
    new MessageRouter().onMessage(stream, vi.fn());

    expect(() => stream.emit('error', new Error('read failed'))).not.toThrow();
  });

  it('unsubscribes without retaining stream listeners or receiving further lines', () => {
    const stream = new PassThrough();
    const receive = vi.fn();
    const existingErrorListener = vi.fn();
    stream.on('error', existingErrorListener);
    const before = stream.eventNames().map((event) => [event, stream.listenerCount(event)]);
    const unsubscribe = new MessageRouter().onMessage(stream, receive);

    unsubscribe();
    unsubscribe();
    stream.write('{"method":"team.ready","params":{}}\n');
    stream.resume();

    expect(receive).not.toHaveBeenCalled();
    expect(stream.eventNames().map((event) => [event, stream.listenerCount(event)])).toEqual(before);
  });
});
