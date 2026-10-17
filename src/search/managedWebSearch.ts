import { z } from 'zod';
import type { AutohandConfig } from '../types.js';
import type { WebSearchResult } from '../actions/web.js';
import { discardResponseBody } from '../utils/responseBody.js';

export interface ManagedSearchIdentity { token: string; accountId?: string }
type SearchAccountConfig = {
  auth?: { token?: string };
  api?: Pick<NonNullable<AutohandConfig['api']>, 'accountId'>;
  autohandai?: Pick<NonNullable<AutohandConfig['autohandai']>, 'authMode' | 'accountToken' | 'apiKey'>;
};

export function managedSearchIdentity(config: SearchAccountConfig): ManagedSearchIdentity | undefined {
  const token = config.auth?.token ?? (config.autohandai?.authMode === 'account' ? config.autohandai.accountToken : undefined);
  if (!token || !/^[A-Za-z0-9._~+/-]{1,512}$/.test(token)) return undefined;
  const accountId = config.api?.accountId ?? process.env.AUTOHAND_ACCOUNT_ID;
  if (accountId && !/^[A-Za-z0-9_-]{1,200}$/.test(accountId)) return undefined;
  return { token, accountId };
}

const input = z.object({ query: z.string().trim().min(1).max(1024), limit: z.number().int().min(1).max(10) });
const result = z.object({ provider: z.literal('cloudflare'), query: z.string().max(1024), results: z.array(z.object({
  title: z.string().max(10_000), url: z.string().url().refine(url => /^https?:\/\//.test(url)), snippet: z.string().max(60_000),
})).max(10) });

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new Error('Autohand Web Search returned an empty response.');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  const abort = () => { void reader.cancel().catch(() => undefined); };
  let size = 0, text = '';
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > 600_000) throw new Error('Autohand Web Search response exceeds its size limit.');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function fetchResponse(init: RequestInit & { signal: AbortSignal }): Promise<Response> {
  const { signal } = init;
  let onAbort = () => {};
  try {
    return await new Promise<Response>((resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) { onAbort(); return; }
      void fetch('https://dev.autohand.ai/api/native/web-search', init).then(response => {
        if (signal.aborted) {
          discardResponseBody(response);
          reject(signal.reason);
        } else resolve(response);
      }, reject);
    });
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

export class ManagedWebSearch {
  constructor(private readonly identity: ManagedSearchIdentity) {}

  private async request(method: 'GET' | 'POST', body?: { query: string; limit: number }, external?: AbortSignal): Promise<unknown> {
    const deadline = AbortSignal.timeout(method === 'GET' ? 3500 : 15_000);
    const signal = external ? AbortSignal.any([external, deadline]) : deadline;
    signal.throwIfAborted();
    const response = await fetchResponse({
      method, redirect: 'error', signal,
      headers: { Authorization: `Bearer ${this.identity.token}`, 'Content-Type': 'application/json',
        ...(this.identity.accountId ? { 'X-Autohand-Account-Id': this.identity.accountId } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (signal.aborted || !response.ok) {
      discardResponseBody(response);
      signal.throwIfAborted();
      const advice = response.status === 401 ? 'Sign in again.'
        : response.status === 402 ? 'Included search requires Lite or above. Configure your own provider with /search on Free.'
        : response.status === 429 ? 'Wait a moment before searching again.' : 'Try again later or choose a provider with /search.';
      throw new Error(`Autohand Web Search failed (${response.status}). ${advice}`);
    }
    return readJson(response, signal);
  }

  async available(signal?: AbortSignal): Promise<boolean> {
    try {
      const capability = z.object({ available: z.boolean(), provider: z.literal('cloudflare'), tier: z.string() }).parse(await this.request('GET', undefined, signal));
      return capability.available;
    } catch (error) {
      if (signal?.aborted) throw error;
      return false;
    }
  }

  async search(query: string, limit: number, signal?: AbortSignal): Promise<WebSearchResult[]> {
    return result.parse(await this.request('POST', input.parse({ query, limit }), signal)).results;
  }
}
