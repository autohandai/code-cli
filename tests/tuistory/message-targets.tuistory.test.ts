/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createServer, type Server } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'tuistory';
import { sendMessageWithColonTrigger } from '../../src/testing/scenarios/messageTargetScenario.js';
import { createTempAutohandHome, exitInteractive, launchBuiltAutohand, type TuistoryTempState } from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const state of states.splice(0)) await state.cleanup();
});

describe(': recipient trigger in the built CLI', () => {
  it('lists the live worker, sends it a message by name mid-turn, and the worker reads it on its next request', async () => {
    const followup = 'Acknowledge COLON_TARGET_FOLLOWUP in your final reply.';
    const workerRequests: Array<Array<{ role: string; content?: string }>> = [];
    const leadRequests: Array<Array<{ role: string; content?: string }>> = [];
    let releaseWorker: (() => void) | undefined;
    const server = createServer(async (request, response) => {
      if (request.url !== '/chat/completions') { response.writeHead(404).end(); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const payload = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
      const messages = payload.messages as Array<{ role: string; content?: string }>;
      const system = messages.filter((message) => message.role === 'system').map((message) => message.content ?? '').join('\n');
      const respond = (content: string, tool?: { name: string; args: Record<string, unknown> }) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          id: 'colon-target', created: 1,
          choices: [{ index: 0, finish_reason: tool ? 'tool_calls' : 'stop', message: {
            role: 'assistant', content,
            ...(tool ? { tool_calls: [{ id: `colon-${tool.name}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } : {}),
          } }], usage: { prompt_tokens: 42, completion_tokens: 12, total_tokens: 54 },
        }));
      };
      if (system.startsWith('COLON_WORKER')) {
        workerRequests.push(messages);
        if (workerRequests.length === 1) {
          releaseWorker = () => respond('Reading the fixture.', { name: 'read_file', args: { path: 'colon-proof.txt' } });
          return;
        }
        respond(messages.some((message) => message.role === 'user' && message.content === followup)
          ? 'WORKER_REPLY_ACKNOWLEDGED COLON_TARGET_FOLLOWUP'
          : 'WORKER_FOLLOWUP_MISSING');
        return;
      }
      leadRequests.push(messages);
      respond(leadRequests.length === 1 ? 'Starting the worker.' : 'COLON_TARGET_FLOW_COMPLETE', leadRequests.length === 1
        ? { name: 'delegate_task', args: { agent_name: 'colon-worker', task: 'Read the fixture and report.' } }
        : undefined);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Server did not bind');
    const state = await createTempAutohandHome({ config: {
      provider: 'autohandai',
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-colon', model: 'moa', baseUrl: `http://127.0.0.1:${address.port}` },
      features: { autohand_inference: true, automaticSpecialists: false },
      agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
      network: { maxRetries: 0, retryDelay: 0 },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    states.push(state);
    await fs.writeFile(path.join(state.workspaceRoot, 'colon-proof.txt'), 'COLON_PROOF_CONTENT\n');
    const inlineAgents = { 'colon-worker': { description: 'Worker that reads a fixture', prompt: 'COLON_WORKER', tools: ['read_file'] } };
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--agents', JSON.stringify(inlineAgents), '--yes'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, cols: 100, rows: 24, waitForDataTimeout: 15_000,
    });
    sessions.push(session);
    await session.waitForText('❯', { timeout: 20_000 });
    await session.type('Run the colon worker on the fixture.');
    await session.press('enter');
    await vi.waitFor(() => expect(workerRequests.length).toBe(1), { timeout: 20_000 });

    const receipt = await sendMessageWithColonTrigger(session, 'colon-worker', followup);
    expect(receipt).toContain('Message queued for colon-worker');
    expect(receipt).not.toContain('COLON_TARGET_FLOW_COMPLETE');

    releaseWorker?.();
    await session.text({ timeout: 20_000, waitFor: (text) => text.includes('COLON_TARGET_FLOW_COMPLETE') });
    expect(workerRequests).toHaveLength(2);
    expect(workerRequests[1]?.some((message) => message.role === 'user' && message.content === followup)).toBe(true);
    expect(leadRequests.flat().some((message) => message.role === 'user' && message.content?.includes('COLON_TARGET_FOLLOWUP'))).toBe(false);
    await exitInteractive(session);
  }, 90_000);
});
