import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type ServerResponse } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Session } from 'tuistory';
import { createMockAuthServer, createTempAutohandHome, exitInteractive, launchBuiltAutohand } from './helpers/autohandTuistory.js';

const cleanupTasks: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanupTasks.splice(0).reverse()) await cleanup(); });

describe('built cloud token streaming', () => {
  it.each([false, true])('continues an interrupted site-building turn without repeating completed tools (empty=%s)', async empty => {
    const auth = await createMockAuthServer();
    cleanupTasks.push(auth.close);
    const requests: Array<{ messages: unknown[] }> = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body.stream) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: { content: '{"complexity":"simple","requiresTools":true,"requiresPlanning":false,"suggestedApproach":"implement"}' }, finish_reason: 'stop' }] }));
        return;
      }
      requests.push(body);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\n`;
      if (requests.length === 1) {
        response.end(send({ content: 'I will create the requested directory before writing the complete animated site.', tool_calls: [{ index: 0, id: 'create-birds', type: 'function', function: { name: 'create_directory', arguments: '{"path":"birds_stickers"}' } }] }, 'tool_calls') + 'data: [DONE]\n\n');
      } else if (requests.length === 2) {
        response.end(empty ? '' : send({ content: 'The directory is ready. I am preparing the animated sticker site.' }, null));
      } else if (requests.length === 3) {
        response.end(send({ content: 'The existing directory was created successfully. I will now write the complete site in it.', tool_calls: [{ index: 0, id: 'write-birds', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'birds_stickers/index.html', contents: '<!doctype html><title>Bird Stickers</title><style>@keyframes fly {to {transform:translateY(-8px)}} .bird {animation:fly 1s infinite alternate}</style><h1 class="bird">Bird Stickers</h1>' }) } }] }, 'tool_calls') + 'data: [DONE]\n\n');
      } else {
        response.end(send({ content: 'The animated bird sticker site is ready in birds_stickers/index.html.' }, 'stop') + 'data: [DONE]\n\n');
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanupTasks.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
    const state = await createTempAutohandHome({ config: {
      provider: 'autohandai', features: { autohand_inference: true, automaticSpecialists: false },
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'fixture-only', baseUrl: `http://127.0.0.1:${address.port}`, model: 'auto', orchestration: false },
      network: { maxRetries: 1, retryDelay: 10 },
    } });
    cleanupTasks.push(state.cleanup);
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, env: { AUTOHAND_AUTH_API_URL: `${auth.baseUrl}/api/auth` },
    });
    cleanupTasks.push(() => exitInteractive(session));
    await session.text({ timeout: 20_000, waitFor: text => text.includes('❯') });
    await session.type('Create an animated sticker site in birds_stickers');
    await session.press('enter');
    await session.text({ timeout: 20_000, waitFor: text => text.includes('Allow tool create_directory?') });
    await session.press('enter');
    await session.text({ timeout: 20_000, waitFor: text => text.includes('Write to this file?') && text.includes('birds_stickers/index.html') });
    await session.press('enter');
    const completed = await session.text({ timeout: 30_000, waitFor: text => text.includes('The animated bird sticker site is ready') });
    expect(completed).not.toContain('Session failed');
    expect(requests).toHaveLength(4);
    expect(JSON.stringify(requests[2].messages)).toContain('create-birds');
    expect(JSON.stringify(requests[2].messages)).toContain('Recovery 1/3');
    expect(JSON.stringify(requests[2].messages)).toContain('Created directory birds_stickers');
    expect(await readFile(path.join(state.workspaceRoot, 'birds_stickers/index.html'), 'utf8')).toContain('@keyframes fly');
  }, 60_000);
  it('recovers an empty Moa checkpoint verdict before staging the requested file', async () => {
    const auth = await createMockAuthServer();
    cleanupTasks.push(auth.close);
    const reviews: Array<{ max_tokens: number }> = [];
    let turns = 0;
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body.stream) {
        const review = body.messages?.[0]?.content?.includes('independent Moa advisor');
        if (review) reviews.push(body);
        const content = review ? reviews.length === 1 ? '' : '{"verdict":"approved","feedback":"The complete proposed change was verified."}'
          : '{"complexity":"simple","requiresTools":true,"requiresPlanning":false,"suggestedApproach":"stage"}';
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: review && reviews.length === 1 ? 'length' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } }));
        return;
      }
      turns += 1;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = turns === 1
        ? { content: 'The requested fixture change is ready to stage for the commit.', tool_calls: [{ index: 0, id: 'stage-reviewed', type: 'function', function: { name: 'git_add', arguments: '{"paths":["fixture.txt"]}' } }] }
        : { content: 'The requested file was reviewed and staged successfully.' };
      response.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: turns === 1 ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanupTasks.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
    const state = await createTempAutohandHome({ config: {
      provider: 'autohandai', features: { autohand_inference: true, automaticSpecialists: false },
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'fixture-only', baseUrl: `http://127.0.0.1:${address.port}`, model: 'auto', orchestration: true },
      network: { maxRetries: 1, retryDelay: 10 },
    } });
    cleanupTasks.push(state.cleanup);
    execFileSync('git', ['init', '--quiet'], { cwd: state.workspaceRoot });
    await writeFile(path.join(state.workspaceRoot, 'fixture.txt'), 'Checkpoint review fixture.');
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, env: { AUTOHAND_AUTH_API_URL: `${auth.baseUrl}/api/auth` },
    });
    cleanupTasks.push(() => exitInteractive(session));
    await session.text({ timeout: 20_000, waitFor: text => text.includes('❯') });
    await session.type('Stage fixture.txt for the commit');
    await session.press('enter');
    await session.text({ timeout: 20_000, waitFor: text => text.includes('Allow tool git_add?') });
    await session.press('enter');
    const completed = await session.text({ timeout: 30_000, waitFor: text => text.includes('The requested file was reviewed and staged successfully.') });
    expect(completed).not.toContain('Session failed');
    expect(completed).not.toContain('Work paused for Moa review');
    expect(turns).toBe(2);
    expect(reviews).toHaveLength(3);
    expect(reviews[0].max_tokens).toBe(8000);
    expect(reviews[1].max_tokens).toBe(16000);
    expect(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: state.workspaceRoot, encoding: 'utf8' }).trim()).toBe('fixture.txt');
  }, 60_000);
  it('reuses the tool prefix through a read-to-edit transition without a throughput retry', async () => {
    const auth = await createMockAuthServer();
    cleanupTasks.push(auth.close);
    const requests: Array<{ tools: unknown[]; prompt_cache_key?: string }> = [];
    let throttles = 0;
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        stream?: boolean; tools: unknown[]; prompt_cache_key?: string;
      };
      if (!body.stream) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: { content: '{"complexity":"simple","requiresTools":true,"requiresPlanning":false,"suggestedApproach":"read"}' }, finish_reason: 'stop' }] }));
        return;
      }
      requests.push(body);
      if (requests.length === 2 && JSON.stringify(body.tools) !== JSON.stringify(requests[0].tools)) {
        throttles += 1;
        response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '3' });
        response.end(JSON.stringify({ error: {
          type: 'rate_limited', scope: 'input_tpm',
          message: 'Your uncached input-token throughput is exhausted for this minute.',
        } }));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = requests.length === 1
        ? { tool_calls: [{ index: 0, id: 'read-fixture', type: 'function', function: {
            name: 'read_file', arguments: JSON.stringify({ path: 'fixture.txt' }),
          } }] }
        : { content: 'The fixture was read successfully.' };
      response.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: requests.length === 1 ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 60_000, completion_tokens: 20, total_tokens: 60_020, prompt_tokens_details: { cached_tokens: requests.length === 1 ? 0 : 59_000 } } })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanupTasks.push(async () => {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
    const state = await createTempAutohandHome({ config: {
      provider: 'autohandai', features: { autohand_inference: true, automaticSpecialists: false, promptCaching: true },
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'fixture-only', baseUrl: `http://127.0.0.1:${address.port}`, model: 'grok-4.7' },
      network: { maxRetries: 1, retryDelay: 10 },
    } });
    cleanupTasks.push(state.cleanup);
    await writeFile(path.join(state.workspaceRoot, 'fixture.txt'), 'Please fix this parser by editing the code.');
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot,
      env: { AUTOHAND_AUTH_API_URL: `${auth.baseUrl}/api/auth` },
    });
    cleanupTasks.push(() => exitInteractive(session));
    await session.text({ timeout: 20_000, waitFor: text => text.includes('❯') });
    await session.type('Read fixture.txt');
    await session.press('enter');
    const completed = await session.text({ timeout: 20_000, waitFor: text => text.includes('The fixture was read successfully.') });
    expect(throttles).toBe(0);
    expect(requests).toHaveLength(2);
    expect(requests[1].tools).toEqual(requests[0].tools);
    expect(requests[0].tools.length).toBeLessThanOrEqual(128);
    expect(requests[0].prompt_cache_key).toMatch(/^ahpc_/);
    expect(requests[1].prompt_cache_key).toBe(requests[0].prompt_cache_key);
    expect(completed).not.toContain('Session failed');
  }, 60_000);

  it.each([false, true])('reports a safety rejection accurately without replaying it (SSE=%s)', async (streamingError) => {
    const auth = await createMockAuthServer();
    cleanupTasks.push(auth.close);
    let attempts = 0;
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stream?: boolean };
      if (!body.stream) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: { content: '{"complexity":"simple","requiresTools":false,"requiresPlanning":false,"suggestedApproach":"respond"}' }, finish_reason: 'stop' }] }));
        return;
      }
      attempts += 1;
      const rejection = { error: { type: 'content_blocked', categories: ['S7'], requestId: 'spotify-rejection-fixture' } };
      response.writeHead(streamingError ? 200 : 400, {
        'content-type': streamingError ? 'text/event-stream' : 'application/json',
        'x-autohand-request-id': 'spotify-rejection-fixture',
      });
      response.end(streamingError ? `data: ${JSON.stringify(rejection)}\n\n` : JSON.stringify(rejection));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanupTasks.push(async () => {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
    const state = await createTempAutohandHome({ config: {
      provider: 'autohandai', features: { autohand_inference: true, automaticSpecialists: false },
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'fixture-only', baseUrl: `http://127.0.0.1:${address.port}`, model: 'fantail' },
      network: { maxRetries: 1, retryDelay: 10 },
    } });
    cleanupTasks.push(state.cleanup);
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot,
      env: { AUTOHAND_AUTH_API_URL: `${auth.baseUrl}/api/auth`, AUTOHAND_DISABLE_COMPUTER_USE: '1' },
    });
    cleanupTasks.push(() => exitInteractive(session));
    await session.text({ timeout: 20_000, waitFor: text => text.includes('❯') });
    await session.type('Reply briefly without tools');
    await session.press('enter');
    const failed = await session.text({ timeout: 20_000, waitFor: text => text.includes('Session failed') });
    expect(failed).toContain('The safety check blocked this request.');
    expect(failed).toContain('S7 (Privacy)');
    expect(failed).toContain('spotify-rejection-fixture');
    expect(failed).not.toMatch(/malformed|Check \/usage|Attempting recovery/);
    expect(attempts).toBe(1);
  }, 60_000);

  it.each([
    { model: 'moa', accepted: false },
    { model: 'fantail', accepted: true },
  ])('stops a $model timeout without replaying the previous turn (accepted=$accepted)', async ({ model, accepted }) => {
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
      if (attempts.length === 2) {
        stalledResponse = response;
        if (accepted) {
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          response.flushHeaders();
        }
        return;
      }
      const content = 'Previous work is preserved.';
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
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'fixture-only', baseUrl: `http://127.0.0.1:${address.port}`, model },
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
    const failed = await session.text({ timeout: 20_000, waitFor: (text) => text.includes('Session failed') });
    expect(failed).toContain(accepted
      ? 'Inference stream stalled before completion.'
      : 'Request timed out waiting for Autohand AI to start a response');
    expect(failed).toContain('Check /usage before retrying');
    if (accepted) expect(failed).toContain('The accepted request was not replayed.');
    expect(failed).toMatch(/Request ID: [0-9a-f-]{36}/i);
    expect(failed).not.toContain('Attempting recovery');
    expect(failed).toContain('Previous work is preserved.');
    expect(attempts).toHaveLength(2);
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
