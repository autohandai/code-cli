import { createHash, randomBytes } from 'node:crypto';
import { chmod, lstat, realpath, rmdir, unlink } from 'node:fs/promises';
import { createServer, createConnection, type Server, type Socket } from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHandshakeTranscript, isHandshakeNonce, signHandshake, verifyHandshake, type HandshakeFields, type PeerTransportIdentity } from './PeerIdentity.js';
import { isPeerObject, PeerError, RpcConnection, validatePeerAdvertisement, type PeerAdvertisement, type PeerCapability } from './PeerProtocol.js';
import { ensurePrivatePeerDirectory, peerFilesystemErrorCode } from './PeerStorage.js';

export interface AuthenticatedPeer {
  instanceId: string;
  publicKey: string;
  capabilities: PeerCapability[];
}

export interface PeerSecurityEvidence {
  currentUserOnly: boolean;
  authentication: 'mutual-ed25519';
  evidence: 'posix-owner-mode' | 'windows-acl';
}

export interface LocalPeerTransportOptions {
  directory: string;
  identity: PeerTransportIdentity;
  lookupIdentity: (instanceId: string) => Promise<PeerAdvertisement | undefined>;
  onRequest: (method: string, params: Record<string, unknown>, peer: AuthenticatedPeer) => Promise<unknown>;
  onNotification?: (method: string, params: Record<string, unknown>, peer: AuthenticatedPeer) => Promise<void> | void;
  capabilities?: PeerCapability[];
  limits?: { frameBytes?: number; pendingRequests?: number; connections?: number; handshakeMs?: number; acknowledgementMs?: number };
}

interface CachedConnection {
  advertisement: PeerAdvertisement;
  promise: Promise<RpcConnection>;
  connection?: RpcConnection;
}

export class LocalPeerTransport {
  private server?: Server;
  private advertisement?: PeerAdvertisement;
  private startPromise?: Promise<PeerAdvertisement>;
  private closePromise?: Promise<void>;
  private stopped = false;
  private readonly connections = new Set<RpcConnection>();
  private readonly sockets = new Set<Socket>();
  private readonly outbound = new Map<string, CachedConnection>();
  private readonly handshakeTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly usedNonces = new Map<string, number>();
  private endpointIdentity?: { ino: number; uid: number; directoryIno: number };
  private fallbackDirectory?: string;

  constructor(private readonly options: LocalPeerTransportOptions) {}

  get connectionCount(): number { return this.outbound.size; }
  get securityEvidence(): PeerSecurityEvidence | undefined {
    return this.advertisement ? { currentUserOnly: true, authentication: 'mutual-ed25519', evidence: 'posix-owner-mode' } : undefined;
  }

  start(): Promise<PeerAdvertisement> {
    if (this.stopped) return Promise.reject(new PeerError('PEER_OFFLINE', 'This endpoint incarnation has stopped.'));
    this.startPromise ??= this.bindEndpoint();
    return this.startPromise;
  }

  async connect(value: PeerAdvertisement): Promise<RpcConnection> {
    if (this.stopped) throw new PeerError('PEER_OFFLINE', 'This endpoint has stopped.');
    const advertisement = validatePeerAdvertisement(value);
    if (!advertisement) throw new PeerError('UNSAFE_ENDPOINT', 'The advertised endpoint metadata is invalid.');
    if (advertisement.protocol !== 1) throw new PeerError('UNSUPPORTED_PROTOCOL', 'The peer uses an incompatible communication protocol; update the older CLI.');
    const existing = this.outbound.get(advertisement.instanceId);
    if (existing && existing.advertisement.endpoint === advertisement.endpoint && existing.advertisement.publicKey === advertisement.publicKey && !existing.connection?.isClosed) return existing.promise;
    if (existing) { existing.connection?.close(); this.outbound.delete(advertisement.instanceId); }
    this.makeConnectionRoom();
    const entry: CachedConnection = { advertisement, promise: this.openAuthenticatedConnection(advertisement) };
    this.outbound.set(advertisement.instanceId, entry);
    entry.promise = entry.promise.then(connection => {
      entry.connection = connection;
      if (this.stopped) { connection.close(); throw new PeerError('PEER_OFFLINE', 'The endpoint stopped while connecting.'); }
      return connection;
    }).catch(error => {
      if (this.outbound.get(advertisement.instanceId) === entry) this.outbound.delete(advertisement.instanceId);
      throw error;
    });
    return entry.promise;
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeEndpoint();
    return this.closePromise;
  }

  diagnostics(): { connections: number; inboundConnections: number; pendingRequests: number } {
    return { connections: this.outbound.size, inboundConnections: this.connections.size, pendingRequests: [...this.connections].reduce((count, connection) => count + connection.pendingCount, 0) };
  }

  private makeConnectionRoom(): void {
    const maximum = this.options.limits?.connections ?? 16;
    while (this.outbound.size >= maximum) {
      const idle = [...this.outbound].filter(([, entry]) => entry.connection?.isIdle || entry.connection?.isClosed)
        .sort(([, left], [, right]) => (left.connection?.lastUsedAt ?? 0) - (right.connection?.lastUsedAt ?? 0))[0];
      if (!idle) throw new PeerError('QUEUE_FULL', 'All cached peer connections are busy; retry after an acknowledgement.');
      this.outbound.delete(idle[0]);
      idle[1].connection?.close();
    }
  }

  private async bindEndpoint(): Promise<PeerAdvertisement> {
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(this.options.identity.instanceId)) throw new PeerError('UNSAFE_ENDPOINT', 'Invalid endpoint incarnation.');
    let directory = await ensurePrivatePeerDirectory(this.options.directory);
    const filename = `${this.options.identity.instanceId}.sock`;
    const maxBytes = process.platform === 'darwin' ? 103 : 107;
    if (Buffer.byteLength(path.join(directory, filename)) > maxBytes) {
      const base = await realpath(process.platform === 'darwin' ? '/tmp' : tmpdir());
      const namespace = createHash('sha256').update(directory).digest('hex').slice(0, 12);
      directory = await ensurePrivatePeerDirectory(path.join(base, `ahp-${process.geteuid?.()}-${namespace}`));
      this.fallbackDirectory = directory;
    }
    const endpoint = path.join(directory, filename);
    if (Buffer.byteLength(endpoint) > maxBytes) throw new PeerError('UNSAFE_ENDPOINT', 'No verified private endpoint fits the platform IPC path limit.');
    if (this.stopped) throw new PeerError('PEER_OFFLINE', 'The endpoint stopped before binding.');
    const server = createServer(socket => this.acceptSocket(socket));
    server.maxConnections = Math.max(32, (this.options.limits?.connections ?? 16) * 4);
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => { server.off('listening', bound); reject(error); };
      const bound = () => { server.off('error', failed); resolve(); };
      server.once('error', failed);
      server.once('listening', bound);
      server.listen(endpoint);
    });
    server.on('error', () => { void this.close(); });
    await chmod(endpoint, 0o600);
    const [socketInfo, directoryInfo] = await Promise.all([lstat(endpoint), lstat(directory)]);
    if (!socketInfo.isSocket() || socketInfo.uid !== process.geteuid?.() || (socketInfo.mode & 0o777) !== 0o600) throw new PeerError('UNSAFE_ENDPOINT', 'The IPC endpoint is not private to the current OS user.');
    this.endpointIdentity = { ino: socketInfo.ino, uid: socketInfo.uid, directoryIno: directoryInfo.ino };
    this.advertisement = { protocol: 1, instanceId: this.options.identity.instanceId, endpoint, publicKey: this.options.identity.publicKey, capabilities: this.options.capabilities ?? ['message.send', 'message.receive', 'message.wait'] };
    if (this.stopped) throw new PeerError('PEER_OFFLINE', 'The endpoint stopped during binding.');
    return { ...this.advertisement };
  }

  private acceptSocket(socket: Socket): void {
    if (this.stopped || this.sockets.size >= Math.max(32, (this.options.limits?.connections ?? 16) * 4)) { socket.destroy(); return; }
    this.trackSocket(socket);
    let authenticated: AuthenticatedPeer | undefined;
    let challenge: HandshakeFields | undefined;
    let handshakeBusy = false;
    const timer = setTimeout(() => connection.close(), this.options.limits?.handshakeMs ?? 2_000);
    this.handshakeTimers.add(timer);
    const releaseTimer = () => { clearTimeout(timer); this.handshakeTimers.delete(timer); };
    const connection: RpcConnection = new RpcConnection({
      readable: socket, writable: socket,
      maxFrameBytes: this.options.limits?.frameBytes, maxPending: this.options.limits?.pendingRequests,
      requestTimeoutMs: this.options.limits?.acknowledgementMs,
      onClose: () => { releaseTimer(); this.connections.delete(connection); },
      onNotification: async (method, params) => {
        if (authenticated) await this.options.onNotification?.(method, params, authenticated);
      },
      onRequest: async (method, params) => {
        if (authenticated) return this.options.onRequest(method, params, authenticated);
        if (handshakeBusy) throw new PeerError('AUTHENTICATION_FAILED', 'Handshake steps must be sequential.');
        handshakeBusy = true;
        try {
          if (method === 'peer.hello' && !challenge) {
            if (params.version !== 1) throw new PeerError('UNSUPPORTED_PROTOCOL', 'Only peer protocol version 1 is supported.');
            if (typeof params.instanceId !== 'string' || typeof params.publicKey !== 'string' || !isHandshakeNonce(params.nonce)) throw new PeerError('AUTHENTICATION_FAILED', 'Invalid client challenge.');
            const advertised = await this.options.lookupIdentity(params.instanceId);
            if (!advertised || advertised.protocol !== 1 || advertised.publicKey !== params.publicKey || !this.reserveNonce(params.nonce)) throw new PeerError('AUTHENTICATION_FAILED', 'Unknown identity, mismatched key or reused challenge.');
            const serverNonce = this.freshNonce();
            challenge = { protocol: 1, role: 'server', clientInstanceId: params.instanceId, serverInstanceId: this.options.identity.instanceId, clientPublicKey: params.publicKey, serverPublicKey: this.options.identity.publicKey, clientNonce: params.nonce, serverNonce };
            return { version: 1, instanceId: this.options.identity.instanceId, publicKey: this.options.identity.publicKey, nonce: serverNonce, proof: signHandshake(this.options.identity, createHandshakeTranscript(challenge)), capabilities: this.options.capabilities ?? ['message.send', 'message.receive', 'message.wait'] };
          }
          if (method === 'peer.authenticate' && challenge && typeof params.proof === 'string') {
            const advertised = await this.options.lookupIdentity(challenge.clientInstanceId);
            if (!advertised || advertised.publicKey !== challenge.clientPublicKey || !verifyHandshake(challenge.clientPublicKey, createHandshakeTranscript({ ...challenge, role: 'client' }), params.proof)) throw new PeerError('AUTHENTICATION_FAILED', 'The client proof did not match the complete handshake.');
            authenticated = { instanceId: challenge.clientInstanceId, publicKey: challenge.clientPublicKey, capabilities: advertised.capabilities };
            releaseTimer();
            return { authenticated: true, version: 1 };
          }
          throw new PeerError('AUTHENTICATION_FAILED', 'Complete mutual authentication before sending application requests.');
        } finally { handshakeBusy = false; }
      },
    });
    this.connections.add(connection);
  }

  private async openAuthenticatedConnection(advertisement: PeerAdvertisement): Promise<RpcConnection> {
    await this.verifyTarget(advertisement);
    const socket = createConnection(advertisement.endpoint);
    this.trackSocket(socket);
    let authenticated = false;
    let connection: RpcConnection | undefined;
    const timeout = setTimeout(() => { socket.destroy(new Error('Peer authentication deadline exceeded.')); connection?.close(); }, this.options.limits?.handshakeMs ?? 2_000);
    this.handshakeTimers.add(timeout);
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error) => { socket.off('connect', connected); reject(error); };
        const connected = () => { socket.off('error', failed); resolve(); };
        socket.once('error', failed);
        socket.once('connect', connected);
      });
      const peer: AuthenticatedPeer = { instanceId: advertisement.instanceId, publicKey: advertisement.publicKey, capabilities: advertisement.capabilities };
      const rpc = new RpcConnection({
        readable: socket, writable: socket, maxFrameBytes: this.options.limits?.frameBytes,
        maxPending: this.options.limits?.pendingRequests, requestTimeoutMs: this.options.limits?.acknowledgementMs,
        onRequest: (method, params) => {
          if (!authenticated) throw new PeerError('AUTHENTICATION_FAILED', 'Server proof has not been verified.');
          return this.options.onRequest(method, params, peer);
        },
        onNotification: (method, params) => { if (authenticated) return this.options.onNotification?.(method, params, peer); },
        onClose: () => { this.connections.delete(rpc); },
      });
      connection = rpc;
      this.connections.add(rpc);
      const clientNonce = this.freshNonce();
      const hello = await rpc.request('peer.hello', { version: 1, instanceId: this.options.identity.instanceId, publicKey: this.options.identity.publicKey, nonce: clientNonce });
      if (!isPeerObject(hello) || hello.version !== 1 || hello.instanceId !== advertisement.instanceId || hello.publicKey !== advertisement.publicKey || !isHandshakeNonce(hello.nonce) || typeof hello.proof !== 'string' || !this.reserveNonce(hello.nonce)) throw new PeerError('AUTHENTICATION_FAILED', 'The server identity or challenge did not match discovery.');
      const fields: HandshakeFields = { protocol: 1, role: 'server', clientInstanceId: this.options.identity.instanceId, serverInstanceId: advertisement.instanceId, clientPublicKey: this.options.identity.publicKey, serverPublicKey: advertisement.publicKey, clientNonce, serverNonce: hello.nonce };
      if (!verifyHandshake(advertisement.publicKey, createHandshakeTranscript(fields), hello.proof)) throw new PeerError('AUTHENTICATION_FAILED', 'The server proof did not match the complete handshake.');
      const confirmation = await rpc.request('peer.authenticate', { proof: signHandshake(this.options.identity, createHandshakeTranscript({ ...fields, role: 'client' })) });
      if (!isPeerObject(confirmation) || confirmation.authenticated !== true || confirmation.version !== 1) throw new PeerError('AUTHENTICATION_FAILED', 'The server did not confirm mutual authentication.');
      authenticated = true;
      return rpc;
    } catch (error) {
      connection?.close();
      socket.destroy();
      if (error instanceof PeerError && error.code !== 'DELIVERY_UNKNOWN') throw error;
      if (['ECONNREFUSED', 'ENOENT'].includes(peerFilesystemErrorCode(error) ?? '')) throw new PeerError('PEER_OFFLINE', 'The exact endpoint is no longer listening.');
      throw new PeerError('AUTHENTICATION_FAILED', 'Peer authentication failed or exceeded its deadline.');
    } finally { clearTimeout(timeout); this.handshakeTimers.delete(timeout); }
  }

  private async verifyTarget(advertisement: PeerAdvertisement): Promise<void> {
    if (process.platform === 'win32') throw new PeerError('UNSUPPORTED_PLATFORM', 'The verified Windows ACL adapter is required.');
    if (!path.isAbsolute(advertisement.endpoint) || path.basename(advertisement.endpoint) !== `${advertisement.instanceId}.sock`) throw new PeerError('AUTHENTICATION_FAILED', 'Endpoint pathname does not match the expected incarnation.');
    try {
      const [directory, endpoint] = await Promise.all([lstat(path.dirname(advertisement.endpoint)), lstat(advertisement.endpoint)]);
      if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.geteuid?.() || (directory.mode & 0o777) !== 0o700
        || !endpoint.isSocket() || endpoint.isSymbolicLink() || endpoint.uid !== process.geteuid?.() || (endpoint.mode & 0o077) !== 0) throw new PeerError('UNSAFE_ENDPOINT', 'The advertised socket is not private to this OS user.');
    } catch (error) {
      if (peerFilesystemErrorCode(error) === 'ENOENT') throw new PeerError('PEER_OFFLINE', 'The exact peer endpoint disappeared.');
      throw error;
    }
    const registered = await this.options.lookupIdentity(advertisement.instanceId);
    if (registered && (registered.publicKey !== advertisement.publicKey || registered.endpoint !== advertisement.endpoint)) throw new PeerError('AUTHENTICATION_FAILED', 'The endpoint identity changed; refresh discovery.');
  }

  private trackSocket(socket: Socket): void {
    this.sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => this.sockets.delete(socket));
  }

  private reserveNonce(nonce: string): boolean {
    const before = Date.now() - 3_600_000;
    for (const [used, timestamp] of this.usedNonces) {
      if (timestamp > before) break;
      this.usedNonces.delete(used);
    }
    if (this.usedNonces.has(nonce)) return false;
    if (this.usedNonces.size >= 8_192) this.usedNonces.delete(this.usedNonces.keys().next().value!);
    this.usedNonces.set(nonce, Date.now());
    return true;
  }

  private freshNonce(): string {
    let nonce: string;
    do { nonce = randomBytes(32).toString('base64'); } while (!this.reserveNonce(nonce));
    return nonce;
  }

  private async closeEndpoint(): Promise<void> {
    this.stopped = true;
    await this.startPromise?.catch(() => {});
    for (const timer of this.handshakeTimers) clearTimeout(timer);
    this.handshakeTimers.clear();
    for (const connection of [...this.connections]) connection.close();
    for (const socket of this.sockets) socket.destroy();
    this.outbound.clear();
    if (this.server?.listening) await new Promise<void>(resolve => { this.server!.close(() => resolve()); });
    const advertisement = this.advertisement;
    const owned = this.endpointIdentity;
    if (advertisement && owned) {
      try {
        const [entry, directory] = await Promise.all([lstat(advertisement.endpoint), lstat(path.dirname(advertisement.endpoint))]);
        if (entry.isSocket() && entry.ino === owned.ino && entry.uid === owned.uid && directory.ino === owned.directoryIno && !directory.isSymbolicLink()) await unlink(advertisement.endpoint);
      } catch (error) { if (peerFilesystemErrorCode(error) !== 'ENOENT') throw error; }
    }
    if (this.fallbackDirectory) await rmdir(this.fallbackDirectory).catch(() => {});
  }
}
