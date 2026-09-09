import type { Readable, Writable } from 'node:stream';
import { createPublicKey, randomUUID } from 'node:crypto';

export const PEER_PROTOCOL_VERSION = 1;
export type PeerScope = 'workspace' | 'repository' | 'machine';
export type PeerCapability = 'message.send' | 'message.receive' | 'message.wait' | 'resource.request' | 'resource.control';
export type PeerAvailability = 'available' | 'offline' | 'presence_only' | 'unsupported';
export type PeerReceiptState = 'pending' | 'accepted' | 'consumed' | 'replied' | 'rejected' | 'expired' | 'unknown';

export interface PeerDescriptor {
  peerId: string;
  instanceId: string;
  sessionId: string;
  runId?: string;
  alias: string;
  project: string;
  kind: 'root' | 'run';
  activity: string;
  availability: PeerAvailability;
  capabilities: PeerCapability[];
  workspaceId?: string;
  repositoryId?: string;
}

export interface PeerAdvertisement {
  protocol: number;
  instanceId: string;
  endpoint: string;
  publicKey: string;
  capabilities: PeerCapability[];
  peerId?: string;
  alias?: string;
  scope?: PeerScope;
  workspaceId?: string;
  repositoryId?: string;
}

export interface PeerEnvelope {
  version: 1;
  messageId: string;
  from: string;
  senderInstanceId: string;
  senderRunId?: string;
  senderAlias?: string;
  senderProject?: string;
  to: string;
  recipientInstanceId: string;
  recipientRunId?: string;
  content: string;
  topic?: string;
  replyTo?: string;
  correlationId?: string;
  automaticDepth?: number;
  createdAt: string;
  expiresAt: string;
}

export interface PeerMessage extends PeerEnvelope {
  sequence: number;
}

export interface PeerReceipt {
  messageId: string;
  from?: string;
  to: string;
  state: PeerReceiptState;
  cursor: string;
  acceptedAt?: string;
  consumedAt?: string;
  repliedAt?: string;
  outcome?: string;
}

export interface PeerEvent {
  type: 'message' | 'receipt' | 'resource';
  cursor: string;
  messageId?: string;
  from?: string;
  to?: string;
  state?: string;
  resource?: string;
  resourceCursor?: string;
  requestId?: string;
  epoch?: number;
  message?: PeerMessage;
  receipt?: PeerReceipt;
}

export type PeerErrorCode =
  | 'PEER_OFFLINE' | 'TARGET_ENDED' | 'UNKNOWN_TARGET' | 'AMBIGUOUS_TARGET'
  | 'SCOPE_DENIED' | 'CAPABILITY_DENIED' | 'UNSUPPORTED_PROTOCOL' | 'QUEUE_FULL'
  | 'MESSAGE_TOO_LARGE' | 'DELIVERY_UNKNOWN' | 'CONTROLLER_UNAVAILABLE'
  | 'RESOURCE_BUSY' | 'RECOVERY_REQUIRED' | 'INVALID_PARAMS' | 'INVALID_RPC'
  | 'PARSE_ERROR' | 'FRAME_TOO_LARGE' | 'AUTHENTICATION_FAILED' | 'UNSAFE_ENDPOINT'
  | 'COMMUNICATION_DISABLED' | 'MESSAGE_ID_CONFLICT' | 'INVALID_REPLY'
  | 'RATE_LIMITED' | 'STALE_POLICY' | 'REQUEST_ID_CONFLICT' | 'RESERVATION_EXPIRED'
  | 'RESOURCE_WAIT_TIMEOUT' | 'METHOD_NOT_FOUND' | 'AUTOMATIC_REPLY_LIMIT'
  | 'UNSUPPORTED_PLATFORM';

const ERROR_CODES = new Set<string>([
  'PEER_OFFLINE', 'TARGET_ENDED', 'UNKNOWN_TARGET', 'AMBIGUOUS_TARGET', 'SCOPE_DENIED',
  'CAPABILITY_DENIED', 'UNSUPPORTED_PROTOCOL', 'QUEUE_FULL', 'MESSAGE_TOO_LARGE',
  'DELIVERY_UNKNOWN', 'CONTROLLER_UNAVAILABLE', 'RESOURCE_BUSY', 'RECOVERY_REQUIRED',
  'INVALID_PARAMS', 'INVALID_RPC', 'PARSE_ERROR', 'FRAME_TOO_LARGE', 'AUTHENTICATION_FAILED',
  'UNSAFE_ENDPOINT', 'COMMUNICATION_DISABLED', 'MESSAGE_ID_CONFLICT', 'INVALID_REPLY',
  'RATE_LIMITED', 'STALE_POLICY', 'REQUEST_ID_CONFLICT', 'RESERVATION_EXPIRED',
  'RESOURCE_WAIT_TIMEOUT', 'METHOD_NOT_FOUND', 'AUTOMATIC_REPLY_LIMIT', 'UNSUPPORTED_PLATFORM',
]);

export class PeerError extends Error {
  constructor(readonly code: PeerErrorCode, message: string, readonly details?: Record<string, unknown>) {
    super(`${code}: ${message}`);
    this.name = 'PeerError';
  }
}

export function isPeerErrorCode(value: string): value is PeerErrorCode { return ERROR_CODES.has(value); }

export function isPeerObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validatePeerAdvertisement(value: unknown): PeerAdvertisement | undefined {
  if (!isPeerObject(value)
    || !Number.isSafeInteger(value.protocol) || Number(value.protocol) < 1
    || typeof value.instanceId !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(value.instanceId)
    || typeof value.endpoint !== 'string' || value.endpoint.length > 512 || value.endpoint.includes('\0')
    || typeof value.publicKey !== 'string' || value.publicKey.length > 256
    || !Array.isArray(value.capabilities)
    || value.capabilities.length > 16
    || !value.capabilities.every(capability => PEER_CAPABILITIES.includes(capability as PeerCapability))) return undefined;
  if (value.scope !== undefined && !PEER_SCOPES.includes(value.scope as PeerScope)) return undefined;
  if (value.alias !== undefined && (typeof value.alias !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value.alias))) return undefined;
  if (value.protocol === 1) {
    try {
      const bytes = Buffer.from(value.publicKey, 'base64');
      if (bytes.toString('base64') !== value.publicKey || bytes.length !== 44
        || createPublicKey({ key: bytes, type: 'spki', format: 'der' }).asymmetricKeyType !== 'ed25519') return undefined;
    } catch { return undefined; }
  }
  for (const key of ['peerId', 'alias', 'workspaceId', 'repositoryId'] as const) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 4_096)) return undefined;
  }
  return {
    protocol: Number(value.protocol), instanceId: value.instanceId, endpoint: value.endpoint,
    publicKey: value.publicKey, capabilities: [...value.capabilities] as PeerCapability[],
    ...(typeof value.peerId === 'string' ? { peerId: value.peerId } : {}),
    ...(typeof value.alias === 'string' ? { alias: value.alias } : {}),
    ...(typeof value.scope === 'string' ? { scope: value.scope as PeerScope } : {}),
    ...(typeof value.workspaceId === 'string' ? { workspaceId: value.workspaceId } : {}),
    ...(typeof value.repositoryId === 'string' ? { repositoryId: value.repositoryId } : {}),
  };
}

export const PEER_SCOPES: readonly PeerScope[] = ['workspace', 'repository', 'machine'];
export const PEER_CAPABILITIES: readonly PeerCapability[] = ['message.send', 'message.receive', 'message.wait', 'resource.request', 'resource.control'];

type RpcId = string | number | null;
export interface RpcRequest { jsonrpc: '2.0'; id?: RpcId; method: string; params?: Record<string, unknown>; }
export interface RpcSuccess { jsonrpc: '2.0'; id: RpcId; result: unknown; }
export interface RpcFailure { jsonrpc: '2.0'; id: RpcId; error: { code: number; message: string; data?: unknown }; }
export type RpcFrame = RpcRequest | RpcSuccess | RpcFailure;

function isRpcId(value: unknown): value is RpcId {
  return value === null || typeof value === 'string' && value.length <= 256 || typeof value === 'number' && Number.isSafeInteger(value);
}

export function decodeRpcFrame(bytes: Uint8Array): RpcFrame {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    throw new PeerError('PARSE_ERROR', error instanceof TypeError ? 'Invalid UTF-8 encoding.' : 'Invalid JSON.');
  }
  if (!isPeerObject(value) || value.jsonrpc !== '2.0') throw new PeerError('INVALID_RPC', 'Expected a JSON-RPC 2.0 object.');
  if (Object.hasOwn(value, 'id') && !isRpcId(value.id)) throw new PeerError('INVALID_RPC', 'Invalid request ID.');
  if (typeof value.method === 'string' && value.method.length > 0 && value.method.length <= 128
    && !Object.hasOwn(value, 'result') && !Object.hasOwn(value, 'error')) {
    if (value.params !== undefined && !isPeerObject(value.params)) throw new PeerError('INVALID_RPC', 'Parameters must be an object.');
    return { jsonrpc: '2.0', ...(Object.hasOwn(value, 'id') ? { id: value.id as RpcId } : {}), method: value.method, ...(isPeerObject(value.params) ? { params: value.params } : {}) };
  }
  if (Object.hasOwn(value, 'method') || !Object.hasOwn(value, 'id')) throw new PeerError('INVALID_RPC', 'Invalid response.');
  if (Object.hasOwn(value, 'result') && !Object.hasOwn(value, 'error')) return { jsonrpc: '2.0', id: value.id as RpcId, result: value.result };
  if (!Object.hasOwn(value, 'result') && isPeerObject(value.error)
    && Number.isSafeInteger(value.error.code) && typeof value.error.message === 'string') {
    return { jsonrpc: '2.0', id: value.id as RpcId, error: { code: Number(value.error.code), message: value.error.message, ...(Object.hasOwn(value.error, 'data') ? { data: value.error.data } : {}) } };
  }
  throw new PeerError('INVALID_RPC', 'Expected exactly one result or structured error.');
}

export class PeerFrameDecoder {
  private parts: Buffer[] = [];
  private bytes = 0;
  private failed = false;
  private readonly maxFrameBytes: number;

  constructor(options: { maxFrameBytes?: number } = {}) { this.maxFrameBytes = options.maxFrameBytes ?? 65_536; }
  get bufferedBytes(): number { return this.bytes; }

  push(chunk: Buffer): RpcFrame[] {
    if (this.failed) throw new PeerError('INVALID_RPC', 'Decoder is closed after a malformed frame.');
    const frames: RpcFrame[] = [];
    let offset = 0;
    try {
      while (offset < chunk.length) {
        const newline = chunk.indexOf(10, offset);
        const end = newline === -1 ? chunk.length : newline;
        const length = end - offset;
        if (this.bytes + length > this.maxFrameBytes) throw new PeerError('FRAME_TOO_LARGE', `Frame exceeds ${this.maxFrameBytes} bytes.`);
        if (length > 0) { this.parts.push(Buffer.from(chunk.subarray(offset, end))); this.bytes += length; }
        if (newline === -1) break;
        if (this.bytes > 0) frames.push(decodeRpcFrame(Buffer.concat(this.parts, this.bytes)));
        this.parts = [];
        this.bytes = 0;
        offset = newline + 1;
      }
    } catch (error) {
      this.failed = true;
      this.parts = [];
      this.bytes = 0;
      throw error;
    }
    return frames;
  }
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface RpcConnectionOptions {
  readable: Readable;
  writable: Writable;
  requestTimeoutMs?: number;
  maxPending?: number;
  maxFrameBytes?: number;
  onRequest?: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  onNotification?: (method: string, params: Record<string, unknown>) => Promise<void> | void;
  onClose?: () => void;
}

export class RpcConnection {
  private readonly pending = new Map<RpcId, PendingRequest>();
  private readonly decoder: PeerFrameDecoder;
  private closed = false;
  private writeChain = Promise.resolve();
  private incoming = 0;
  private queuedWrites = 0;
  private lastActivity = Date.now();
  private readonly closeListeners = new Set<() => void>();

  constructor(private readonly options: RpcConnectionOptions) {
    this.decoder = new PeerFrameDecoder({ maxFrameBytes: options.maxFrameBytes });
    options.readable.on('data', this.onData);
    options.readable.once('end', this.onDisconnected);
    options.readable.once('close', this.onDisconnected);
    options.readable.once('error', this.onDisconnected);
    options.writable.once('error', this.onDisconnected);
    options.writable.once('close', this.onDisconnected);
  }

  get pendingCount(): number { return this.pending.size; }
  get isClosed(): boolean { return this.closed; }
  get isIdle(): boolean { return this.pending.size === 0 && this.incoming === 0 && this.queuedWrites === 0; }
  get lastUsedAt(): number { return this.lastActivity; }

  request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (this.closed) return Promise.reject(new PeerError('DELIVERY_UNKNOWN', 'The peer connection is closed; query the original message ID before retrying.'));
    if (this.pending.size >= (this.options.maxPending ?? 32)) return Promise.reject(new PeerError('QUEUE_FULL', 'Too many in-flight peer requests.'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new PeerError('DELIVERY_UNKNOWN', 'No acknowledgement arrived before the deadline; query the original message ID.'));
      }, this.options.requestTimeoutMs ?? 2_000);
      this.pending.set(id, { resolve, reject, timer });
      void this.write({ jsonrpc: '2.0', id, method, params }).catch(error => this.rejectPending(id, error));
    });
  }

  notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
    return this.write({ jsonrpc: '2.0', method, params });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const error = new PeerError('DELIVERY_UNKNOWN', 'Peer disconnected; delivery may have been accepted.');
    for (const id of this.pending.keys()) this.rejectPending(id, error);
    for (const listener of this.closeListeners) listener();
    this.closeListeners.clear();
    this.options.readable.off('data', this.onData);
    this.options.readable.destroy();
    if (!this.options.writable.destroyed) this.options.writable.destroy();
    this.options.onClose?.();
  }

  private readonly onDisconnected = (): void => { this.close(); };
  private readonly onData = (chunk: Buffer | string): void => {
    this.lastActivity = Date.now();
    try {
      for (const frame of this.decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))) void this.dispatch(frame);
    } catch (error) {
      void this.write(this.failure(null, error)).finally(() => this.close()).catch(() => {});
    }
  };

  private rejectPending(id: RpcId, error: unknown): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.reject(error instanceof Error ? error : new Error(String(error)));
  }

  private async dispatch(frame: RpcFrame): Promise<void> {
    if (!('method' in frame)) {
      const waiter = this.pending.get(frame.id);
      if (!waiter) return;
      this.pending.delete(frame.id);
      clearTimeout(waiter.timer);
      if ('result' in frame) waiter.resolve(frame.result);
      else {
        const data = isPeerObject(frame.error.data) ? frame.error.data : {};
        const code = typeof data.code === 'string' && ERROR_CODES.has(data.code) ? data.code as PeerErrorCode : 'INVALID_RPC';
        waiter.reject(new PeerError(code, frame.error.message, data));
      }
      return;
    }
    if (this.incoming >= (this.options.maxPending ?? 32)) {
      if (frame.id !== undefined) await this.write(this.failure(frame.id, new PeerError('QUEUE_FULL', 'Too many incoming requests.'))).catch(() => {});
      return;
    }
    this.incoming++;
    try {
      if (frame.id === undefined) await this.options.onNotification?.(frame.method, frame.params ?? {});
      else {
        if (!this.options.onRequest) throw new PeerError('METHOD_NOT_FOUND', `Unsupported method ${frame.method}.`);
        const result = await this.options.onRequest(frame.method, frame.params ?? {});
        await this.write({ jsonrpc: '2.0', id: frame.id, result: result ?? null });
      }
    } catch (error) {
      if (frame.id !== undefined) await this.write(this.failure(frame.id, error)).catch(() => {});
    } finally { this.incoming--; }
  }

  private failure(id: RpcId, error: unknown): RpcFailure {
    const peerError = error instanceof PeerError ? error : new PeerError('INVALID_RPC', error instanceof Error ? error.message : 'Peer request failed.');
    const code = peerError.code === 'PARSE_ERROR' ? -32700 : peerError.code === 'METHOD_NOT_FOUND' ? -32601 : peerError.code === 'INVALID_PARAMS' ? -32602 : -32000;
    return { jsonrpc: '2.0', id, error: { code, message: peerError.message, data: { ...peerError.details, code: peerError.code } } };
  }

  private write(frame: RpcFrame): Promise<void> {
    if (this.closed) return Promise.reject(new PeerError('DELIVERY_UNKNOWN', 'Connection closed before writing.'));
    if (this.queuedWrites >= (this.options.maxPending ?? 32) * 2) return Promise.reject(new PeerError('QUEUE_FULL', 'The peer output queue is full.'));
    let bytes: Buffer;
    try { bytes = Buffer.from(`${JSON.stringify(frame)}\n`); }
    catch { return Promise.reject(new PeerError('INVALID_PARAMS', 'RPC parameters must be JSON serializable.')); }
    if (bytes.length - 1 > (this.options.maxFrameBytes ?? 65_536)) return Promise.reject(new PeerError('FRAME_TOO_LARGE', 'Serialized request exceeds the frame limit.'));
    this.queuedWrites++;
    const write = this.writeChain.then(async () => {
      if (this.closed) throw new PeerError('DELIVERY_UNKNOWN', 'Connection closed before writing.');
      this.lastActivity = Date.now();
      if (!this.options.writable.write(bytes)) {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => { this.options.writable.off('drain', drained); this.closeListeners.delete(disconnected); };
          const drained = () => { cleanup(); resolve(); };
          const disconnected = () => { cleanup(); reject(new PeerError('DELIVERY_UNKNOWN', 'Disconnected while waiting for stream drain.')); };
          this.options.writable.once('drain', drained);
          this.closeListeners.add(disconnected);
          if (this.closed) disconnected();
        });
      }
    }).finally(() => { this.queuedWrites--; });
    this.writeChain = write.catch(() => {});
    return write;
  }
}
