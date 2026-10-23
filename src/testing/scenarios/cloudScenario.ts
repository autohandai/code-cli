import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Session } from 'tuistory';

export function cloudViewport(session: Pick<Session, 'getTerminalData'>): string {
  const screen = session.getTerminalData();
  return screen.lines.slice(-screen.rows).map(line => line.spans.map(span => span.text).join('').trimEnd()).join('\n');
}

export const cloudScenarioId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export async function seedCloudScenario(directory: string, tier = 'pro', review = false, queueSize = 0, handoff = false): Promise<string> {
  const file = path.join(directory, 'cloud-fetch.mjs');
  const queued = Array.from({ length: queueSize }, (_, index) => ({ id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, '0')}`, state: 'queued', revision: 3, content: `Correction ${index + 1}` }));
  const savedMessages = [{ role: 'user', content: 'Keep the parser history', createdAt: '2026-10-12T00:00:00.000Z' }, { role: 'assistant', content: 'The parser context is saved.', createdAt: '2026-10-12T00:00:00.000Z' }];
  const transfer = { id: cloudScenarioId, accountId: 'personal_fixture', expiresAt: '2099-01-01T00:00:00.000Z' };
  const snapshot = { version: 1, source: 'web', sourceSessionId: cloudScenarioId, title: 'Repair parser', createdAt: '2026-10-12T00:00:00.000Z', provider: 'autohandai', model: 'auto', repository: null, messages: savedMessages };
  await writeFile(file, `import { appendFile, access } from 'node:fs/promises';
const id = '${cloudScenarioId}', account = 'personal_fixture';
const conversation = { id, title: 'Repair parser', model: 'auto', updated_at: '2026-10-12' };
let jobs = ${JSON.stringify(queued)}, messages = ${JSON.stringify(handoff ? savedMessages.map((message, index) => ({ ...message, id: `cccccccc-cccc-4ccc-8ccc-${String(index).padStart(12, '0')}`, status: 'complete', request_id: cloudScenarioId })) : [])}, paused = false, interaction = null;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  const native = url.pathname.startsWith('/api/native/cloud/');
  const transferring = ${JSON.stringify(handoff)} && ['/api/transfers/from-conversation', '/api/transfers/' + id].includes(url.pathname);
  if (url.origin !== 'https://dev.autohand.ai' || !native && !transferring) return Response.json({ error: { message: 'Network disabled in Cloud terminal scenario' } }, { status: 503 });
  const route = url.pathname.slice(native ? '/api/native/cloud/'.length : '/api/'.length), method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : undefined;
  await appendFile(${JSON.stringify(path.join(directory, 'cloud-requests.jsonl'))}, JSON.stringify({ route, method, body, account: new Headers(options.headers).get('X-Autohand-Account-Id') }) + '\\n');
  if (route === 'transfers/from-conversation') return Response.json({ transfer: ${JSON.stringify(transfer)} }, { status: 201 });
  if (route === 'transfers/' + id) return Response.json({ transfer: ${JSON.stringify(transfer)}, snapshot: ${JSON.stringify(snapshot)} });
  if (route === 'session') return Response.json({ session: { user: { id: 'tuistory-test-user' }, account: { account: { id: account } } } });
  if (route === 'account') return Response.json({ tier: ${JSON.stringify(tier)}, paymentAccess: null });
  if (route === 'models') return Response.json({ models: [{ id: 'auto', available: true }] });
  if (route === 'sandbox-providers') return Response.json({ providers: [{ id: 'cloudflare', name: 'Cloudflare', available: true }] });
  if (route === 'workspaces') return Response.json(method === 'POST' ? { workspace: { id, repository: body.repository, branch: body.branch, provider: body.provider, status: 'ready' } } : { workspaces: [] });
  if (route === 'conversations') return Response.json(method === 'POST' ? { conversation } : { conversations: [conversation] });
  if (route === 'conversations/' + id) return Response.json({ conversation, messages });
  if (route.endsWith('/interactions')) return Response.json({ interaction });
  if (route.includes('/interactions/')) { interaction = null; return Response.json({ job: jobs[0] }); }
  if (route.endsWith('/queue')) {
    const reordered = await access(${JSON.stringify(path.join(directory, 'cloud-reorder-queue'))}).then(() => true, () => false);
    return Response.json({ jobs: reordered ? [...jobs].reverse() : jobs, paused });
  }
  if (route.endsWith('/messages')) {
    const job = { id: body.requestId, state: 'queued', revision: 3, content: body.content }; jobs.push(job);
    if (${JSON.stringify(review)}) { job.state = 'waiting'; interaction = { id, revision: 4, state: 'pending', payload: { kind: 'approval', repository: 'autohand/parser', action: { type: 'write_file', path: 'src/parser.ts', content: 'x'.repeat(4000) + 'FULL_REVIEW_SENTINEL' } } }; }
    messages = [{ id, role: 'assistant', content: 'Cloud agent connected to the parser workspace.', status: 'complete', request_id: id }];
    return Response.json({ job }, { status: 202 });
  }
  if (route.endsWith('/queue/steer')) { const job = jobs.find(job => job.id === body.jobId); jobs = jobs.filter(job => job.id !== body.jobId); return Response.json({ job }); }
  if (route.endsWith('/stop')) { paused = true; return Response.json({ success: true }); }
  if (route.endsWith('/queue/resume')) { paused = false; return Response.json({ success: true }); }
  if (route.endsWith('/events')) return new Response('data: ' + JSON.stringify({ type: 'messages', messages: messages.slice(-2) }) + '\\n\\n', { headers: { 'Content-Type': 'text/event-stream' } });
  return Response.json({ error: { message: 'Unsupported Cloud fixture operation' } }, { status: 404 });
};\n`);
  return pathToFileURL(file).href;
}
