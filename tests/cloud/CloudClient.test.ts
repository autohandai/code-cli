import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudClient, CloudRequestError, parseCloudReference } from '../../src/cloud/CloudClient.js';

const id = '11111111-1111-4111-8111-111111111111';
const account = 'personal_fixture';
const identity = { token: 'cloud-test-session-1234567890', userId: 'ada', accountId: account };
const conversation = { id, title: 'Repair parser', model: 'moa', updated_at: '2026-10-12T00:00:00Z' };
const message = { id, role: 'assistant', content: 'Verified parser tests', status: 'complete', request_id: id };
afterEach(() => vi.useRealTimers());

describe('cloud session identity and HTTPS boundary', () => {
  it('accepts only cloud IDs and canonical owned-surface links', () => {
    expect(parseCloudReference(id)).toEqual({ id });
    expect(parseCloudReference(`https://dev.autohand.ai/c/${id}?account=${account}`)).toEqual({ id, accountId: account });
    for (const value of [`https://evil.test/c/${id}`, `https://dev.autohand.ai.evil.test/c/${id}`, `https://user:secret@dev.autohand.ai/c/${id}`, `http://dev.autohand.ai/c/${id}`, `https://dev.autohand.ai/c/${id}?token=secret`, '../outside']) {
      expect(() => parseCloudReference(value)).toThrow();
    }
  });
  it('pins credentials to the hosted origin and sends the selected account without cookies or redirects', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ conversation }));
    const result = await new CloudClient(identity, request).create('Repair parser', 'moa', id);
    expect(result).toEqual(conversation);
    const [url, init] = request.mock.calls[0];
    expect(String(url)).toBe('https://dev.autohand.ai/api/native/cloud/conversations');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${identity.token}`);
    expect(new Headers(init?.headers).get('X-Autohand-Account-Id')).toBe(account);
    expect(new Headers(init?.headers).get('Cookie')).toBeNull();
    expect(JSON.parse(String(init?.body))).toEqual({ title: 'Repair parser', model: 'moa', requestId: id });
    expect(String(url)).not.toContain(identity.token);
  });
  it('queues Enter submissions in the hosted auto approval mode with a stable request ID', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ job: { id, state: 'queued', revision: 0, content: 'Keep the public API' } }));
    await new CloudClient(identity, request).send(id, 'Keep the public API', 'moa', id);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({ content: 'Keep the public API', requestId: id, executionMode: 'auto' });
    expect(request).toHaveBeenCalledOnce();
  });
  it('steers only a selected queued row and preserves its revision guard', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ job: { id, state: 'queued', revision: 2, content: 'Selected correction' } }));
    await new CloudClient(identity, request).steer(id, { id, revision: 1 });
    expect(String(request.mock.calls[0][0]).endsWith(`/conversations/${id}/queue/steer`)).toBe(true);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ jobId: id, revision: 1 });
  });
  it('imports a handoff using the existing transfer response contract', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ conversation, repositoryPending: true, mode: 'new', newMessageCount: 2 }));
    expect(await new CloudClient(identity, request).import(id, 'moa')).toEqual({ conversation, repositoryPending: true });
    expect(String(request.mock.calls[0][0])).toBe(`https://dev.autohand.ai/api/transfers/${id}/import`);
  });
  it('validates server identity and never adopts another account', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ session: { user: { id: 'ada' }, account: { account: { id: 'foreign' } } } }));
    await expect(new CloudClient(identity, request).session()).rejects.toThrow('account');
  });
  it('maps plan and sign-in denials without retrying mutations', async () => {
    for (const status of [401, 402, 403]) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: 'denied', message: 'Cannot continue' } }, { status }));
      await expect(new CloudClient(identity, request).create('Task', 'auto', id)).rejects.toBeInstanceOf(CloudRequestError);
      expect(request).toHaveBeenCalledOnce();
    }
  });
  it('rejects malformed responses and cancels an oversized response body', async () => {
    const invalid = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ conversation: { id: 'foreign' } }));
    await expect(new CloudClient(identity, invalid).create('Task', 'auto', id)).rejects.toThrow();
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(2_100_000)); }, cancel }));
    await expect(new CloudClient(identity, vi.fn<typeof fetch>().mockResolvedValue(response)).detail(id)).rejects.toThrow('size');
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });
});

describe('bounded cloud observation', () => {
  it('reads split UTF-8 and CRLF frames, ignores heartbeats, and releases the reader', async () => {
    const bytes = new TextEncoder().encode(`: keep-alive\r\n\r\ndata: ${JSON.stringify({ type: 'messages', messages: [{ ...message, content: 'Parser ✓' }] })}\r\n\r\n`);
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
    const client = new CloudClient(identity, vi.fn<typeof fetch>().mockResolvedValue(response));
    const events = [];
    for await (const event of client.events(id, new AbortController().signal)) events.push(event);
    expect(events).toEqual([{ type: 'messages', messages: [{ ...message, content: 'Parser ✓' }] }]);
    expect(response.body?.locked).toBe(false);
  });
  it('cancels observation without sending stop or leaving timer resources', async () => {
    vi.useFakeTimers(); const baseline = vi.getTimerCount(), cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'messages', messages: [message] })}\n\n`)); }, cancel }), { headers: { 'Content-Type': 'text/event-stream' } });
    const request = vi.fn<typeof fetch>().mockResolvedValue(response);
    for await (const event of new CloudClient(identity, request).events(id, new AbortController().signal)) { expect(event.type).toBe('messages'); break; }
    expect(cancel).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(baseline);
  });
  it('refuses incomplete and oversized frames and still releases the stream', async () => {
    for (const text of ['data: {"type":"messages"}', 'data: ' + 'x'.repeat(530_000) + '\n\n']) {
      const response = new Response(text, { headers: { 'Content-Type': 'text/event-stream' } });
      const client = new CloudClient(identity, vi.fn<typeof fetch>().mockResolvedValue(response));
      await expect(client.events(id, new AbortController().signal).next()).rejects.toThrow();
      expect(response.body?.locked).toBe(false);
    }
  });
});
