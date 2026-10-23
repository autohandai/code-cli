import { createServer } from 'node:http';
import type { Session } from 'tuistory';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function createSessionLifecycleServer(options: { stallDecisions?: boolean } = {}) {
  const chats: Record<string, unknown>[] = [];
  const decisions: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, unknown>;
    response.setHeader('content-type', 'application/json');
    if (request.url === '/decisions') {
      decisions.push(body);
      if (options.stallDecisions) return;
      const questions = body.questions as Record<string, unknown>;
      response.end(JSON.stringify({ model: 'weka', answers: Object.fromEntries(Object.keys(questions).map(key => [key, { type: 'noul', noul: 0.99 }])) }));
      return;
    }
    if (request.url !== '/chat/completions') {
      response.writeHead(404).end('{}');
      return;
    }
    chats.push(body);
    const content = ['LEARNT_CANCEL_BEFORE_RETRY. Changed retry.ts. FINAL_ANSWER_ONE.', 'HANDOFF_RECEIVED_TWO', 'FRESH_SESSION_THREE'][Math.min(chats.length - 1, 2)];
    const usage = { prompt_tokens: 42, completion_tokens: 12, total_tokens: 54 };
    if (body.stream) {
      response.setHeader('content-type', 'text/event-stream');
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }], usage })}\n\ndata: [DONE]\n\n`);
    } else {
      response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage }));
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Session fixture did not bind');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`, chats, decisions,
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}

export async function createBackgroundProcessAudit(directory: string): Promise<{ preload: string; log: string }> {
  const preload = path.join(directory, 'process-audit.mjs');
  const log = path.join(directory, 'process-audit.jsonl');
  await writeFile(preload, `
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { appendFileSync } from 'node:fs';
const log = ${JSON.stringify(log)};
for (const name of ['spawn', 'fork', 'spawnSync']) {
  const original = childProcess[name];
  childProcess[name] = function(...args) {
    const options = args.find(value => value && typeof value === 'object' && !Array.isArray(value));
    const result = original.apply(this, args);
    appendFileSync(log, JSON.stringify({ event: 'start', name, command: String(args[0]), args: args[1], detached: options?.detached === true, pid: result?.pid }) + '\\n');
    if (result?.on) result.once('exit', () => appendFileSync(log, JSON.stringify({ event: 'exit', pid: result.pid }) + '\\n'));
    else if (result?.pid) appendFileSync(log, JSON.stringify({ event: 'exit', pid: result.pid }) + '\\n');
    return result;
  };
}
syncBuiltinESMExports();
`);
  return { preload, log };
}

export async function submitSessionCommand(session: Session, text: string, expected: string): Promise<void> {
  await session.waitForText('❯');
  await session.type(text);
  await session.press('enter');
  await session.waitForText(expected, { timeout: 15_000 });
}

export async function cancelStalledSessionCompaction(session: Session, waitForRequest: () => Promise<void>): Promise<void> {
  await session.type('/clear');
  await session.press('enter');
  await waitForRequest();
  await session.press('escape');
  await session.waitForText('Context compaction cancelled');
}
