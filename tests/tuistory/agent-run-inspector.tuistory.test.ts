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
import { inspectAndCancelFixtureAgent, inspectFixtureAgentProgress, inspectReadOnlyExternalAgent, messageAndCancelFixtureAgents, openAgentRunInspector } from '../../src/testing/scenarios/agentRunInspectorScenario.js';
import { MemoryManager } from '../../src/memory/MemoryManager.js';
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
  it('keeps workers out of the main screen, inspects live stages and results, cancels, restores history, and exits', async () => {
    const originalRequest = 'Run the inspection fixture. Review only; do not edit files.';
    const requests: Array<Record<string, unknown>> = [];
    let leadTurns = 0;
    let slowStarted = false;
    let slowAborted = false;
    let slowTurns = 0;
    let releaseSlowModel: (() => void) | undefined;
    let commandGatePath = '';
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
        slowTurns += 1;
        if (slowTurns === 1) {
          releaseSlowModel = () => {
            const commandScript = `const fs = require('node:fs'); const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(commandGatePath)})) { clearInterval(timer); process.stdout.write('COMMAND_STAGE_FINISHED'); } }, 25); setTimeout(() => process.exit(1), 20000).unref();`;
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({
              id: 'inspection-slow-command', created: 1,
              choices: [{ index: 0, finish_reason: 'tool_calls', message: {
                role: 'assistant', content: 'Waiting for the read-only fixture command.',
                tool_calls: [{ id: 'wait-inspector-command', type: 'function', function: {
                  name: 'run_command', arguments: JSON.stringify({ command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(commandScript)}` }),
                } }],
              } }], usage: { prompt_tokens: 42, completion_tokens: 12, total_tokens: 54 },
            }));
          };
        } else {
          response.once('close', () => { slowAborted = true; });
        }
        return;
      }
      if (system.startsWith('INSPECTOR_ERROR')) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Inspector fixture provider failure' } }));
        return;
      }
      const fast = system.startsWith('INSPECTOR_FAST');
      const read = fast && !messages.some(message => message.role === 'tool');
      if (!fast) leadTurns += 1;
      const delegate = !fast && leadTurns === 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: `inspection-${requests.length}`, created: 1,
        choices: [{ index: 0, finish_reason: delegate || read ? 'tool_calls' : 'stop', message: {
          role: 'assistant', content: fast ? 'FAST_AGENT_PROOF' : delegate ? 'Starting the requested inspection workers.' : 'INSPECTOR_TURN_COMPLETE',
          ...(read ? { tool_calls: [{ id: 'read-selected-workspace', type: 'function', function: {
            name: 'read_file', arguments: JSON.stringify({ path: 'repository-proof.txt' }),
          } }] } : {}),
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
    commandGatePath = path.join(state.workspaceRoot, 'inspector-command-gate');
    await fs.writeFile(path.join(state.workspaceRoot, 'repository-proof.txt'), 'SELECTED_REPOSITORY_CONTENT\n');
    await fs.writeFile(path.join(state.autohandHome, 'repository-proof.txt'), 'WRONG_LAUNCH_DIRECTORY_CONTENT\n');
    const squadDirectory = path.join(state.autohandHome, 'squad', 'runs');
    await fs.mkdir(squadDirectory, { recursive: true });
    await fs.writeFile(path.join(squadDirectory, 'inspector-external.json'), JSON.stringify({
      id: 'inspector-external', agentId: 'squad-fixture', workspace: state.workspaceRoot,
      prompt: 'Recorded independent Squad task', status: 'completed',
      createdAt: '2026-09-05T00:00:00.000Z', startedAt: '2026-09-05T00:00:01.000Z', completedAt: '2026-09-05T00:00:03.000Z',
      command: 'PRIVATE_COMMAND_MUST_NOT_APPEAR', logPath: 'PRIVATE_LOG_PATH_MUST_NOT_APPEAR',
    }));
    const inlineAgents = Object.fromEntries(['fast', 'slow', 'error'].map((name) => [`inspector-${name}`, {
      description: `Isolated inspector ${name} fixture`, prompt: `INSPECTOR_${name.toUpperCase()}`,
      tools: name === 'slow' ? ['run_command'] : ['read_file'],
    }]));
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--agents', JSON.stringify(inlineAgents), '--yes'], {
      autohandHome: state.autohandHome, cwd: state.autohandHome, cols: 100, rows: 24, waitForDataTimeout: 15_000,
    });
    sessions.push(session);
    await session.waitForText('❯', { timeout: 20_000 });
    await session.type(originalRequest);
    await session.press('enter');
    await vi.waitFor(() => expect(slowStarted).toBe(true), { timeout: 20_000 });
    const workerRequests = requests.filter(payload => (payload.messages as Array<{ role: string; content?: string }>).some(message => message.role === 'system' && message.content?.startsWith('INSPECTOR_')));
    expect(workerRequests.length).toBeGreaterThanOrEqual(2);
    for (const payload of workerRequests) {
      const messages = payload.messages as Array<{ role: string; content?: string }>;
      expect(messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'system', content: expect.stringContaining(state.workspaceRoot) }),
        expect.objectContaining({ role: 'user', content: `Original user request:\n${originalRequest}` }),
      ]));
    }
    const mainScreens = await inspectFixtureAgentProgress(session, () => {
      if (!releaseSlowModel) throw new Error('Slow model fixture has not started');
      releaseSlowModel();
    }, () => fs.writeFile(commandGatePath, 'continue\n'));
    for (const frame of [mainScreens.before, mainScreens.after]) {
      expect(frame).not.toContain('Workers ·');
      expect(frame).not.toMatch(/^[▣□■✕]\s+inspector-\w+: Run /m);
    }
    await vi.waitFor(() => expect(slowTurns).toBe(2));
    expect(slowAborted).toBe(false);
    const detail = await inspectAndCancelFixtureAgent(session);
    expect(detail).toContain('autohandai · moa');
    expect(detail).toContain('Parent:');
    expect(detail).toContain('Workspace:');
    expect(detail.replace(/\s+/g, '')).toContain(state.workspaceRoot.replace(/\s+/g, ''));
    expect(detail).toContain('User request:');
    expect(detail).not.toContain('🤖');
    await vi.waitFor(() => {
      const observations = requests.filter(payload => (payload.messages as Array<{ content?: string }>).some(message => message.content?.startsWith('INSPECTOR_FAST')))
        .flatMap(payload => (payload.messages as Array<{ role: string; content?: string }>).filter(message => message.role === 'tool').map(message => message.content));
      expect(observations.join('\n')).toContain('SELECTED_REPOSITORY_CONTENT');
      expect(observations.join('\n')).not.toContain('WRONG_LAUNCH_DIRECTORY_CONTENT');
    });
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

  it('messages only the selected live worker, shares project lessons, saves an authorized lesson, and keeps external runs read-only', async () => {
    const projectLesson = 'Use Bun through the package test script when checking this repository.';
    const wrongProjectLesson = 'WRONG_REPOSITORY_LESSON_MUST_NOT_APPEAR';
    const savedLesson = 'Native provider fixtures must stay local and never contact an external service.';
    const originalRequest = `Run the interaction reader read-only. Authorize only the interaction writer to save this project lesson with save_memory: ${savedLesson}`;
    const followup = 'Acknowledge ONLY_WRITER_FOLLOWUP in your final reply.';
    const workerRequests = new Map<string, Array<Array<{ role: string; content?: string }>>>();
    let releaseReader: (() => void) | undefined;
    let releaseWriter: (() => void) | undefined;
    let readerAborted = false;
    let leadTurns = 0;
    const server = createServer(async (request, response) => {
      if (request.url !== '/chat/completions') { response.writeHead(404).end(); return; }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const payload = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
      const messages = payload.messages as Array<{ role: string; content?: string }>;
      const system = messages.filter((message) => message.role === 'system').map((message) => message.content ?? '').join('\n');
      const worker = system.startsWith('INTERACTION_READER') ? 'reader' : system.startsWith('INTERACTION_WRITER') ? 'writer' : undefined;
      const respond = (content: string, tool?: { name: string; args: Record<string, unknown> }) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          id: `interaction-${worker ?? 'lead'}`, created: 1,
          choices: [{ index: 0, finish_reason: tool ? 'tool_calls' : 'stop', message: {
            role: 'assistant', content,
            ...(tool ? { tool_calls: [{ id: `interaction-${tool.name}`, type: 'function', function: {
              name: tool.name, arguments: JSON.stringify(tool.args),
            } }] } : {}),
          } }], usage: { prompt_tokens: 42, completion_tokens: 12, total_tokens: 54 },
        }));
      };
      if (worker) {
        const history = workerRequests.get(worker) ?? [];
        history.push(messages);
        workerRequests.set(worker, history);
        if (history.length === 1) {
          if (worker === 'reader') releaseReader = () => respond('Reading the fixture.', { name: 'read_file', args: { path: 'interaction-proof.txt' } });
          else releaseWriter = () => respond('Saving the explicitly authorized lesson.', { name: 'save_memory', args: { fact: savedLesson, level: 'project' } });
        } else if (worker === 'reader') {
          response.once('close', () => { readerAborted = true; });
        } else {
          respond(messages.some((message) => message.role === 'user' && message.content === followup)
            ? 'WRITER_REPLY_ACKNOWLEDGED ONLY_WRITER_FOLLOWUP'
            : 'WRITER_FOLLOWUP_MISSING');
        }
        return;
      }
      leadTurns += 1;
      respond(leadTurns === 1 ? 'Starting the interaction fixtures.' : 'INTERACTION_TURN_COMPLETE', leadTurns === 1 ? {
        name: 'delegate_parallel', args: { tasks: [
          { agent_name: 'interaction-reader', task: 'Read the fixture without writing or saving memory.' },
          { agent_name: 'interaction-writer', task: `Save this authorized project lesson: ${savedLesson}` },
        ] },
      } : undefined);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Interaction server did not bind');
    const state = await createTempAutohandHome({ config: {
      provider: 'autohandai',
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-interaction', model: 'moa', baseUrl: `http://127.0.0.1:${address.port}` },
      features: { autohand_inference: true, automaticSpecialists: false },
      agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
      network: { maxRetries: 0, retryDelay: 0 },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    states.push(state);
    const memory = new MemoryManager(state.workspaceRoot, { userMemoryDir: path.join(state.autohandHome, 'memory') });
    const wrongMemory = new MemoryManager(state.autohandHome, { userMemoryDir: path.join(state.autohandHome, 'memory') });
    await memory.store(projectLesson, 'project');
    await wrongMemory.store(wrongProjectLesson, 'project');
    await fs.writeFile(path.join(state.workspaceRoot, 'interaction-proof.txt'), 'READ_ONLY_INTERACTION_PROOF\n');
    const squadDirectory = path.join(state.autohandHome, 'squad', 'runs');
    await fs.mkdir(squadDirectory, { recursive: true });
    await fs.writeFile(path.join(squadDirectory, 'interaction-external.json'), JSON.stringify({
      id: 'interaction-external', agentId: 'external-readonly', workspace: state.workspaceRoot,
      prompt: 'Recorded external fixture', status: 'completed',
      createdAt: '2026-09-05T00:00:00.000Z', startedAt: '2026-09-05T00:00:01.000Z', completedAt: '2026-09-05T00:00:03.000Z',
    }));
    const inlineAgents = {
      'interaction-reader': { description: 'Read-only interaction fixture', prompt: 'INTERACTION_READER', tools: ['read_file'] },
      'interaction-writer': { description: 'Authorized project lesson fixture', prompt: 'INTERACTION_WRITER', tools: ['save_memory'] },
    };
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--agents', JSON.stringify(inlineAgents), '--yes'], {
      autohandHome: state.autohandHome, cwd: state.autohandHome, cols: 100, rows: 24, waitForDataTimeout: 15_000,
    });
    sessions.push(session);
    await session.waitForText('❯', { timeout: 20_000 });
    await session.type(originalRequest);
    await session.press('enter');
    await vi.waitFor(() => {
      expect(releaseReader).toBeDefined();
      expect(releaseWriter).toBeDefined();
    }, { timeout: 20_000 });
    for (const history of workerRequests.values()) {
      const system = history[0]?.filter((message) => message.role === 'system').map((message) => message.content ?? '').join('\n') ?? '';
      expect(system).toContain('## Project lessons');
      expect(system).toContain(projectLesson);
      expect(system).toContain(path.join(state.workspaceRoot, '.autohand', 'memory'));
      expect(system).not.toContain(wrongProjectLesson);
    }
    const { receipt, reply } = await messageAndCancelFixtureAgents(session, followup, () => {
      if (!releaseReader || !releaseWriter) throw new Error('Interaction workers have not started');
      releaseReader();
      releaseWriter();
    });
    expect(receipt).toContain('Message queued for next model request.');
    expect(receipt).not.toMatch(/message (?:read|delivered)/i);
    expect(reply).toContain('WRITER_REPLY_ACKNOWLEDGED ONLY_WRITER_FOLLOWUP');
    expect(workerRequests.get('writer')?.[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: followup }),
      expect.objectContaining({ role: 'tool', content: expect.stringContaining('Saved to project memory:') }),
    ]));
    expect(workerRequests.get('reader')).toHaveLength(2);
    expect(JSON.stringify(workerRequests.get('reader'))).not.toContain('ONLY_WRITER_FOLLOWUP');
    await vi.waitFor(() => expect(readerAborted).toBe(true));
    expect((await memory.list('project')).map((entry) => entry.content)).toEqual(expect.arrayContaining([projectLesson, savedLesson]));
    expect((await wrongMemory.list('project')).map((entry) => entry.content)).toEqual([wrongProjectLesson]);
    const external = await inspectReadOnlyExternalAgent(session);
    for (const frame of [external.list, external.detail]) {
      expect(frame).not.toContain('m message');
      expect(frame).not.toContain('c cancel');
      expect(frame).not.toContain('Message external-readonly');
    }
    await exitInteractive(session);
    sessions.splice(sessions.indexOf(session), 1);
  }, 90_000);
});
