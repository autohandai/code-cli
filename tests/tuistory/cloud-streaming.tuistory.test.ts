import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type ServerResponse } from 'node:http';
import type { Session } from 'tuistory';
import { createMockAuthServer, createTempAutohandHome, exitInteractive, launchBuiltAutohand } from './helpers/autohandTuistory.js';

const cleanupTasks: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanupTasks.splice(0).reverse()) await cleanup(); });

describe('built cloud token streaming', () => {
  it('retries a Moa response timeout visibly and keeps the previous turn', async () => {
    const auth = await createMockAuthServer();
    cleanupTasks.push(auth.close);
    const attempts: unknown[] = [];
    let stalledResponse: ServerResponse | undefined;
    const server = createServer(async (request, response) => {
      if (request.url !== '/chat/completions') { response.writeHead(404).end(); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stream?: boolean; messages: unknown[] };
      if (!body.stream) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: { content: '{"complexity":"simple","requiresTools":false,"requiresPlanning":false,"suggestedApproach":"respond"}' }, finish_reason: 'stop' }] }));
        return;
      }
      attempts.push(body.messages);
      if (attempts.length === 2) { stalledResponse = response; return; }
      const content = attempts.length === 1 ? 'Previous work is preserved.' : 'Recovered the Moa request.';
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 } })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanupTasks.push(async () => {
      stalledResponse?.end();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
    const state = await createTempAutohandHome({ config: {
      provider: 'autohandai', features: { autohand_inference: true, automaticSpecialists: false },
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'fixture-only', baseUrl: `http://127.0.0.1:${address.port}`, model: 'moa' },
      network: { timeout: 1_000, maxRetries: 1, retryDelay: 2_000 },
    } });
    cleanupTasks.push(state.cleanup);
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot,
      env: { AUTOHAND_AUTH_API_URL: `${auth.baseUrl}/api/auth` },
    });
    cleanupTasks.push(() => exitInteractive(session));
    await session.text({ timeout: 20_000, waitFor: (text) => text.includes('❯') });
    await session.type('Reply briefly without tools');
    await session.press('enter');
    await session.text({ timeout: 20_000, waitFor: (text) => text.includes('Previous work is preserved.') });
    await session.type('Continue with another short answer');
    await session.press('enter');
    const waiting = await session.text({ timeout: 20_000, waitFor: (text) => /retry.*1\/1/i.test(text) });
    expect(waiting).not.toContain('Session failed');
    const completed = await session.text({ timeout: 20_000, waitFor: (text) => text.includes('Recovered the Moa request.') });
    expect(completed).not.toContain('Session failed');
    expect(completed.match(/Recovered the Moa request\./g)).toHaveLength(1);
    expect(attempts).toHaveLength(3);
    expect(attempts[2]).toEqual(attempts[1]);
    expect(JSON.stringify(attempts[2])).toContain('Previous work is preserved.');
  }, 60_000);

  it('shows the first provider token in the terminal before the server completes', async () => {
    const auth = await createMockAuthServer();
    cleanupTasks.push(auth.close);
    let pending: ServerResponse | undefined;
    let streamingRequested = false;
    const server = createServer(async (request, response) => {
      if (request.url !== '/chat/completions') { response.writeHead(404).end(); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (body.stream !== true) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: { content: '{"complexity":"simple","requiresTools":false,"requiresPlanning":false,"suggestedApproach":"respond"}' }, finish_reason: 'stop' }] }));
        return;
      }
      streamingRequested = body.stream === true;
      pending = response;
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      response.flushHeaders();
      response.write(`data: ${JSON.stringify({ id: 'terminal-stream-proof', choices: [{ delta: { content: 'First streamed token is visible' } }] })}\n\n`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanupTasks.push(async () => {
      pending?.end(); server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
    const state = await createTempAutohandHome({ config: {
      provider: 'autohandai', features: { autohand_inference: true, automaticSpecialists: false },
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'fixture-only', baseUrl: `http://127.0.0.1:${address.port}`, model: 'fantail' },
    } });
    cleanupTasks.push(state.cleanup);
    const session: Session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot,
      env: { AUTOHAND_AUTH_API_URL: `${auth.baseUrl}/api/auth` },
    });
    cleanupTasks.push(() => exitInteractive(session));
    await session.text({ timeout: 20_000, waitFor: (text) => text.includes('❯') });
    await session.type('Explain recursion briefly without using tools');
    await session.press('enter');
    await vi.waitFor(() => expect(streamingRequested).toBe(true), { timeout: 10_000 });
    const partial = await session.text({ timeout: 20_000, waitFor: (text) => text.includes('First streamed token is visible') });
    expect(streamingRequested).toBe(true);
    expect(pending?.writableEnded).toBe(false);
    expect(partial).not.toContain('and now complete.');
    pending?.end(`data: ${JSON.stringify({ choices: [{ delta: { content: ' and now complete.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 } })}\n\ndata: [DONE]\n\n`);
    const completed = await session.text({ timeout: 20_000, waitFor: (text) => text.includes('and now complete.') });
    expect(completed.match(/First streamed token is visible/g)).toHaveLength(1);
  }, 60_000);
});
