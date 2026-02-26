import { describe, it, expect } from 'vitest';
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
});
