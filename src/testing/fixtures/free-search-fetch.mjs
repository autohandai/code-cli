const realFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url === 'https://dev.autohand.ai/api/native/web-search') {
    if (options?.method !== 'GET') throw new Error('This terminal fixture only reads search availability.');
    return Response.json({ available: true, tier: 'free', provider: 'cloudflare', usage: {
      limit: 10, remaining: Number(process.env.AUTOHAND_TEST_SEARCH_REMAINING), resetAt: '2026-10-27T00:00:00.000Z',
    } });
  }
  const parsed = new URL(url);
  if (['127.0.0.1', 'localhost'].includes(parsed.hostname)) return realFetch(input, options);
  throw new Error('Unexpected outbound request in the Free search terminal fixture.');
};
