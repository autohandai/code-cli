import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { discardResponseBody } from '../utils/responseBody.js';
import { TRANSFER_ORIGIN, parseTransferReceipt } from '../session/transfer/session-transfer.js';
import type { TransferIdentity } from '../session/transfer/transfer-client.js';

const uuid = z.string().uuid();
const accountId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
export const cloudConversationSchema = z.object({ id: uuid, title: z.string().max(120), model: z.string().min(1).max(120), updated_at: z.string().max(80) });
export const cloudMessageSchema = z.object({ id: uuid, role: z.enum(['user', 'assistant']), content: z.string().max(120_000), status: z.enum(['complete', 'streaming', 'stopped', 'error']), request_id: uuid });
export const cloudJobSchema = z.object({ id: uuid, state: z.enum(['queued', 'scheduled', 'running', 'waiting', 'succeeded', 'failed', 'cancelled']), revision: z.number().int().nonnegative().default(0), content: z.string().max(32_000).default(''), errorMessage: z.string().nullable().optional() });
export const cloudWorkspaceSchema = z.object({ id: uuid, repository: z.string().max(300), branch: z.string().max(200), provider: z.string().max(80), status: z.string().max(40), error: z.string().nullable().optional() });
export const cloudInteractionSchema = z.object({ id: uuid, revision: z.number().int().nonnegative(), state: z.string(), payload: z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('question'), questions: z.array(z.object({ id: z.string().max(50), title: z.string().max(500), options: z.array(z.string().max(200)).max(4).default([]) })).max(3) }),
  z.object({ kind: z.literal('approval'), repository: z.string().max(300), action: z.record(z.string(), z.unknown()) }),
  z.object({ kind: z.literal('connector_approval'), connectorName: z.string().max(80), tool: z.string().max(200), arguments: z.record(z.string(), z.unknown()) }),
  z.object({ kind: z.literal('skill'), skill: z.object({ name: z.string().max(200), description: z.string().max(2000), instructions: z.string().max(32_000) }) }),
]) });
const eventSchema = z.object({ type: z.literal('messages'), messages: z.array(cloudMessageSchema).max(2) });
export type CloudConversation = z.infer<typeof cloudConversationSchema>;
export type CloudMessage = z.infer<typeof cloudMessageSchema>;
export type CloudJob = z.infer<typeof cloudJobSchema>;
export type CloudInteraction = z.infer<typeof cloudInteractionSchema>;
export type CloudWorkspace = z.infer<typeof cloudWorkspaceSchema>;
export type CloudEvent = z.infer<typeof eventSchema>;

export function parseCloudReference(reference: string): { id: string; accountId?: string } {
  if (uuid.safeParse(reference).success) return { id: reference };
  let url: URL;
  try { url = new URL(reference); } catch { throw new Error('Use a cloud session ID or its https://dev.autohand.ai/c/ link.'); }
  const id = url.pathname.slice('/c/'.length);
  if (url.origin !== TRANSFER_ORIGIN || url.username || url.password || url.hash || !url.pathname.startsWith('/c/') || !uuid.safeParse(id).success || [...url.searchParams.keys()].some(key => key !== 'account') || url.searchParams.getAll('account').length > 1) throw new Error('Use a cloud session ID or its https://dev.autohand.ai/c/ link.');
  const selected = url.searchParams.get('account');
  if (selected !== null && !accountId.safeParse(selected).success) throw new Error('Invalid cloud session account.');
  return { id, ...(selected ? { accountId: selected } : {}) };
}

export function cloudSessionUrl(id: string, selectedAccount: string | undefined, surface: 'web' | 'desktop' = 'web'): string {
  uuid.parse(id);
  if (selectedAccount !== undefined) accountId.parse(selectedAccount);
  if (surface === 'desktop') {
    if (!selectedAccount) throw new Error('Resume the cloud session in its account before opening Desktop.');
    return `autohand://cloud/session/${id}?account=${selectedAccount}`;
  }
  const url = new URL(`/c/${id}`, TRANSFER_ORIGIN);
  if (selectedAccount) url.searchParams.set('account', selectedAccount);
  return url.href;
}

export class CloudRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | undefined) { super(message); this.name = 'CloudRequestError'; }
}

async function readBoundedJson(response: Response, limit = 2_000_000): Promise<unknown> {
  if (!response.body) throw new Error('Autohand Cloud returned an empty response.');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('The cloud response exceeds the supported size. Open this session in Web.');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

async function* frames(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  const limit = 512_000;
  let buffer = '', data: string[] = [], size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line.length > limit) throw new Error('Cloud stream line exceeded its size limit.');
        if (!line) {
          if (data.length) yield data.join('\n');
          data = []; size = 0;
        } else if (line.startsWith('data:')) {
          const content = line.slice(5).replace(/^ /, '');
          size += content.length;
          if (size > limit) throw new Error('Cloud stream frame exceeded its size limit.');
          data.push(content);
        }
      }
      if (buffer.length > limit) throw new Error('Cloud stream line exceeded its size limit.');
      if (done) {
        if (buffer.trim() || data.length) throw new Error('Cloud stream ended inside a frame. Reconnect to recover the saved session.');
        return;
      }
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export class CloudClient {
  readonly identity: Readonly<TransferIdentity>;
  constructor(identity: TransferIdentity, private readonly request: typeof fetch = fetch) { this.identity = Object.freeze({ ...identity }); }

  private async response(path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown, signal?: AbortSignal, streaming = false): Promise<Response> {
    if (!this.identity.token) throw new Error('Sign in with autohand login before using cloud sessions.');
    const headers = new Headers({ Authorization: `Bearer ${this.identity.token}`, Accept: streaming ? 'text/event-stream' : 'application/json', 'X-Autohand-Client-Type': 'cli' });
    if (this.identity.accountId) headers.set('X-Autohand-Account-Id', accountId.parse(this.identity.accountId));
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const deadline = AbortSignal.timeout(streaming ? 60_000 : 30_000);
    const response = await this.request(new URL(path, TRANSFER_ORIGIN), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
    if (!response.ok) {
      let detail: { error: { message: string; code?: string } } | undefined;
      try { detail = z.object({ error: z.object({ message: z.string().max(1000), code: z.string().max(100).optional() }) }).parse(await readBoundedJson(response, 8192)); }
      catch { discardResponseBody(response); }
      const message = response.status === 401 ? 'Sign in again with autohand login to reconnect to Cloud.'
        : response.status === 402 ? 'Cloud CLI sessions are available on Pro, Pro+, and Max. Upgrade in Console.'
        : response.status === 403 || response.status === 404 ? 'This cloud session is unavailable in the selected account.'
        : detail?.error.message ?? 'Autohand Cloud could not complete this request. Reconnect to check the saved session before retrying.';
      throw new CloudRequestError(message, response.status, detail?.error.code);
    }
    return response;
  }

  async call<T>(path: string, schema: z.ZodType<T>, method: 'GET' | 'POST' | 'DELETE' = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    if (!/^[a-zA-Z0-9_/?&=.%~-]+$/.test(path) || path.includes('..') || path.startsWith('/')) throw new Error('Invalid cloud API path.');
    return schema.parse(await readBoundedJson(await this.response(`/api/native/cloud/${path}`, method, body, signal)));
  }
  async session() {
    const result = await this.call('session', z.object({ session: z.object({ user: z.object({ id: z.string() }), account: z.object({ account: z.object({ id: accountId }) }) }) }));
    if ((this.identity.accountId && result.session.account.account.id !== this.identity.accountId) || (this.identity.userId !== 'authenticated' && result.session.user.id !== this.identity.userId)) throw new Error('The cloud user or account changed. Sign in to the selected account again.');
    return result.session;
  }
  async create(title: string, model: string, requestId: string = randomUUID()) { return (await this.call('conversations', z.object({ conversation: cloudConversationSchema }), 'POST', { title, model, requestId })).conversation; }
  async list() { return this.call('conversations', z.object({ conversations: z.array(cloudConversationSchema).max(1000) })); }
  async detail(id: string, signal?: AbortSignal) { return this.call(`conversations/${uuid.parse(id)}`, z.object({ conversation: cloudConversationSchema, messages: z.array(cloudMessageSchema).max(1000) }), 'GET', undefined, signal); }
  async send(id: string, content: string, model: string, requestId: string = randomUUID(), executionMode: 'auto' | 'plan' = 'auto', signal?: AbortSignal) {
    return (await this.call(`conversations/${uuid.parse(id)}/messages`, z.object({ job: cloudJobSchema }), 'POST', { content, model, requestId, executionMode }, signal)).job;
  }
  async queue(id: string, signal?: AbortSignal) { return this.call(`conversations/${uuid.parse(id)}/queue`, z.object({ jobs: z.array(cloudJobSchema).max(100), paused: z.boolean() }), 'GET', undefined, signal); }
  async steer(id: string, job: Pick<CloudJob, 'id' | 'revision'>, signal?: AbortSignal) { return this.call(`conversations/${uuid.parse(id)}/queue/steer`, z.object({ job: cloudJobSchema }), 'POST', { jobId: uuid.parse(job.id), revision: job.revision }, signal); }
  async stop(id: string, signal?: AbortSignal) { return this.call(`conversations/${uuid.parse(id)}/stop`, z.object({ success: z.boolean() }), 'POST', {}, signal); }
  async resume(id: string, signal?: AbortSignal) { return this.call(`conversations/${uuid.parse(id)}/queue/resume`, z.object({ success: z.boolean() }), 'POST', {}, signal); }
  async interactions(id: string, signal?: AbortSignal) { return this.call(`conversations/${uuid.parse(id)}/interactions`, z.object({ interaction: cloudInteractionSchema.nullable() }), 'GET', undefined, signal); }
  async answer(id: string, interaction: CloudInteraction, answer: Record<string, unknown>, signal?: AbortSignal) { return this.call(`conversations/${uuid.parse(id)}/interactions/${interaction.id}`, z.object({ job: cloudJobSchema }), 'POST', { ...answer, revision: interaction.revision, requestId: randomUUID() }, signal); }
  async export(id: string, requestId: string = randomUUID()) {
    const result = z.object({ transfer: z.unknown() }).parse(await readBoundedJson(await this.response('/api/transfers/from-conversation', 'POST', { conversationId: uuid.parse(id), requestId, target: 'cli' })));
    const transfer = parseTransferReceipt(result.transfer);
    if (this.identity.accountId && transfer.accountId !== this.identity.accountId) throw new Error('The cloud transfer account changed.');
    return transfer;
  }
  async import(id: string, model: string) {
    return z.object({ conversation: cloudConversationSchema, repositoryPending: z.boolean() }).parse(await readBoundedJson(await this.response(`/api/transfers/${uuid.parse(id)}/import`, 'POST', { model, mode: 'new' })));
  }
  async restore(id: string, conversationId: string, connectorId: string, provider: string) {
    return z.object({ workspace: cloudWorkspaceSchema }).parse(await readBoundedJson(await this.response(`/api/transfers/${uuid.parse(id)}/workspace`, 'POST', { conversationId: uuid.parse(conversationId), connectorId, provider })));
  }
  async *events(id: string, signal: AbortSignal): AsyncGenerator<CloudEvent> {
    const response = await this.response(`/api/native/cloud/conversations/${uuid.parse(id)}/events`, 'GET', undefined, signal, true);
    if (!response.body || !response.headers.get('Content-Type')?.startsWith('text/event-stream')) { discardResponseBody(response); throw new Error('Autohand Cloud returned an invalid event stream.'); }
    for await (const frame of frames(response.body)) yield eventSchema.parse(JSON.parse(frame) as unknown);
  }
}
