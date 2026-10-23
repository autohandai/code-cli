import { describe, expect, it, vi } from 'vitest';
import { createServer, type ServerResponse } from 'node:http';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Session } from 'tuistory';
import {
  pendingQueueSnapshot, requestGitStatus, startQueuedSteeringTurn, steerPendingMessage,
} from '../../src/testing/scenarios/queuedSteeringScenario.js';
import {
  createMockAuthServer, createTempAutohandHome, exitInteractive, launchBuiltAutohand,
} from './helpers/autohandTuistory.js';

interface RecordedRequest {
  messages: Array<{ role: string; content: unknown; tool_call_id?: string; name?: string }>;
  stream?: boolean;
}

async function createNativeFixture(
  reply: (index: number, response: ServerResponse) => Promise<void> | void,
) {
  const requests: RecordedRequest[] = [], requestIds: Array<string | undefined> = [];
  const server = createServer(async (request, response) => {
    if (request.url !== '/chat/completions') { response.writeHead(404).end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RecordedRequest;
    requests.push(body);
    const id = request.headers['x-autohand-client-request-id'];
    requestIds.push(Array.isArray(id) ? id[0] : id);
    await reply(requests.length, response);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
  return {
    requests, requestIds, baseUrl: 'http://127.0.0.1:' + address.port,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

function jsonReply(response: ServerResponse, content: string, tool?: { id: string; name: string; args: object }) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    choices: [{ message: { content, ...(tool ? { tool_calls: [{
      id: tool.id, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) },
    }] } : {}) }, finish_reason: tool ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  }));
}

const event = (delta: unknown, finish: string | null = null) => 'data: ' + JSON.stringify({
  choices: [{ delta, finish_reason: finish }],
  usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
}) + '\n\n';

function statusStream(response: ServerResponse, incomplete: boolean) {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const name = incomplete ? 'write_file' : 'run_command';
  const args = incomplete
    ? { path: 'incomplete-must-not-run.txt', contents: 'This incomplete tool must never execute' }
    : { command: 'git status --short' };
  response.write(event({ content: 'Run git status to confirm everything is clean', tool_calls: [
    { index: 0, ...(incomplete ? {} : { id: 'status-call' }), type: 'function', function: { name, arguments: '' } },
  ] }));
  response.write(event({ tool_calls: [{ index: 0, id: '', function: { arguments: JSON.stringify(args) } }] }));
  response.end(event({ tool_calls: [{ index: 0, id: null, function: { arguments: '' } }] }, 'tool_calls') + 'data: [DONE]\n\n');
}

const ui = { promptSuggestions: false, showCompletionNotification: false, terminalBell: false };
async function fixtureState(baseUrl: string, fullScreen = false) {
  return createTempAutohandHome({ config: {
    provider: 'autohandai',
    features: { autohand_inference: true, automaticSpecialists: false, fullScreenMode: fullScreen },
    autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'fixture-only', baseUrl, model: 'fantail', orchestration: false },
    search: { provider: 'browser-profile' },
    agent: { autoMemory: false, maxIterations: 6, sessionRetryLimit: 0, enableRequestQueue: true },
    network: { maxRetries: 2, retryDelay: 1 }, ui,
  } });
}

async function persistedUserMessages(home: string): Promise<string[]> {
  const root = path.join(home, 'sessions');
  const directories = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory());
  const histories = await Promise.all(directories.map(entry => readFile(path.join(root, entry.name, 'conversation.jsonl'), 'utf8')));
  return histories.flatMap(history => history.split('\n').filter(Boolean).map(line => JSON.parse(line) as { role?: string; content?: unknown }))
    .filter(message => message.role === 'user' && typeof message.content === 'string')
    .map(message => String(message.content));
}

describe('queued steering and streamed tool-call recovery in the built CLI', () => {
  it.each([
    { sequence: '\x1b[13;5u', selected: false, fullScreen: false },
    { sequence: '\x1b[27;5;13~', selected: true, fullScreen: false },
    { sequence: '\x1b[13;5u', selected: false, fullScreen: true },
    { sequence: '\x1b[27;5;13~', selected: true, fullScreen: true },
  ])('steers queued input into the active request sequence: %j', async options => {
    let releaseFirst = () => {};
    const first = new Promise<void>(resolve => { releaseFirst = resolve; });
    const server = await createNativeFixture(async (index, response) => {
      if (index === 1) {
        await first;
        if (!response.destroyed) jsonReply(response, 'Reading repository facts.', { id: 'queue-read', name: 'read_file', args: { path: 'package.json' } });
      } else jsonReply(response, index === 2 ? 'ACTIVE_TURN_FINISHED' : 'QUEUED_TURN_FINISHED');
    });
    const auth = await createMockAuthServer();
    const state = await fixtureState(server.baseUrl, options.fullScreen);
    let session: Session | undefined;
    try {
      session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes'], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot,
        env: { AUTOHAND_AUTH_API_URL: auth.baseUrl + '/api/auth' }, cols: 120, rows: 42,
      });
      await startQueuedSteeringTurn(session);
      expect(session.getRawOutput()).toContain('\x1b[>1u');
      if (options.fullScreen) expect(session.getRawOutput().includes('\x1b[?1049h')).toBe(true);
      await vi.waitFor(() => expect(server.requests).toHaveLength(1), { timeout: 15_000 });
      const screen = await steerPendingMessage(session, options);
      if (options.fullScreen) {
        const lines = (await session.text()).split('\n');
        const composerRow = lines.findLastIndex(line => line.trimStart().startsWith('❯'));
        expect(composerRow).toBeGreaterThanOrEqual(session.currentRows - 7);
        expect(composerRow).toBeLessThan(session.currentRows);
      }
      expect(pendingQueueSnapshot(screen)).toMatchInlineSnapshot(`
        [
          "Queue · 1 pending · ctrl+enter steer next",
          "1. QUEUE_LATER: leave this for the following turn",
        ]
      `);
      expect(JSON.stringify(server.requests[0].messages)).not.toContain('STEER_NOW');
      expect(session.getRawOutput()).not.toContain('Steering the running turn; the model reads it on its next request.');
      releaseFirst();
      await session.waitForText('ACTIVE_TURN_FINISHED', { timeout: 20_000 });
      await session.waitForText('QUEUED_TURN_FINISHED', { timeout: 20_000 });
      const second = server.requests[1].messages;
      expect(second.filter(message => message.role === 'user' && String(message.content).includes('STEER_NOW'))).toHaveLength(1);
      expect(JSON.stringify(second)).not.toContain('QUEUE_LATER');
      expect(server.requests).toHaveLength(3);
      expect(JSON.stringify(server.requests)).not.toContain('KEEP_THIS_DRAFT');
      await exitInteractive(session);
      expect(session.getRawOutput()).toContain('\x1b[<u');
      if (options.fullScreen) expect(session.getRawOutput().includes('\x1b[?1049l')).toBe(true);
      const messages = await persistedUserMessages(state.autohandHome);
      expect(messages.filter(message => message.includes('STEER_NOW'))).toHaveLength(1);
      expect(messages.filter(message => message.includes('QUEUE_LATER'))).toHaveLength(1);
    } finally {
      releaseFirst(); session?.close(); await session?.waitForExit(5000);
      await server.close(); await auth.close(); await state.cleanup();
    }
  });

  it.each([false, true])('finishes the reported Fantail git-status turn without replaying an accepted request; missing header=%s', async incomplete => {
    const server = await createNativeFixture((index, response) => {
      if (index === 1) statusStream(response, incomplete);
      else if (incomplete && index === 2) jsonReply(response, 'Checking the status safely.', {
        id: 'status-call', name: 'run_command', args: { command: 'git status --short' },
      });
      else jsonReply(response, 'REPOSITORY_RESULT: package.json is untracked; the working tree is not clean.');
    });
    const auth = await createMockAuthServer();
    const state = await fixtureState(server.baseUrl);
    let session: Session | undefined;
    try {
      session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes'], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot,
        env: { AUTOHAND_AUTH_API_URL: auth.baseUrl + '/api/auth' },
      });
      await requestGitStatus(session);
      await session.waitForText('REPOSITORY_RESULT', { timeout: 25_000 });
      expect(session.getRawOutput()).not.toContain('Incomplete streamed tool call.');
      expect(session.getRawOutput()).not.toContain('Session failed');
      expect(server.requests).toHaveLength(incomplete ? 3 : 2);
      expect(new Set(server.requestIds).size).toBe(server.requests.length);
      const final = server.requests.at(-1)!;
      const results = final.messages.filter(message => message.role === 'tool' && message.tool_call_id === 'status-call');
      expect(results).toHaveLength(1);
      expect(JSON.stringify(results)).toContain('package.json');
      if (incomplete) expect(JSON.stringify(server.requests[1].messages)).toContain('Recovery 1/3');
      await expect(access(path.join(state.workspaceRoot, 'incomplete-must-not-run.txt'))).rejects.toThrow();
      await exitInteractive(session);
    } finally {
      session?.close(); await session?.waitForExit(5000);
      await server.close(); await auth.close(); await state.cleanup();
    }
  });

  it('stops persistent incomplete headers at the existing recovery limit without executing tools', async () => {
    const server = await createNativeFixture((_index, response) => statusStream(response, true));
    const auth = await createMockAuthServer();
    const state = await fixtureState(server.baseUrl);
    let session: Session | undefined;
    try {
      session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes'], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot,
        env: { AUTOHAND_AUTH_API_URL: auth.baseUrl + '/api/auth' },
      });
      await requestGitStatus(session);
      await session.waitForText('truncated 3 consecutive responses', { timeout: 25_000 });
      await session.waitForText('Failed in', { timeout: 10_000 });
      expect(server.requests).toHaveLength(3);
      expect(new Set(server.requestIds).size).toBe(3);
      expect(session.getRawOutput()).not.toContain('Incomplete streamed tool call.');
      await expect(access(path.join(state.workspaceRoot, 'incomplete-must-not-run.txt'))).rejects.toThrow();
      await exitInteractive(session);
    } finally {
      session?.close(); await session?.waitForExit(5000);
      await server.close(); await auth.close(); await state.cleanup();
    }
  });
});
