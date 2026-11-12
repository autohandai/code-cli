import { once } from 'node:events';
import { createServer } from 'node:http';
import type { Session } from 'tuistory';

export async function createLocalModelContextFixture(): Promise<{
  baseUrl: string;
  metadataRequests: string[];
  completions: Record<string, unknown>[];
  close(): Promise<void>;
}> {
  const metadataRequests: string[] = [];
  const completions: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    try {
      response.setHeader('content-type', 'application/json');
      if (request.url?.startsWith('/props')) {
        metadataRequests.push(request.url);
        response.end(JSON.stringify({
          default_generation_settings: { n_ctx: 32768 },
          total_slots: 4,
          meta: { n_ctx_train: 131072 },
        }));
        return;
      }
      if (request.method === 'GET') {
        response.end(JSON.stringify({ data: [{ id: 'canvas-pirate' }] }));
        return;
      }
      let body = '';
      for await (const chunk of request) body += String(chunk);
      const payload: unknown = JSON.parse(body);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid fixture request');
      completions.push(payload as Record<string, unknown>);
      response.end(JSON.stringify({
        id: 'local-context-fixture',
        created: 1,
        choices: [{ message: { role: 'assistant', content: 'LOCAL_CONTEXT_READY' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 64, completion_tokens: 8, total_tokens: 72 },
      }));
    } catch {
      response.destroy();
    }
  });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Local model fixture did not bind');
    return {
      baseUrl: `http://127.0.0.1:${address.port}`,
      metadataRequests,
      completions,
      close: async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      },
    };
  } catch (error) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    throw error;
  }
}

export async function inspectLocalModelContext(session: Session): Promise<string> {
  await session.waitForText('❯', { timeout: 20000 });
  await session.type('hello');
  await session.waitForText('❯ hello');
  await session.press('enter');
  await session.waitForText('LOCAL_CONTEXT_READY', { timeout: 20000 });
  await session.waitForText('Completed in', { timeout: 10000 });
  await session.type('local context draft');
  await session.waitForText('❯ local context draft');
  return session.text({ immediate: true });
}
