/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { createTempAutohandHome, launchBuiltAutohand, waitForExit } from './helpers/autohandTuistory.js';

interface WireRequest {
  messages: Array<{ role: string; content: string }>;
}

describe('reviewed command completion', () => {
  it('keeps the candidate private until approval and emits exactly one confirmed result', async () => {
    const approval = Promise.withResolvers<void>();
    let reviewStarted = false;
    let commands = 0;
    const server = createServer((request, response) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString()) as WireRequest;
        const reviewing = body.messages.some(message => message.role === 'system' && message.content.includes('independent Moa advisor'));
        if (reviewing) {
          reviewStarted = true;
          await approval.promise;
        }
        const tool = !reviewing && !body.messages.some(message => message.role === 'tool');
        if (tool) commands++;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ id: 'completion-review-fixture', choices: [{ index: 0,
          finish_reason: tool ? 'tool_calls' : 'stop', message: { role: 'assistant',
            content: reviewing ? '{"verdict":"approved","feedback":"Command result verified."}' : tool ? '' : '400000',
            ...(tool ? { tool_calls: [{ id: 'call_bounded_command', type: 'function', function: {
              name: 'run_command', arguments: JSON.stringify({ command: 'seq 1 400000' }),
            } }] } : {}),
          } }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }));
      })().catch(error => { response.writeHead(500).end(String(error)); });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server did not bind');
    const state = await createTempAutohandHome({ config: {
      provider: 'autohandai', autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'fixture', model: 'moa', orchestration: true, baseUrl: `http://127.0.0.1:${address.port}` },
      features: { automaticSpecialists: false }, agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
      network: { maxRetries: 0, retryDelay: 0 }, ui: { promptSuggestions: false },
    } });
    const session = await launchBuiltAutohand(['--config', state.configPath, '--no-daemon', '--yes', '--allowed-tools', 'run_command',
      '--output-format', 'stream-json', '-p', 'Run seq 1 400000 once and reply with exactly 400000.'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot,
    });
    try {
      await vi.waitFor(() => expect(reviewStarted).toBe(true), { timeout: 20000 });
      expect(session.getRawOutput()).not.toContain('"type":"result"');
      approval.resolve();
      await waitForExit(session, 20000);
      const results = session.getRawOutput().split('\n').flatMap(line => {
        try { const event: unknown = JSON.parse(line); return event && typeof event === 'object' && 'type' in event && event.type === 'result' ? [event] : []; }
        catch { return []; }
      });
      expect(results).toEqual([expect.objectContaining({ type: 'result', content: '400000' })]);
      expect(commands).toBe(1);
      expect(session.exitInfo?.exitCode).toBe(0);
      expect(session.getRawOutput()).not.toContain('Draft —');
    } finally {
      approval.resolve();
      session.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await state.cleanup();
    }
  });
});
