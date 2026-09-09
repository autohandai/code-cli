import { isPeerObject, PeerError, PEER_SCOPES, type PeerScope } from './PeerProtocol.js';

export interface PeerLimits {
  frameBytes: number;
  messageBytes: number;
  inboxMessages: number;
  pendingRequests: number;
  connections: number;
  storageBytes: number;
  ratePerSecond: number;
  rateBurst: number;
  handshakeMs: number;
  acknowledgementMs: number;
  expiryMs: number;
  maxExpiryMs: number;
  retentionMs: number;
  automaticReplies: number;
  directoryPageSize: number;
  publishedRuns: number;
}

export const DEFAULT_PEER_LIMITS: Readonly<PeerLimits> = Object.freeze({
  frameBytes: 65_536, messageBytes: 8_000, inboxMessages: 32, pendingRequests: 32,
  connections: 16, storageBytes: 10 * 1024 * 1024, ratePerSecond: 10, rateBurst: 20,
  handshakeMs: 2_000, acknowledgementMs: 2_000, expiryMs: 600_000, maxExpiryMs: 3_600_000,
  retentionMs: 86_400_000, automaticReplies: 8, directoryPageSize: 50, publishedRuns: 64,
});

export interface PeerCommunicationSettings {
  enabled?: boolean;
  scope?: PeerScope;
  idleBehavior?: 'notify' | 'auto';
  alias?: string;
  coordinationDirectory?: string;
  allowResourceControl?: boolean;
  resourceWaitTimeoutMs?: number;
  limits?: Partial<PeerLimits>;
}

export interface ResolvedPeerCommunicationSettings {
  enabled: boolean;
  scope: PeerScope;
  idleBehavior: 'notify' | 'auto';
  alias?: string;
  coordinationDirectory?: string;
  allowResourceControl: boolean;
  resourceWaitTimeoutMs: number;
  limits: PeerLimits;
}

export function resolvePeerLimits(value?: unknown): PeerLimits {
  if (value === undefined) return { ...DEFAULT_PEER_LIMITS };
  if (!isPeerObject(value)) throw new PeerError('INVALID_PARAMS', 'Communication limits must be an object.');
  const limits = { ...DEFAULT_PEER_LIMITS };
  for (const key of Object.keys(DEFAULT_PEER_LIMITS) as Array<keyof PeerLimits>) {
    const limit = value[key];
    if (limit === undefined) continue;
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit <= 0) throw new PeerError('INVALID_PARAMS', `Communication limit ${key} must be a positive integer.`);
    limits[key] = limit;
  }
  if (limits.messageBytes > limits.frameBytes || limits.expiryMs > limits.maxExpiryMs) throw new PeerError('INVALID_PARAMS', 'Communication message and expiry limits exceed their enclosing limits.');
  return limits;
}

export function resolvePeerCommunicationSettings(config: unknown): ResolvedPeerCommunicationSettings {
  const sessions = isPeerObject(config) && isPeerObject(config.sessions) ? config.sessions : {};
  const raw = sessions.communication;
  if (raw !== undefined && !isPeerObject(raw)) throw new PeerError('INVALID_PARAMS', 'sessions.communication must be an object.');
  const settings = isPeerObject(raw) ? raw : {};
  for (const key of ['enabled', 'allowResourceControl'] as const) {
    if (settings[key] !== undefined && typeof settings[key] !== 'boolean') throw new PeerError('INVALID_PARAMS', `Communication ${key} must be a boolean.`);
  }
  if (settings.scope !== undefined && !PEER_SCOPES.includes(settings.scope as PeerScope)) throw new PeerError('INVALID_PARAMS', 'Communication scope must be workspace, repository or machine.');
  if (settings.idleBehavior !== undefined && settings.idleBehavior !== 'notify' && settings.idleBehavior !== 'auto') throw new PeerError('INVALID_PARAMS', 'Communication idleBehavior must be notify or auto.');
  if (settings.alias !== undefined && (typeof settings.alias !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(settings.alias))) throw new PeerError('INVALID_PARAMS', 'Peer alias must begin with a letter and contain at most 64 letters, digits, dashes or underscores.');
  if (settings.coordinationDirectory !== undefined && (typeof settings.coordinationDirectory !== 'string' || !settings.coordinationDirectory.trim() || settings.coordinationDirectory.includes('\0'))) throw new PeerError('INVALID_PARAMS', 'Communication coordinationDirectory must be a filesystem directory.');
  if (settings.resourceWaitTimeoutMs !== undefined && (typeof settings.resourceWaitTimeoutMs !== 'number' || !Number.isSafeInteger(settings.resourceWaitTimeoutMs) || settings.resourceWaitTimeoutMs <= 0)) throw new PeerError('INVALID_PARAMS', 'Communication resourceWaitTimeoutMs must be a positive integer.');
  return {
    enabled: settings.enabled === true,
    scope: settings.scope as PeerScope | undefined ?? 'workspace',
    idleBehavior: settings.idleBehavior === 'auto' ? 'auto' : 'notify',
    ...(typeof settings.alias === 'string' ? { alias: settings.alias } : {}),
    ...(typeof settings.coordinationDirectory === 'string' ? { coordinationDirectory: settings.coordinationDirectory } : {}),
    allowResourceControl: settings.allowResourceControl === true,
    resourceWaitTimeoutMs: typeof settings.resourceWaitTimeoutMs === 'number' ? settings.resourceWaitTimeoutMs : 300_000,
    limits: resolvePeerLimits(settings.limits),
  };
}
