import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, lstat, readFile, symlink, writeFile } from 'node:fs/promises';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connect } from 'node:net';
import { once } from 'node:events';
import { createTransportIdentity, createHandshakeTranscript, signHandshake, verifyHandshake } from '../../../src/session/peers/PeerIdentity.js';
import { LocalPeerTransport } from '../../../src/session/peers/LocalPeerTransport.js';
import type { PeerAdvertisement } from '../../../src/session/peers/PeerProtocol.js';

let directory: string;
const transports: LocalPeerTransport[] = [];
const directoryEntries = new Map<string, PeerAdvertisement>();
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'ah-ipc-'));
  directoryEntries.clear();
});
afterEach(async () => {
  await Promise.allSettled(transports.splice(0).map(transport => transport.close()));
  await rm(directory, { recursive: true, force: true });
});

async function endpoint(onRequest = vi.fn(async () => ({ ok: true }))) {
  const identity = createTransportIdentity();
  const transport = new LocalPeerTransport({
    directory, identity, onRequest,
    lookupIdentity: async instanceId => directoryEntries.get(instanceId),
  });
  transports.push(transport);
  const advertisement = await transport.start();
  directoryEntries.set(identity.instanceId, advertisement);
  return { transport, identity, advertisement, onRequest };
}

describe('mutually authenticated local endpoints', () => {
  it('authenticates both endpoint incarnations before dispatching application requests', async () => {
    const sender = await endpoint();
    const recipient = await endpoint();
    const connection = await sender.transport.connect(recipient.advertisement);
    expect(await connection.request('peer.status', { messageId: 'm1' })).toEqual({ ok: true });
    expect(recipient.onRequest).toHaveBeenCalledWith('peer.status', { messageId: 'm1' }, expect.objectContaining({ instanceId: sender.identity.instanceId }));
  });

  it('rejects an unauthenticated application request without invoking the handler', async () => {
    const recipient = await endpoint();
    const socket = connect(recipient.advertisement.endpoint);
    await once(socket, 'connect');
    const closed = once(socket, 'close');
    socket.on('error', () => {});
    socket.resume();
    socket.write('{"jsonrpc":"2.0","id":"forged","method":"peer.send","params":{"content":"untrusted"}}\n');
    await closed;
    expect(recipient.onRequest).not.toHaveBeenCalled();
  });

  it('rejects a discovery key substitution and a mismatched expected instance', async () => {
    const sender = await endpoint();
    const recipient = await endpoint();
    const stranger = createTransportIdentity();
    await expect(sender.transport.connect({ ...recipient.advertisement, publicKey: stranger.publicKey })).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
    await expect(sender.transport.connect({ ...recipient.advertisement, instanceId: stranger.instanceId })).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
    expect(recipient.onRequest).not.toHaveBeenCalled();
  });

  it('rejects an unregistered sender even when its cryptographic proof is valid', async () => {
    const sender = await endpoint();
    const recipient = await endpoint();
    directoryEntries.delete(sender.identity.instanceId);
    await expect(sender.transport.connect(recipient.advertisement)).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' });
  });

  it('negotiates application version separately from JSON-RPC and rejects an incompatible protocol', async () => {
    const sender = await endpoint();
    const recipient = await endpoint();
    await expect(sender.transport.connect({ ...recipient.advertisement, protocol: 2 })).rejects.toMatchObject({ code: 'UNSUPPORTED_PROTOCOL' });
  });

  it('times out partial authentication and releases the accepted socket', async () => {
    const recipient = await endpoint();
    const socket = connect(recipient.advertisement.endpoint);
    socket.on('error', () => {});
    await once(socket, 'connect');
    const started = Date.now();
    await once(socket, 'close');
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(recipient.onRequest).not.toHaveBeenCalled();
  });

  it('rejects a reused client challenge across connections', async () => {
    const sender = await endpoint();
    const recipient = await endpoint();
    const hello = { jsonrpc: '2.0', id: 'hello', method: 'peer.hello', params: {
      version: 1, instanceId: sender.identity.instanceId, publicKey: sender.identity.publicKey,
      nonce: Buffer.alloc(32, 7).toString('base64'),
    } };
    const first = connect(recipient.advertisement.endpoint);
    first.on('error', () => {});
    await once(first, 'connect');
    const response = once(first, 'data');
    first.write(`${JSON.stringify(hello)}\n`);
    const [data] = await response;
    expect(JSON.parse(String(data))).toMatchObject({ id: 'hello', result: { nonce: expect.any(String), proof: expect.any(String) } });
    first.destroy();
    const replay = connect(recipient.advertisement.endpoint);
    replay.on('error', () => {});
    replay.resume();
    await once(replay, 'connect');
    const rejected = once(replay, 'close');
    replay.write(`${JSON.stringify(hello)}\n`);
    await rejected;
    expect(recipient.onRequest).not.toHaveBeenCalled();
  });

  it('evicts idle outbound connections and keeps cached connections bounded', async () => {
    const sender = await endpoint();
    for (let index = 0; index < 18; index++) {
      const recipient = await endpoint();
      const connection = await sender.transport.connect(recipient.advertisement);
      await connection.request('peer.status', {});
    }
    expect(sender.transport.connectionCount).toBeLessThanOrEqual(16);
  });
});

describe('handshake transcript integrity', () => {
  it('binds roles, instances, public keys, protocol and both fresh challenges', () => {
    const client = createTransportIdentity();
    const server = createTransportIdentity();
    const fields = {
      protocol: 1, role: 'client' as const,
      clientInstanceId: client.instanceId, serverInstanceId: server.instanceId,
      clientPublicKey: client.publicKey, serverPublicKey: server.publicKey,
      clientNonce: Buffer.alloc(32, 1).toString('base64'), serverNonce: Buffer.alloc(32, 2).toString('base64'),
    };
    const transcript = createHandshakeTranscript(fields);
    const proof = signHandshake(client, transcript);
    expect(verifyHandshake(client.publicKey, transcript, proof)).toBe(true);
    const mutations = [
      { protocol: 2 }, { role: 'server' as const }, { clientInstanceId: 'different' },
      { serverInstanceId: 'different' }, { clientPublicKey: server.publicKey },
      { serverPublicKey: client.publicKey },
      { clientNonce: Buffer.alloc(32, 3).toString('base64') },
      { serverNonce: Buffer.alloc(32, 4).toString('base64') },
    ];
    for (const mutation of mutations) {
      expect(verifyHandshake(client.publicKey, createHandshakeTranscript({ ...fields, ...mutation }), proof)).toBe(false);
    }
  });

  it('uses length-prefixed fields so ambiguous concatenations cannot share a signature', () => {
    const identity = createTransportIdentity();
    const fields = {
      protocol: 1, role: 'client' as const, clientInstanceId: 'ab', serverInstanceId: 'c',
      clientPublicKey: identity.publicKey, serverPublicKey: identity.publicKey,
      clientNonce: Buffer.alloc(32, 1).toString('base64'), serverNonce: Buffer.alloc(32, 2).toString('base64'),
    };
    expect(createHandshakeTranscript(fields)).not.toEqual(createHandshakeTranscript({ ...fields, clientInstanceId: 'a', serverInstanceId: 'bc' }));
  });
});

describe('private endpoint filesystem ownership', () => {
  it('uses a short private socket path when the configured directory is too long', async () => {
    const deep = path.join(directory, 'long'.repeat(30));
    await mkdir(deep);
    const identity = createTransportIdentity();
    const transport = new LocalPeerTransport({ directory: deep, identity, lookupIdentity: async () => undefined, onRequest: async () => null });
    transports.push(transport);
    const advertisement = await transport.start();
    if (process.platform !== 'win32') {
      expect(Buffer.byteLength(advertisement.endpoint)).toBeLessThan(process.platform === 'darwin' ? 104 : 108);
      expect((await lstat(path.dirname(advertisement.endpoint))).mode & 0o777).toBe(0o700);
      expect((await lstat(advertisement.endpoint)).isSocket()).toBe(true);
    }
  });

  it('rejects a symlink runtime directory without modifying its target', async () => {
    const target = path.join(directory, 'target');
    await mkdir(target);
    await writeFile(path.join(target, 'keep'), 'unchanged');
    const link = path.join(directory, 'runtime-link');
    await symlink(target, link, 'dir');
    const transport = new LocalPeerTransport({ directory: link, identity: createTransportIdentity(), lookupIdentity: async () => undefined, onRequest: async () => null });
    transports.push(transport);
    await expect(transport.start()).rejects.toMatchObject({ code: 'UNSAFE_ENDPOINT' });
    expect(await readFile(path.join(target, 'keep'), 'utf8')).toBe('unchanged');
  });

  it('never unlinks a failed target or another listener during cleanup', async () => {
    const sender = await endpoint();
    const recipient = await endpoint();
    const foreign = path.join(directory, 'foreign-file');
    await writeFile(foreign, 'keep');
    await expect(sender.transport.connect({ ...recipient.advertisement, endpoint: foreign })).rejects.toBeDefined();
    await sender.transport.close();
    expect(await readFile(foreign, 'utf8')).toBe('keep');
    if (process.platform !== 'win32') expect((await lstat(recipient.advertisement.endpoint)).isSocket()).toBe(true);
  });
});
