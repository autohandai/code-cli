/** Versioned, credential-free conversation snapshot shared by desktop and Web clients. */
export const TRANSFER_VERSION = 2;
export const TRANSFER_MAX_BYTES = 8 * 1024 * 1024;
export const TRANSFER_ORIGIN = 'https://dev.autohand.ai';
export const TRANSFER_MAX_IMAGE_BYTES = 1_000_000;
export const TRANSFER_MAX_IMAGES = 4;

export type TransferClient = 'vscode' | 'web' | 'cli';
export interface TransferImage { name: string; data: string }
export interface TransferMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  images?: TransferImage[];
}
export interface TransferRepository {
  url: string;
  branch: string;
  revision: string;
  /** A Git binary patch against revision, including explicitly selected new files. */
  patch: string;
}
export interface SessionTransfer {
  version: 1 | 2;
  source: TransferClient;
  sourceSessionId: string;
  title: string;
  createdAt: string;
  provider: string;
  model: string;
  messages: TransferMessage[];
  repository: TransferRepository | null;
}
export interface TransferReceipt {
  id: string;
  accountId: string;
  expiresAt: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function fields(value: unknown, allowed: string[], label: string): Record<string, unknown> {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}
function text(value: unknown, max: number, label: string, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || value.includes('\0')) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}
function timestamp(value: unknown): string {
  const result = text(value, 40, 'transfer timestamp');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(result) || !Number.isFinite(Date.parse(result))) {
    throw new Error('Invalid transfer timestamp.');
  }
  return result;
}

/** Accept embedded raster bytes only; importing a transcript never fetches an image URL. */
export function decodeTransferImage(data: string): { bytes: Uint8Array; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' } {
  if (data.length > 1_340_000) { throw new Error('Transferred images must be at most 1 MB each.'); }
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match || match[2]!.length % 4 !== 0) { throw new Error('Transfer an embedded PNG, JPEG, WebP, or GIF image.'); }
  const binary = atob(match[2]!);
  if (!binary.length || binary.length > TRANSFER_MAX_IMAGE_BYTES || btoa(binary) !== match[2]) { throw new Error('Invalid or oversized transferred image.'); }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const mediaType = match[1] as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  const valid = mediaType === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
    : mediaType === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : mediaType === 'image/webp' ? binary.slice(0, 4) === 'RIFF' && binary.slice(8, 12) === 'WEBP'
    : ['GIF87a', 'GIF89a'].includes(binary.slice(0, 6));
  if (!valid) { throw new Error('The transferred image does not match its media type.'); }
  return { bytes, mediaType };
}

function transferImage(value: unknown): TransferImage {
  const input = fields(value, ['name', 'data'], 'transferred image');
  const name = text(input.name, 200, 'image name'), data = text(input.data, 1_340_000, 'image data');
  decodeTransferImage(data);
  return { name, data };
}

/** Preserve the CLI's text and embedded image content without interpreting other structured blocks. */
export function parseTransferContent(value: unknown, names?: unknown): Pick<TransferMessage, 'content' | 'images'> {
  if (typeof value === 'string') { return { content: value }; }
  if (!Array.isArray(value)) { throw new Error('This structured message cannot be transferred yet.'); }
  const textParts: string[] = [], images: TransferImage[] = [];
  for (const part of value) {
    if (!record(part)) { throw new Error('Invalid structured message.'); }
    if (part.type === 'text' && typeof part.text === 'string') { textParts.push(part.text); }
    else if (part.type === 'image_url' && record(part.image_url) && typeof part.image_url.url === 'string') {
      const name: unknown = Array.isArray(names) ? names[images.length] : undefined;
      images.push(transferImage({ name: name ?? `Image ${images.length + 1}`, data: part.image_url.url }));
    } else { throw new Error('This structured message cannot be transferred yet.'); }
  }
  if (images.length > TRANSFER_MAX_IMAGES) { throw new Error('Transfer at most four images per message.'); }
  return { content: textParts.join('\n'), ...(images.length ? { images } : {}) };
}

/** Restore model-readable image parts in the durable native session. */
export function transferMessageContent(message: TransferMessage): string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> {
  if (!message.images?.length) { return message.content; }
  return [...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
    ...message.images.map(image => ({ type: 'image_url' as const, image_url: { url: image.data } }))];
}

/** Only a public repository identifier crosses clients, never a credential-bearing remote. */
export function publicRepositoryUrl(remote: string): string {
  const normalized = remote.trim().replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '');
  let url: URL;
  try { url = new URL(normalized); } catch { throw new Error('Choose a GitHub repository to transfer this workspace.'); }
  if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash ||
      !/^\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]+$/.test(url.pathname) || ['.', '..'].includes(url.pathname.split('/')[2] ?? '')) {
    throw new Error('Choose a GitHub repository without embedded credentials.');
  }
  return url.origin + url.pathname;
}

/** Validate without truncation: a partial transcript must never be presented as a complete handoff. */
export function parseSessionTransfer(value: unknown): SessionTransfer {
  const input = fields(value, ['version', 'source', 'sourceSessionId', 'title', 'createdAt', 'provider', 'model', 'messages', 'repository'], 'session transfer');
  if ((input.version !== 1 && input.version !== TRANSFER_VERSION) || !['vscode', 'web', 'cli'].includes(String(input.source))) {
    throw new Error('This session transfer uses an unsupported format.');
  }
  if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > 500) {
    throw new Error('Transfer between 1 and 500 saved messages.');
  }
  const messages = input.messages.map((value): TransferMessage => {
    const message = fields(value, input.version === 1 ? ['role', 'content', 'createdAt'] : ['role', 'content', 'createdAt', 'images'], 'transferred message');
    if (message.role !== 'user' && message.role !== 'assistant') { throw new Error('Transfer only user and assistant conversation messages.'); }
    if (message.images !== undefined && (!Array.isArray(message.images) || message.images.length > TRANSFER_MAX_IMAGES)) { throw new Error('Transfer at most four images per message.'); }
    const images = Array.isArray(message.images) ? message.images.map(transferImage) : undefined;
    return { role: message.role, content: text(message.content, 120_000, 'message content', true), createdAt: timestamp(message.createdAt), ...(images ? { images } : {}) };
  });
  let repository: TransferRepository | null = null;
  if (input.repository !== null) {
    const source = fields(input.repository, ['url', 'branch', 'revision', 'patch'], 'transfer repository');
    const branch = text(source.branch, 200, 'repository branch');
    if (branch.startsWith('-') || [...branch].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || '~^:?*[\\'.includes(character)) || branch.includes('..') || branch.includes('@{')) {
      throw new Error('Invalid repository branch.');
    }
    const revision = text(source.revision, 64, 'repository revision');
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(revision)) { throw new Error('Invalid repository revision.'); }
    repository = { url: publicRepositoryUrl(text(source.url, 500, 'repository URL')), branch, revision, patch: text(source.patch, TRANSFER_MAX_BYTES, 'workspace patch', true) };
  }
  const result: SessionTransfer = {
    version: input.version, source: input.source as TransferClient,
    sourceSessionId: text(input.sourceSessionId, 200, 'source session'), title: text(input.title, 120, 'conversation title'),
    createdAt: timestamp(input.createdAt), provider: text(input.provider, 100, 'provider'), model: text(input.model, 256, 'model'), messages, repository,
  };
  if (new TextEncoder().encode(JSON.stringify(result)).length > TRANSFER_MAX_BYTES) { throw new Error('This transfer exceeds the 8 MB limit.'); }
  return result;
}

export function parseTransferReceipt(value: unknown): TransferReceipt {
  const result = fields(value, ['id', 'accountId', 'expiresAt'], 'transfer receipt');
  const id = text(result.id, 36, 'transfer ID');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) { throw new Error('Invalid transfer ID.'); }
  return { id, accountId: text(result.accountId, 200, 'transfer account'), expiresAt: timestamp(result.expiresAt) };
}

/** Only an opaque ID and an account selector enter the browser URL. */
export function transferWebUrl(receipt: TransferReceipt): string {
  const value = parseTransferReceipt(receipt);
  const url = new URL('/new', TRANSFER_ORIGIN);
  url.searchParams.set('transfer', value.id);
  url.searchParams.set('account', value.accountId);
  return url.toString();
}
