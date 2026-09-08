/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createServer, type Server, type ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'tuistory';
import {
  inspectNativeTeamAndNestedRun, inspectNativeTeamFailureAndCancel, inspectNativeTeamCommandStatus,
} from '../../src/testing/scenarios/nativeTeamInspectorScenario.js';
import { createTempAutohandHome, exitInteractive, launchBuiltAutohand, type TuistoryTempState } from './helpers/autohandTuistory.js';

interface NativeRequest {
  model?: string;
  messages?: Array<{ role?: string; content?: unknown }>;
  tools?: Array<{ function?: { name?: string } }>;
}

interface ToolCall { name: string; args: Record<string, unknown> }

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

function nativeResponse(response: ServerResponse, id: string, content: string, tool?: ToolCall): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    id, created: 1,
    choices: [{ index: 0, finish_reason: tool ? 'tool_calls' : 'stop', message: {
      role: 'assistant', content: tool ? JSON.stringify({
        thought: content,
        reflection: 'The previous team tool result is available and supports the next requested fixture step.',
      }) : content,
      ...(tool ? { tool_calls: [{ id: `call-${id}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } : {}),
    } }], usage: { prompt_tokens: 42, completion_tokens: 12, total_tokens: 54 },
  }));
}

describe('Autohand AI native team IPC inspector', () => {
  it('tracks nested results, native failures, and confirmed cancellation through real teammate processes', async () => {
    const originalRequest = 'Create the native team fixture and run its three tasks. Do not edit files.';
    const requests: NativeRequest[] = [];
    let leadTurns = 0;
    let parentTurns = 0;
    let nestedStarted = false;
    let nestedAborted = false;
    let teamCancellationStarted = false;
    let teamCancellationAborted = false;
    const leadTools: ToolCall[] = [
      { name: 'create_team', args: { name: 'native-team-fixture' } },
      { name: 'add_teammate', args: { name: 'native-member', agent_name: 'native-parent', provider: 'autohandai', model: 'moa' } },
      { name: 'create_task', args: { subject: 'Nested team task', description: 'TEAM_NESTED_TASK: delegate to native-nested and report its result.' } },
      { name: 'create_task', args: { subject: 'Failure team task', description: 'TEAM_FAILURE_TASK: report the fixture failure.', blocked_by: ['task-1'] } },
      { name: 'create_task', args: { subject: 'Cancel team task', description: 'TEAM_CANCEL_TASK: wait for explicit cancellation.' } },
    ];
    const server = createServer(async (request, response) => {
      if (request.url !== '/chat/completions' || request.method !== 'POST') { response.writeHead(404).end(); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const payload = JSON.parse(Buffer.concat(chunks).toString()) as NativeRequest;
      requests.push(payload);
      const system = payload.messages?.filter((message) => message.role === 'system')
        .map((message) => typeof message.content === 'string' ? message.content : '').join('\n') ?? '';
      if (system.startsWith('NATIVE_NESTED_FIXTURE')) {
        nestedStarted = true;
        response.once('close', () => { nestedAborted = true; });
        return;
      }
      if (system.startsWith('NATIVE_PARENT_FIXTURE')) {
        const task = payload.messages?.find(message => message.role === 'user'
          && typeof message.content === 'string' && message.content.startsWith('TEAM_'))?.content;
        if (typeof task === 'string' && task.includes('TEAM_FAILURE_TASK')) {
          response.writeHead(400, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: { message: 'TEAM_NATIVE_FAILURE', type: 'invalid_request_error' } }));
          return;
        }
        if (typeof task === 'string' && task.includes('TEAM_CANCEL_TASK')) {
          teamCancellationStarted = true;
          response.once('close', () => { teamCancellationAborted = true; });
          return;
        }
        parentTurns += 1;
        nativeResponse(response, `parent-${parentTurns}`, parentTurns === 1 ? 'Delegating the nested fixture.' : 'TEAM_PARENT_COMPLETED',
          parentTurns === 1 ? { name: 'delegate_task', args: { agent_name: 'native-nested', task: 'Run the nested inspection fixture.' } } : undefined);
        return;
      }
      const tool = leadTools[leadTurns++];
      nativeResponse(response, `lead-${leadTurns}`, tool ? 'Continuing the requested team setup.' : 'NATIVE_TEAM_BACKGROUND_READY', tool);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Native team server did not bind');
    const state = await createTempAutohandHome({ config: {
      provider: 'autohandai',
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-native-team', model: 'moa', baseUrl: `http://127.0.0.1:${address.port}` },
      features: { autohand_inference: true, automaticSpecialists: false },
      agent: { autoMemory: false, maxIterations: 12, sessionRetryLimit: 0 },
      network: { maxRetries: 0, retryDelay: 0 },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    states.push(state);
    const agentsDirectory = path.join(state.autohandHome, 'agents');
    await fs.mkdir(agentsDirectory, { recursive: true });
    await fs.writeFile(path.join(agentsDirectory, 'native-parent.json'), JSON.stringify({
      description: 'Native parent inspection fixture', systemPrompt: 'NATIVE_PARENT_FIXTURE',
      tools: ['read_file', 'delegate_task'], model: 'definition-model-must-not-win',
    }));
    await fs.writeFile(path.join(agentsDirectory, 'native-nested.json'), JSON.stringify({
      description: 'Native nested inspection fixture', systemPrompt: 'NATIVE_NESTED_FIXTURE', tools: ['read_file'],
    }));
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes'], {
      autohandHome: state.autohandHome, cwd: state.autohandHome, cols: 100, rows: 28, waitForDataTimeout: 15_000,
    });
    sessions.push(session);
    await session.waitForText('❯', { timeout: 20_000 });
    await session.type(originalRequest);
    await session.press('enter');
    await vi.waitFor(() => expect(nestedStarted, JSON.stringify({
      leadTurns, parentTurns,
      requests: requests.map((payload) => ({ model: payload.model,
        system: payload.messages?.filter((message) => message.role === 'system').map((message) => typeof message.content === 'string' ? message.content.slice(0, 70) : ''),
        tools: payload.tools?.map((tool) => tool.function?.name).filter((name) => name?.includes('delegate')),
      })), terminal: session.readAll().slice(-16000),
    })).toBe(true), { timeout: 30_000 });
    const workerRequests = requests.filter(payload => payload.messages?.some(message => message.role === 'system'
      && typeof message.content === 'string' && /^NATIVE_(PARENT|NESTED)_FIXTURE/.test(message.content)));
    expect(workerRequests.length).toBeGreaterThanOrEqual(2);
    for (const payload of workerRequests) {
      expect(payload.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'system', content: expect.stringContaining(state.workspaceRoot) }),
        expect.objectContaining({ role: 'user', content: `Original user request:\n${originalRequest}` }),
      ]));
    }
    const initial = await inspectNativeTeamAndNestedRun(session);
    expect(initial.parent).toContain('autohandai · moa');
    expect(initial.parent).not.toContain('independent budget');
    expect(initial.nested).toMatch(/Parent: team-task:[a-f0-9-]+/);
    expect(initial.nested).toContain('autohandai · moa');
    for (const detail of [initial.parent, initial.nested]) {
      expect(detail).toContain('Workspace:');
      expect(detail.replace(/\s+/g, '')).toContain(state.workspaceRoot.replace(/\s+/g, ''));
      expect(detail).toContain('User request:');
      expect(detail).not.toContain('🤖');
    }
    await vi.waitFor(() => expect(nestedAborted).toBe(true), { timeout: 10_000 });
    await vi.waitFor(() => expect(teamCancellationStarted).toBe(true), { timeout: 20_000 });
    const outcomes = await inspectNativeTeamFailureAndCancel(session);
    expect(outcomes.completed).toContain('108 tokens');
    expect(outcomes.failed).toContain('TEAM_NATIVE_FAILURE');
    expect(outcomes.cancelled).not.toContain('waiting for agent to stop');
    await vi.waitFor(() => expect(teamCancellationAborted).toBe(true), { timeout: 10_000 });
    const commands = await inspectNativeTeamCommandStatus(session);
    expect(commands.help).toContain('/agents view');
    expect(commands.status).toContain('1/3 completed');
    const parentRequests = requests.filter((payload) => payload.messages?.some((message) => typeof message.content === 'string' && message.content.startsWith('NATIVE_PARENT_FIXTURE')));
    expect(parentRequests.length).toBeGreaterThanOrEqual(4);
    expect(parentRequests.every((payload) => payload.model === 'moa')).toBe(true);
    expect(parentRequests[0].tools).toEqual(expect.arrayContaining([expect.objectContaining({ function: expect.objectContaining({ name: 'delegate_task' }) })]));
    await exitInteractive(session);
    sessions.splice(sessions.indexOf(session), 1);
  }, 120_000);
});
