import { describe, expect, it } from 'vitest';
import { SessionTransferClient, TransferUnsupportedError, transferRequestId } from '../../src/session/transfer/transfer-client.js';
import type { SessionTransfer } from '../../src/session/transfer/session-transfer.js';

const snapshot: SessionTransfer = {
  version: 1, source: 'cli', sourceSessionId: 'local', title: 'Continue parser work', provider: 'autohandai', model: 'fantail',
  createdAt: '2026-09-10T00:00:01.000Z', repository: null,
  messages: [{ role: 'user', content: 'Continue my parser', createdAt: '2026-09-10T00:00:00.000Z' }, { role: 'assistant', content: 'Parser is ready.', createdAt: '2026-09-10T00:00:01.000Z' }],
};
const identity = { token: 'private-test-token', userId: 'customer', accountId: 'team_customer' };
const origin = { transferId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const receipt = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', accountId: 'team_customer', expiresAt: '2026-09-11T00:00:00.000Z' };

function transport(status = 201) {
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  const request = (async (input: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) as unknown : undefined, headers: init?.headers as Record<string, string> });
    if (status !== 201) return new Response(JSON.stringify({ error: { code: 'invalid_transfer', message: 'Unknown field.' } }), { status });
    return new Response(JSON.stringify({ transfer: receipt }), { status: 201 });
  }) as typeof fetch;
  return { calls, client: new SessionTransferClient(request) };
}

describe('SessionTransferClient.upload with an origin', () => {
  it('changes the request id and carries the origin without ever putting the token in the URL', async () => {
    expect(transferRequestId(snapshot, identity)).not.toBe(transferRequestId(snapshot, identity, origin));
    expect(transferRequestId(snapshot, identity, origin)).toBe(transferRequestId(snapshot, identity, { ...origin }));
    const { calls, client } = transport();
    expect(await client.upload(snapshot, identity, { origin })).toEqual(receipt);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ requestId: transferRequestId(snapshot, identity, origin), origin, snapshot: { source: 'cli' } });
    expect(calls[0].url).toBe('https://dev.autohand.ai/api/transfers');
    expect(calls[0].url).not.toContain(identity.token);
    expect(JSON.stringify(calls[0].body)).not.toContain(identity.token);
    expect(calls[0].headers.Authorization).toBe(`Bearer ${identity.token}`);
  });

  it('omits the origin key entirely when none is given', async () => {
    const { calls, client } = transport();
    await client.upload(snapshot, identity);
    expect(Object.keys(calls[0].body as object)).toEqual(['requestId', 'snapshot']);
  });

  it('maps a rejected body to TransferUnsupportedError so the caller can retry without the origin', async () => {
    const { client } = transport(400);
    await expect(client.upload(snapshot, identity, { origin })).rejects.toBeInstanceOf(TransferUnsupportedError);
    const conflicted = transport(409);
    await expect(conflicted.client.upload(snapshot, identity, { origin })).rejects.not.toBeInstanceOf(TransferUnsupportedError);
  });
});
