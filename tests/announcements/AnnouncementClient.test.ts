/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { AnnouncementClient } from '../../src/announcements/AnnouncementClient.js';
import type { LoadedConfig } from '../../src/types.js';

function config(token: string | undefined = 'secret-token'): LoadedConfig {
  return {
    configPath: '/tmp/config.json',
    provider: 'openrouter',
    api: { baseUrl: 'https://api.example.test/' },
    auth: { token },
  };
}

describe('AnnouncementClient', () => {
  it('sends the CLI query and bearer authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      announcements: [{
        id: 'announcement-1',
        title: 'Hello',
        description: null,
        priority: 1,
        steps: [],
      }],
    }), { status: 200 }));
    const client = new AnnouncementClient(config(), {
      fetch: fetchMock,
      clientVersion: '1.2.3',
      platform: 'darwin',
    });

    expect(await client.fetchAnnouncements()).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/v1/announcements');
    expect(url.searchParams.get('clientType')).toBe('cli');
    expect(url.searchParams.get('appVersion')).toBe('1.2.3');
    expect(url.searchParams.get('platform')).toBe('darwin');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret-token' });
  });

  it.each([
    ['non-200 response', () => Promise.resolve(new Response('nope', { status: 503 }))],
    ['malformed JSON', () => Promise.resolve(new Response('{', { status: 200 }))],
    ['malformed body', () => Promise.resolve(new Response('{"announcements":"nope"}', { status: 200 }))],
  ])('returns null for a %s', async (_name, implementation) => {
    const client = new AnnouncementClient(config(), {
      fetch: vi.fn(implementation),
    });
    expect(await client.fetchAnnouncements()).toBeNull();
  });

  it('returns null when authentication is unavailable without making a request', async () => {
    const fetchMock = vi.fn();
    const unauthenticatedConfig = config();
    unauthenticatedConfig.auth = {};
    const client = new AnnouncementClient(unauthenticatedConfig, { fetch: fetchMock });

    expect(await client.fetchAnnouncements()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts a timed-out request and returns null', async () => {
    const fetchMock = vi.fn((_url: URL, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const client = new AnnouncementClient(config(), {
      fetch: fetchMock,
      requestTimeoutMs: 5,
    });

    expect(await client.fetchAnnouncements()).toBeNull();
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
  });

  it('aborts a response whose body stalls after headers arrive', async () => {
    // The abort timer must outlive the header exchange: a server that answers with
    // headers and then stalls the body would otherwise hang `/whatsnew` forever,
    // because that command awaits refresh() with the UI already paused.
    const fetchMock = vi.fn((_url: URL, init: RequestInit) => Promise.resolve({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    } as unknown as Response));
    const client = new AnnouncementClient(config(), {
      fetch: fetchMock,
      requestTimeoutMs: 5,
    });

    expect(await client.fetchAnnouncements()).toBeNull();
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
  });

  it('awaits the seen and dismiss requests instead of detaching them', async () => {
    let completed = false;
    const fetchMock = vi.fn(async () => {
      await new Promise((resolve) => { setTimeout(resolve, 5); });
      completed = true;
      return new Response('{}', { status: 200 });
    });
    const client = new AnnouncementClient(config(), { fetch: fetchMock });

    await client.postSeen('announcement-1', 2);
    expect(completed).toBe(true);

    completed = false;
    await client.postDismiss('announcement-1');
    expect(completed).toBe(true);
  });

  it('swallows seen and dismiss request failures', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    const client = new AnnouncementClient(config(), { fetch: fetchMock });

    await expect(client.postSeen('a/b', 3)).resolves.toBeUndefined();
    await expect(client.postDismiss('a/b')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[0].pathname).toBe('/v1/announcements/a%2Fb/seen');
    expect(fetchMock.mock.calls[1]?.[0].pathname).toBe('/v1/announcements/a%2Fb/dismiss');
  });
});
