import { createHash } from 'node:crypto';
import { isRecord } from './record.js';
import { parseSessionTransfer, parseTransferReceipt, TRANSFER_MAX_BYTES, TRANSFER_ORIGIN, type SessionTransfer, type TransferReceipt } from './session-transfer.js';

export interface TransferIdentity { token: string; userId: string; accountId?: string }
export interface ReceivedTransfer { transfer: TransferReceipt; snapshot: SessionTransfer }

/** Stable request identity lets a failed upload resume without creating another transfer. */
export function transferRequestId(snapshot: SessionTransfer, identity: Pick<TransferIdentity, 'userId' | 'accountId'>): string {
  const hex = createHash('sha256').update(JSON.stringify([identity.userId, identity.accountId ?? '', parseSessionTransfer(snapshot)])).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Native transfer API. Credentials are scoped to the fixed Web origin and never enter links. */
export class SessionTransferClient {
  constructor(private readonly request: typeof fetch = fetch) {}

  async upload(snapshot: SessionTransfer, identity: TransferIdentity): Promise<TransferReceipt> {
    const value = parseSessionTransfer(snapshot);
    const result = await this.call('/api/transfers', identity, 'POST', { requestId: transferRequestId(value, identity), snapshot: value });
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
    if (!response.ok) {
      if (response.status === 401) { throw new Error('Sign in to Autohand to transfer this conversation.'); }
      if (response.status === 403 || response.status === 404) { throw new Error('This transfer is unavailable in the selected Autohand account.'); }
      if (response.status === 410) { throw new Error('This transfer expired or was revoked. Start a new transfer from the source.'); }
      throw new Error('Autohand Web could not complete the transfer. Your original conversation is still available. Try again.');
    }
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
