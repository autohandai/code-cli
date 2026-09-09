import { PeerError, type PeerDescriptor, type PeerScope } from '../session/peers/PeerProtocol.js';

export interface PeerMention { alias: string; start: number; end: number; }
export interface PeerMentionMatch { query: string; start: number; end: number; }
export interface PeerReference extends PeerMention { peerId: string; instanceId: string; runId?: string; }
export interface PeerInstructionMetadata { peerReferences: PeerReference[]; peerReplyTo?: string; peerScope?: PeerScope; }
export interface PeerComposerDraft { reference: PeerReference; replyTo?: string; text?: string; scope?: PeerScope; }
export type ParsedPeerInput = { kind: 'direct'; alias: string; content: string; reference: PeerMention }
  | { kind: 'instruction'; text: string; references: PeerMention[] };
export type ResolvedPeerInput = { kind: 'direct'; to: string; content: string; reference: PeerReference }
  | { kind: 'instruction'; text: string; references: PeerReference[] };

export function isPeerReference(value: unknown): value is PeerReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const reference = value as Record<string, unknown>;
  const id = (candidate: unknown): candidate is string => typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 256 && !/[\x00-\x1f\x7f]/.test(candidate);
  return typeof reference.alias === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(reference.alias)
    && typeof reference.start === 'number' && Number.isSafeInteger(reference.start) && reference.start >= 0
    && reference.end === reference.start + reference.alias.length + 1
    && id(reference.peerId) && id(reference.instanceId) && (reference.runId === undefined || id(reference.runId));
}

function mentions(text: string, includeBare = false): PeerMention[] {
  if (/^\s*[!/]/.test(text) || text.includes('\x1b[200~') || text.includes('\x1b[201~')) return [];
  const found: PeerMention[] = [];
  let span = 0;
  let fence: { marker: string; count: number } | undefined;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    const lineStart = text.lastIndexOf('\n', index - 1) + 1;
    if ((character === '`' || character === '~') && /^ {0,3}$/.test(text.slice(lineStart, index))) {
      let end = index;
      while (text[end] === character) end++;
      const count = end - index;
      if (count >= 3 && !span) {
        if (!fence) fence = { marker: character, count };
        else if (fence.marker === character && count >= fence.count) fence = undefined;
        index = end - 1;
        continue;
      }
    }
    if (fence) continue;
    if (character === '\\') { index++; continue; }
    if (character === '`') {
      let end = index;
      while (text[end] === '`') end++;
      const count = end - index;
      if (span === count) span = 0;
      else if (!span) span = count;
      index = end - 1;
      continue;
    }
    if (span || character !== ':' || index > 0 && !/[\s([{]/.test(text[index - 1])) continue;
    const match = /^[A-Za-z][A-Za-z0-9_-]{0,63}/.exec(text.slice(index + 1));
    const alias = match?.[0] ?? '';
    const end = index + 1 + alias.length;
    if ((!alias && (!includeBare || end !== text.length)) || text[end] === ':' || /[A-Za-z0-9_-]/.test(text[end] ?? '')) continue;
    found.push({ alias, start: index, end });
    index = end - 1;
  }
  return found;
}

export function matchPeerMention(text: string, cursor = text.length): PeerMentionMatch | null {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > text.length) return null;
  const reference = mentions(text, true).find(mention => mention.start < cursor && mention.end >= cursor);
  if (!reference) return null;
  return { query: text.slice(reference.start + 1, cursor), start: reference.start, end: reference.end };
}

export function bindPeerReference(text: string, match: PeerMentionMatch, peer: PeerDescriptor): { text: string; cursor: number; binding: PeerReference } {
  const token = `:${peer.alias}`;
  const tail = text.slice(match.end);
  const separator = tail.startsWith(' ') ? '' : ' ';
  const completed = `${text.slice(0, match.start)}${token}${separator}${tail}`;
  return { text: completed, cursor: match.start + token.length + 1, binding: { start: match.start, end: match.start + token.length, alias: peer.alias, peerId: peer.peerId, instanceId: peer.instanceId, ...(peer.runId ? { runId: peer.runId } : {}) } };
}

export function parsePeerInput(text: string): ParsedPeerInput {
  const references = mentions(text);
  const first = references[0];
  if (first && !text.includes('\n') && !text.includes('\r') && !text.slice(0, first.start).trim()
    && /^\s+\S/.test(text.slice(first.end))) return { kind: 'direct', alias: first.alias, content: text.slice(first.end).trim(), reference: first };
  return { kind: 'instruction', text, references };
}

export function resolvePeerInput(text: string, bindings: readonly PeerReference[], peers: readonly PeerDescriptor[]): ResolvedPeerInput {
  const parsed = parsePeerInput(text);
  const resolve = (mention: PeerMention): PeerReference => {
    const binding = bindings.find(candidate => candidate.alias === mention.alias && candidate.start === mention.start)
      ?? bindings.find(candidate => candidate.alias === mention.alias);
    const candidates = binding ? peers.filter(peer => peer.peerId === binding.peerId && peer.instanceId === binding.instanceId && peer.runId === binding.runId)
      : peers.filter(peer => peer.alias === mention.alias);
    if (candidates.length > 1) throw new PeerError('AMBIGUOUS_TARGET', `The alias :${mention.alias} is ambiguous. Select a particular peer.`);
    const peer = candidates[0];
    if (!peer || peer.availability === 'offline') throw new PeerError('PEER_OFFLINE', `:${mention.alias} is offline or its incarnation changed. Reselect the recipient.`);
    if (peer.availability !== 'available' || !peer.capabilities.includes('message.receive')) throw new PeerError('CAPABILITY_DENIED', `:${mention.alias} has no available message inbox.`);
    return { ...mention, peerId: peer.peerId, instanceId: peer.instanceId, ...(peer.runId ? { runId: peer.runId } : {}) };
  };
  if (parsed.kind === 'direct') { const reference = resolve(parsed.reference); return { kind: 'direct', to: reference.peerId, content: parsed.content, reference }; }
  return { ...parsed, references: parsed.references.map(resolve) };
}
