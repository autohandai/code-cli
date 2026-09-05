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
import { inspectAndCancelFixtureAgent, openAgentRunInspector } from '../../src/testing/scenarios/agentRunInspectorScenario.js';
import { createTempAutohandHome, exitInteractive, launchBuiltAutohand, type TuistoryTempState } from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    if (!session.isDead) {
      session.killProcess();
      await session.waitForExit(5_000);
    }
    session.close();
  }
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
  await Promise.all(states.splice(0).map((state) => state.cleanup()));
});

describe('Autohand AI native session agent inspector', () => {
  it('inspects native results and usage, cancels a running agent, retains history across a modal, and exits', async () => {
    const requests: Array<Record<string, unknown>> = [];
    let leadTurns = 0;
    let slowStarted = false;
    let slowAborted = false;
    const server = createServer(async (request, response) => {
      if (request.url !== '/chat/completions') { response.writeHead(404).end(); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const payload = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
      requests.push(payload);
      const messages = payload.messages as Array<{ role: string; content?: string }>;
      const system = messages.filter((message) => message.role === 'system').map((message) => message.content ?? '').join('\n');
      if (system.startsWith('INSPECTOR_SLOW')) {
        slowStarted = true;
        response.once('close', () => { slowAborted = true; });
        return;
      }
      if (system.startsWith('INSPECTOR_ERROR')) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Inspector fixture provider failure' } }));
        return;
      }
      const fast = system.startsWith('INSPECTOR_FAST');
      if (!fast) leadTurns += 1;
      const delegate = !fast && leadTurns === 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: `inspection-${requests.length}`, created: 1,
        choices: [{ index: 0, finish_reason: delegate ? 'tool_calls' : 'stop', message: {
          role: 'assistant', content: fast ? 'FAST_AGENT_PROOF' : delegate ? 'Starting the requested inspection workers.' : 'INSPECTOR_TURN_COMPLETE',
          ...(delegate ? { tool_calls: [{ id: 'delegate-inspection', type: 'function', function: {
            name: 'delegate_parallel', arguments: JSON.stringify({ tasks: ['fast', 'slow', 'error'].map((name) => ({
              agent_name: `inspector-${name}`, task: `Run ${name} inspection fixture`,
            })) }),
          } }] } : {}),
        } }], usage: { prompt_tokens: 42, completion_tokens: 12, total_tokens: 54 },
      }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Inspector server did not bind');
    const state = await createTempAutohandHome({ config: {
      provider: 'autohandai',
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-inspector', model: 'moa', baseUrl: `http://127.0.0.1:${address.port}` },
      features: { autohand_inference: true, automaticSpecialists: false },
      agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
      network: { maxRetries: 0, retryDelay: 0 },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    states.push(state);
    const squadDirectory = path.join(state.autohandHome, 'squad', 'runs');
    await fs.mkdir(squadDirectory, { recursive: true });
    await fs.writeFile(path.join(squadDirectory, 'inspector-external.json'), JSON.stringify({
      id: 'inspector-external', agentId: 'squad-fixture', workspace: state.workspaceRoot,
      prompt: 'Recorded independent Squad task', status: 'completed',
      createdAt: '2026-09-05T00:00:00.000Z', startedAt: '2026-09-05T00:00:01.000Z', completedAt: '2026-09-05T00:00:03.000Z',
      command: 'PRIVATE_COMMAND_MUST_NOT_APPEAR', logPath: 'PRIVATE_LOG_PATH_MUST_NOT_APPEAR',
    }));
    const inlineAgents = Object.fromEntries(['fast', 'slow', 'error'].map((name) => [`inspector-${name}`, {
      description: `Isolated inspector ${name} fixture`, prompt: `INSPECTOR_${name.toUpperCase()}`, tools: ['read_file'],
    }]));
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--agents', JSON.stringify(inlineAgents), '--yes'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, cols: 100, rows: 24, waitForDataTimeout: 15_000,
    });
    sessions.push(session);
    await session.waitForText('❯', { timeout: 20_000 });
    await session.type('Run the inspection fixture.');
    await session.press('enter');
    await vi.waitFor(() => expect(slowStarted).toBe(true), { timeout: 20_000 });
    const detail = await inspectAndCancelFixtureAgent(session);
    expect(detail).toContain('autohandai · moa');
    expect(detail).toContain('Parent:');
    await vi.waitFor(() => expect(slowAborted).toBe(true), { timeout: 10_000 });
    await session.press('escape');
    await session.text({ timeout: 5_000, waitFor: (text) => text.includes('Enter details') });
    await session.press('escape');
    await session.text({ timeout: 20_000, waitFor: (text) => text.includes('INSPECTOR_TURN_COMPLETE') && text.includes('❯') });
    expect(await session.text({ immediate: true })).not.toContain('HIDDEN_INSPECTOR_PASTE');
    await session.type('/agents help');
    await session.press('enter');
    await session.waitForText('Agent commands:', { timeout: 10_000 });
    expect(await session.text({ immediate: true })).toContain('/squad view');
    await session.type('/settings');
    await session.press('enter');
    await session.waitForText('Select a category:', { timeout: 10_000 });
    await session.press('escape');
    await session.waitForText('❯', { timeout: 10_000 });
    await openAgentRunInspector(session);
    const restored = await session.text({ immediate: true });
    expect(restored).toContain('inspector-fast · completed');
    expect(restored).toContain('inspector-slow · cancelled');
    expect(restored).toContain('inspector-error · failed');
    const fastRequest = requests.find((payload) => (payload.messages as Array<{ content?: string }>).some((message) => message.content?.startsWith('INSPECTOR_FAST')));
    expect(fastRequest?.tools).toEqual(expect.arrayContaining([expect.objectContaining({ function: expect.objectContaining({ name: 'read_file' }) })]));
    await session.press('escape');
    await session.type('/squad view');
    await session.text({ timeout: 10_000, waitFor: (text) => text.includes('/squad view') });
    await session.press('enter');
    await session.text({ timeout: 10_000, waitFor: (text) => text.includes('Squad runs · external') && text.includes('squad-fixture · completed') });
    const squadList = await session.text({ immediate: true });
    expect(squadList).toContain('0 active · 1 external');
    expect(squadList).not.toContain('inspector-fast · completed');
    await session.press('enter');
    const squadDetail = await session.text({ timeout: 10_000, waitFor: (text) => text.includes('Squad external (independent budget)') });
    expect(squadDetail).toContain('Usage unavailable');
    expect(squadDetail).toContain('Provider unavailable · model unavailable');
    expect(squadDetail.slice(squadDetail.lastIndexOf('Squad runs · external'))).not.toContain('c cancel');
    expect(session.readAll()).not.toContain('PRIVATE_COMMAND_MUST_NOT_APPEAR');
    expect(session.readAll()).not.toContain('PRIVATE_LOG_PATH_MUST_NOT_APPEAR');
    await exitInteractive(session);
    sessions.splice(sessions.indexOf(session), 1);
  }, 90_000);
});
