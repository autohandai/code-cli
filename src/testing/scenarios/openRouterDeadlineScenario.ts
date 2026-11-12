import { once } from 'node:events';
import { createServer } from 'node:http';

export type OpenRouterDeadlineMode = 'headers' | 'body' | 'error-body' | 'sse' | 'success';

export async function createOpenRouterDeadlineFixture(mode: OpenRouterDeadlineMode): Promise<{
  baseUrl: string;
  committedResponses(): number;
  activeCompletions(): number;
  close(): Promise<void>;
}> {
  let committed = 0;
  let active = 0;
  const server = createServer(async (request, response) => {
    try {
      for await (const chunk of request) void chunk;
      if (request.method === 'GET' && request.url?.endsWith('/models')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ data: [{ id: 'openai/gpt-4o-mini' }] }));
        return;
      }
      active++;
      response.once('close', () => { active--; });
      if (mode === 'headers') return;
      response.writeHead(mode === 'error-body' ? 400 : 200, {
        'content-type': mode === 'sse' ? 'text/event-stream' : 'application/json',
      });
      response.flushHeaders();
      committed++;
      if (mode === 'success') {
        response.end(JSON.stringify({
          id: 'deadline-fixture', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        }));
        return;
      }
      response.write(mode === 'sse' ? ': waiting for provider\n\n' : '{"choices":[');
    } catch {
      response.destroy();
    }
  });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('OpenRouter deadline fixture did not bind.');
    return {
      baseUrl: `http://127.0.0.1:${address.port}`,
      committedResponses: () => committed,
      activeCompletions: () => active,
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
