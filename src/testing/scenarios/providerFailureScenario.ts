import { once } from 'node:events';
import { createServer } from 'node:http';
import type { Session } from 'tuistory';

export async function createProviderFailureFixture(): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const server = createServer(async (request, response) => {
    try {
      for await (const chunk of request) void chunk;
      if (request.method === 'GET' && request.url?.endsWith('/models')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ data: [{ id: 'moa' }, { id: 'openai/gpt-4o-mini' }] }));
        return;
      }
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'Fixture service failure' } }));
    } catch {
      response.destroy();
    }
  });
  let address: ReturnType<typeof server.address>;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    address = server.address();
    if (!address || typeof address === 'string') throw new Error('Provider failure fixture did not bind.');
  } catch (error) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    throw error;
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

export async function inspectProviderFailure(session: Session, statusUrl: string): Promise<string> {
  await session.waitForText('❯', { timeout: 15_000 });
  await session.type('hello');
  await session.waitForText('❯ hello');
  await session.press('enter');
  await session.waitForText(statusUrl, { timeout: 15_000 });
  await session.waitForText('Failed in', { timeout: 10_000 });
  await session.type('retry after checking status');
  await session.waitForText('❯ retry after checking status');
  return session.text({ immediate: true });
}
