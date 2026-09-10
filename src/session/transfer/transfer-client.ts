import { createHash } from 'node:crypto';
import { isRecord } from './record.js';
import { parseSessionTransfer, parseTransferReceipt, TRANSFER_MAX_BYTES, TRANSFER_ORIGIN, type SessionTransfer, type TransferReceipt } from './session-transfer.js';

export interface TransferIdentity { token: string; userId: string; accountId?: string }
export interface ReceivedTransfer { transfer: TransferReceipt; snapshot: SessionTransfer }
/** The Web export this snapshot continues, so the push returns to its original conversation. */
export interface TransferOrigin { transferId: string }

/** A Web deployment that predates resumable handoff rejects `origin`; the caller retries without it. */
export class TransferUnsupportedError extends Error {
  constructor(message = 'This Autohand Web version cannot resume the original conversation.') {
    super(message);
    this.name = 'TransferUnsupportedError';
  }
}

/** A rejected transfer request, carrying the server's own status and error code. */
export class TransferRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message);
    this.name = 'TransferRequestError';
  }
}

/** Origin rejections the server raises when the exported prefix no longer matches. */
const ORIGIN_REJECTION_CODES = new Set(['handoff_origin_unavailable', 'handoff_truncated', 'handoff_diverged']);

/** Every rejection that only invalidates the return trip; the snapshot itself is still pushable. */
export function isOriginRejection(error: unknown): boolean {
  return error instanceof TransferUnsupportedError ||
    (error instanceof TransferRequestError && error.status === 409 && ORIGIN_REJECTION_CODES.has(error.code ?? ''));
}

/** A divergence needs its own note: the Web conversation moved on, the CLI build is fine. */
export function isDivergedOrigin(error: unknown): boolean {
  return error instanceof TransferRequestError && (error.code === 'handoff_diverged' || error.code === 'handoff_truncated');
}

/** Error bodies from the fixed Web origin are tiny; read a bounded prefix and never block on more. */
async function readErrorBody(response: Response): Promise<string> {
  if (!response.body) { return ''; }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < 4096) {
      const chunk: unknown = await reader.read();
      if (!isRecord(chunk) || chunk.done === true) { break; }
      if (chunk.value instanceof Uint8Array) { text += decoder.decode(chunk.value, { stream: true }); }
    }
    return text.slice(0, 4096);
  } catch {
    return '';
  } finally {
    try { await reader.cancel(); } catch { /* the stream is already finished */ }
  }
}

const GENERIC_TRANSFER_ERROR = 'Autohand Web could not complete the transfer. Your original conversation is still available. Try again.';

/** Map a rejection to the message a person reads, keeping the server's code for the caller. */
async function transferRequestError(response: Response): Promise<TransferRequestError> {
  let code: string | null = null;
  let detail = '';
  try {
    const parsed: unknown = JSON.parse(await readErrorBody(response));
    if (isRecord(parsed) && isRecord(parsed.error)) {
      if (typeof parsed.error.code === 'string') { code = parsed.error.code; }
      if (typeof parsed.error.message === 'string') { detail = parsed.error.message.slice(0, 400); }
    }
  } catch { /* a non-JSON body carries no code */ }
  const status = response.status;
  if (status === 401) { return new TransferRequestError('Sign in to Autohand to transfer this conversation.', status, code); }
  if (status === 403 || status === 404) { return new TransferRequestError('This transfer is unavailable in the selected Autohand account.', status, code); }
  if (status === 410) { return new TransferRequestError('This transfer expired or was revoked. Start a new transfer from the source.', status, code); }
  if (status === 400 || status === 409 || status === 413) { return new TransferRequestError(detail || GENERIC_TRANSFER_ERROR, status, code); }
  return new TransferRequestError(GENERIC_TRANSFER_ERROR, status, code);
}

/** Stable request identity lets a failed upload resume without creating another transfer. */
export function transferRequestId(snapshot: SessionTransfer, identity: Pick<TransferIdentity, 'userId' | 'accountId'>, origin?: TransferOrigin): string {
  const hex = createHash('sha256').update(JSON.stringify([identity.userId, identity.accountId ?? '', parseSessionTransfer(snapshot), origin ?? null])).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Native transfer API. Credentials are scoped to the fixed Web origin and never enter links. */
export class SessionTransferClient {
  constructor(private readonly request: typeof fetch = fetch) {}

  async upload(snapshot: SessionTransfer, identity: TransferIdentity, options: { origin?: TransferOrigin } = {}): Promise<TransferReceipt> {
    const value = parseSessionTransfer(snapshot);
    const origin = options.origin;
    let result: unknown;
    try {
      result = await this.call('/api/transfers', identity, 'POST', { requestId: transferRequestId(value, identity, origin), snapshot: value, ...(origin ? { origin } : {}) });
    } catch (error) {
      // Only an upload that actually sent `origin` may read a 400 as "this Web build has no resume".
      if (origin && error instanceof TransferRequestError && error.status === 400) { throw new TransferUnsupportedError(); }
      throw error;
    }
    if (!isRecord(result)) { throw new Error('Autohand Web returned an invalid transfer receipt.'); }
    const receipt = parseTransferReceipt(result.transfer);
    if (identity.accountId && receipt.accountId !== identity.accountId) { throw new Error('The transfer account changed. Try again.'); }
    return receipt;
  }

  async download(id: string, identity: TransferIdentity): Promise<ReceivedTransfer> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) { throw new Error('Invalid transfer ID.'); }
    const result = await this.call(`/api/transfers/${id}`, identity, 'GET');
    if (!isRecord(result)) { throw new Error('Autohand Web returned an invalid session transfer.'); }
    const transfer = parseTransferReceipt(result.transfer);
    if (transfer.id !== id || (identity.accountId && transfer.accountId !== identity.accountId)) { throw new Error('The transfer account or session changed. Try again.'); }
    return { transfer, snapshot: parseSessionTransfer(result.snapshot) };
  }

  private async call(path: string, identity: TransferIdentity, method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
    if (!identity.token || !identity.userId) { throw new Error('Sign in to Autohand to transfer this conversation.'); }
    const headers: Record<string, string> = { Authorization: `Bearer ${identity.token}`, Accept: 'application/json' };
    if (identity.accountId) { headers['X-Autohand-Account-Id'] = identity.accountId; }
    if (body) { headers['Content-Type'] = 'application/json'; }
    const response = await this.request(new URL(path, TRANSFER_ORIGIN), {
      method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
    // Status alone never decides the downgrade: only an origin-bearing upload reads a 400 that way.
    if (!response.ok) { throw await transferRequestError(response); }
    if (!response.body) { throw new Error('Autohand Web returned an empty transfer.'); }
    const reader = response.body.getReader();
    const decoder = new TextDecoder(); let bytes = 0; let content = '';
    try {
      while (true) {
        const chunk: unknown = await reader.read();
        if (!isRecord(chunk)) { throw new Error('Invalid transfer response stream.'); }
        if (chunk.done === true) { break; }
        const value = chunk.value;
        if (!(value instanceof Uint8Array)) { throw new Error('Invalid transfer response data.'); }
        bytes += value.byteLength;
        if (bytes > TRANSFER_MAX_BYTES + 2048) { await reader.cancel(); throw new Error('This session transfer exceeds the supported size.'); }
        content += decoder.decode(value, { stream: true });
      }
      content += decoder.decode();
      return JSON.parse(content) as unknown;
    } finally { reader.releaseLock(); }
  }
}
