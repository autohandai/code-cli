import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

export const transferScenarioId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export async function seedTransferScenario(directory: string): Promise<string> {
  const timestamp = '2026-09-08T00:00:00.000Z';
  const response = { transfer: { id: transferScenarioId, accountId: 'personal_fixture', expiresAt: '2099-01-01T00:00:00.000Z' }, snapshot: {
    version: 1, source: 'web', sourceSessionId: 'web-parser', title: 'Transferred parser work', createdAt: timestamp, model: 'moa', provider: 'autohandai', repository: null,
    messages: [{ role: 'user', content: 'Keep the parser history', createdAt: timestamp }, { role: 'assistant', content: 'The parser context is saved.', createdAt: timestamp }],
  } };
  const file = path.join(directory, 'transfer-fetch.mjs');
  await fs.writeFile(file, `import { writeFile } from 'node:fs/promises';
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin === 'https://dev.autohand.ai' && url.pathname === '/api/transfers/${transferScenarioId}') return Response.json(${JSON.stringify(response)});
  if (url.origin === 'https://dev.autohand.ai' && url.pathname === '/api/transfers' && options?.method === 'POST') {
    await writeFile(${JSON.stringify(path.join(directory, 'handoff-upload.json'))}, options.body);
    return Response.json({ transfer: ${JSON.stringify(response.transfer)} }, { status: 201 });
  }
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return originalFetch(input, options);
  return Response.json({ error: 'Network disabled in transfer scenario' }, { status: 503 });
};\n`);
  return pathToFileURL(file).href;
}
