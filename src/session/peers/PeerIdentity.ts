import { createPublicKey, generateKeyPairSync, randomUUID, sign, verify, type KeyObject } from 'node:crypto';
import { PeerError } from './PeerProtocol.js';

export interface PeerTransportIdentity {
  instanceId: string;
  publicKey: string;
  privateKey: KeyObject;
}

export interface HandshakeFields {
  protocol: number;
  role: 'client' | 'server';
  clientInstanceId: string;
  serverInstanceId: string;
  clientPublicKey: string;
  serverPublicKey: string;
  clientNonce: string;
  serverNonce: string;
}

export function createTransportIdentity(): PeerTransportIdentity {
  const keys = generateKeyPairSync('ed25519');
  return { instanceId: randomUUID(), publicKey: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), privateKey: keys.privateKey };
}

export function isHandshakeNonce(value: unknown): value is string {
  return typeof value === 'string' && value.length === 44 && Buffer.from(value, 'base64').length === 32 && Buffer.from(value, 'base64').toString('base64') === value;
}

export function createHandshakeTranscript(fields: HandshakeFields): Buffer {
  if (!isHandshakeNonce(fields.clientNonce) || !isHandshakeNonce(fields.serverNonce)) throw new PeerError('AUTHENTICATION_FAILED', 'Challenges must contain 32 fresh bytes.');
  const values = [
    'autohand.local-peers.handshake.v1', String(fields.protocol), fields.role,
    fields.clientInstanceId, fields.serverInstanceId, fields.clientPublicKey, fields.serverPublicKey,
    fields.clientNonce, fields.serverNonce,
  ];
  const parts: Buffer[] = [];
  for (const value of values) {
    const bytes = Buffer.from(value, 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    parts.push(length, bytes);
  }
  return Buffer.concat(parts);
}

export function signHandshake(identity: PeerTransportIdentity, transcript: Buffer): string {
  return sign(null, transcript, identity.privateKey).toString('base64');
}

export function verifyHandshake(publicKey: string, transcript: Buffer, proof: string): boolean {
  try {
    if (proof.length !== 88 || Buffer.from(proof, 'base64').length !== 64 || Buffer.from(proof, 'base64').toString('base64') !== proof) return false;
    const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), type: 'spki', format: 'der' });
    return key.asymmetricKeyType === 'ed25519' && verify(null, transcript, key, Buffer.from(proof, 'base64'));
  } catch { return false; }
}
