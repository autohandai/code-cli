import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'tuistory';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import type { HookDefinition } from '../../src/types.js';
import { StdioDriver } from '../../src/testing/drivers/stdio-driver.js';
import { programStatusReports } from '../../src/testing/assertions/programStatus.js';
import { submitProgramStatusPrompt } from '../../src/testing/scenarios/programStatusScenario.js';
import { createTempAutohandHome, createMockAutohandAINativeSequenceServer, launchBuiltAutohand,
  createMockAuthServer, exitInteractive, waitForExit, type MockAuthServer, type TuistoryTempState, type MockNativeToolServer, type MockNativeAssistantTurn } from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
const servers: MockNativeToolServer[] = [];
const drivers: StdioDriver[] = [];
const authServers: MockAuthServer[] = [];
afterEach(async () => {
  for (const driver of drivers.splice(0)) { driver.close(); await driver.waitForExit(); }
  for (const session of sessions.splice(0)) { session.close(); await waitForExit(session); }
  await Promise.all(servers.splice(0).map(server => server.close()));
  await Promise.all(authServers.splice(0).map(server => server.close()));
  await Promise.all(states.splice(0).map(state => state.cleanup()));
});

async function launch(turns: MockNativeAssistantTurn[], extraArgs: string[] = [], auth = true,
  prepare?: (state: TuistoryTempState) => Promise<void>, hooks: HookDefinition[] = []) {
  const server = await createMockAutohandAINativeSequenceServer(turns);
  servers.push(server);
  const state = await createTempAutohandHome({ config: {
    provider: 'autohandai',
    autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'test-key', model: 'moa', baseUrl: server.baseUrl },
    ...(auth ? {} : { auth: { token: null, user: null } }),
    features: { autohand_inference: true }, hooks: { enabled: hooks.length > 0, hooks },
    agent: { autoMemory: false, sessionRetryLimit: 0 }, network: { maxRetries: 0 },
    ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
  } });
  states.push(state);
  await prepare?.(state);
  const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, ...extraArgs], {
    autohandHome: state.autohandHome, cwd: state.workspaceRoot, rows: 40,
  });
  sessions.push(session);
  return { session, state, server };
}

describe('OSC7501 built terminal lifecycle', () => {
  it('reports permission and generic menu waits while preserving keyboard navigation', async () => {
    const { session } = await launch([
      { content: 'I will write the fixture.', toolCall: { id: 'write-proof', name: 'write_file', args: { path: 'proof.txt', contents: 'Proof' } } },
      { content: 'PERMISSION_STATUS_COMPLETE' },
    ]);
    await submitProgramStatusPrompt(session, 'Write the proof file');
    await vi.waitFor(() => expect(programStatusReports(session)).toContainEqual(expect.objectContaining({ state: 'blocked', kind: 'permission' })), { timeout: 15_000 });
    await session.press('down');
    await session.press('up');
    await session.press('enter');
    await session.waitForText('PERMISSION_STATUS_COMPLETE');
    await vi.waitFor(() => expect(programStatusReports(session).at(-1)?.state).toBe('done'));
    const after = session.getRawOutput().length;
    await submitProgramStatusPrompt(session, '/hooks');
    await session.waitForText('Lifecycle hooks from config');
    expect(programStatusReports(session, after)).toContainEqual(expect.objectContaining({ state: 'blocked', kind: 'question' }));
    await session.press('down');
    await session.press('up');
    await session.press('escape');
    await exitInteractive(session);
    expect(programStatusReports(session).at(-1)?.state).toBe('clear');
  }, 60_000);

  it('returns to idle after Escape during a hook and accepts the next instruction', async () => {
    const { session, state, server } = await launch([{ content: 'CANCEL_STATUS_RECOVERED' }], ['--yes'], true, async state => {
      await writeFile(path.join(state.workspaceRoot, 'wait-hook.cjs'),
        "let data=''; process.stdin.on('data', chunk => data += chunk); process.stdin.on('end', () => { if (JSON.parse(data).instruction === 'cancel operation') { require('fs').writeFileSync('hook-started', 'ready'); setTimeout(() => {}, 30000); } });");
    }, [{ event: 'pre-prompt', command: 'node wait-hook.cjs', timeout: 35_000 }]);
    await submitProgramStatusPrompt(session, 'cancel operation');
    await vi.waitFor(async () => expect(await readFile(path.join(state.workspaceRoot, 'hook-started'), 'utf8')).toBe('ready'), { timeout: 15_000 });
    await session.press('escape');
    await vi.waitFor(() => expect(programStatusReports(session).at(-1)?.state).toBe('idle'));
    expect(server.requests).toHaveLength(0);
    await submitProgramStatusPrompt(session, 'Say hello');
    await session.waitForText('CANCEL_STATUS_RECOVERED');
    await vi.waitFor(() => expect(programStatusReports(session).at(-1)?.state).toBe('done'));
    await exitInteractive(session);
  }, 60_000);

  it('reports a terminal provider error and clears it when the session exits', async () => {
    const { session, server } = await launch([], ['--yes']);
    await session.waitForText('❯');
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    await submitProgramStatusPrompt(session, 'Make the provider request');
    await vi.waitFor(() => expect(programStatusReports(session).at(-1)?.state).toBe('error'), { timeout: 20_000 });
    await exitInteractive(session);
    expect(programStatusReports(session).at(-1)?.state).toBe('clear');
  }, 60_000);

  it('delivers program status to a configured hook through both JSON stdin and the environment', async () => {
    const { session, state } = await launch([{ content: 'STATUS_HOOK_COMPLETE' }], ['--yes'], true, async state => {
      await writeFile(path.join(state.workspaceRoot, 'status-hook.cjs'),
        "let data=''; process.stdin.on('data', chunk => data += chunk); process.stdin.on('end', () => { const input=JSON.parse(data); require('fs').appendFileSync('statuses.jsonl', JSON.stringify({ event: input.hook_event_name, report: input.program_status, env: JSON.parse(process.env.HOOK_PROGRAM_STATUS) })+'\\n'); });");
    }, [{ event: 'program-status', command: 'node status-hook.cjs' }]);
    await submitProgramStatusPrompt(session, 'Say hello');
    await session.waitForText('STATUS_HOOK_COMPLETE');
    await vi.waitFor(async () => {
      const reports = (await readFile(path.join(state.workspaceRoot, 'statuses.jsonl'), 'utf8')).trim().split('\n')
        .map(line => JSON.parse(line) as { event: string; report: Record<string, string>; env: Record<string, string> });
      expect(reports.some(entry => entry.report.state === 'done')).toBe(true);
      expect(reports.every(entry => entry.event === 'program-status' && JSON.stringify(entry.report) === JSON.stringify(entry.env))).toBe(true);
    }, { timeout: 10_000 });
    await exitInteractive(session);
  }, 60_000);

  it('reports idle, a question wait, resumed work, done and scoped clear with a usable composer', async () => {
    const { session } = await launch([
      { content: 'I need your choice.', toolCall: { id: 'question', name: 'ask_followup_question', args: { question: 'Choose a deployment target', suggested_answers: ['Staging', 'Production'] } } },
      { content: 'PROGRAM_STATUS_COMPLETE' },
    ]);
    await submitProgramStatusPrompt(session, 'Ask me which deployment target to use');
    await session.waitForText('Choose a deployment target');
    await vi.waitFor(() => expect(programStatusReports(session)).toContainEqual(expect.objectContaining({ state: 'blocked', kind: 'question' })));
    await session.press('enter');
    await session.waitForText('PROGRAM_STATUS_COMPLETE');
    await vi.waitFor(() => expect(programStatusReports(session).at(-1)?.state).toBe('done'));
    expect(programStatusReports(session)[0]?.state).toBe('idle');
    const id = programStatusReports(session).find(report => report.state === 'working')?.id;
    expect(id).toMatch(/^autohand-/);
    await exitInteractive(session);
    expect(programStatusReports(session).at(-1)).toMatchObject({ state: 'clear', id });
    expect(session.exitInfo?.exitCode).toBe(0);
  }, 60_000);

  it('reports startup authentication as blocked auth and clears its own record on exit', async () => {
    const { session } = await launch([], [], false);
    await session.waitForText('Sign in to continue.');
    expect(programStatusReports(session)).toContainEqual(expect.objectContaining({ state: 'blocked', kind: 'auth' }));
    await session.press('escape');
    await waitForExit(session);
    expect(programStatusReports(session).at(-1)?.state).toBe('clear');
  }, 45_000);

  it('keeps JSON command output free of terminal status escapes while publishing structured status', async () => {
    const { session } = await launch([{ content: 'JSON_STATUS_COMPLETE' }], ['--yes', '-p', 'Say hello', '--json']);
    await waitForExit(session, 45_000);
    expect(programStatusReports(session)).toEqual([]);
    const records = stripVTControlCharacters(session.getRawOutput()).split(/[\r\n]+/).filter(line => line.startsWith('{')).map(line => JSON.parse(line));
    expect(records).toContainEqual(expect.objectContaining({ type: 'program_status', programStatus: expect.objectContaining({ state: 'working' }) }));
    expect(records).toContainEqual({ type: 'result', content: 'JSON_STATUS_COMPLETE' });
    expect(session.exitInfo?.exitCode).toBe(0);
  }, 60_000);

  it.each(['rpc', 'acp'] as const)('publishes a complete structured lifecycle from the real %s process without polluting stdout', async mode => {
    const server = await createMockAutohandAINativeSequenceServer([
      { content: 'I will write the fixture.', toolCall: { id: 'write-proof', name: 'write_file', args: { path: 'proof.txt', contents: 'Proof' } } },
      { content: 'PROTOCOL_STATUS_COMPLETE' },
    ], { models: ['moa'] });
    servers.push(server);
    const authServer = await createMockAuthServer();
    authServers.push(authServer);
    const state = await createTempAutohandHome({ config: {
      provider: 'autohandai', autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'test-key', model: 'moa', baseUrl: server.baseUrl },
      features: { autohand_inference: true }, hooks: { enabled: false, hooks: [] },
      agent: { autoMemory: false, sessionRetryLimit: 0 }, network: { maxRetries: 0 },
      ui: { promptSuggestions: false, showCompletionNotification: false },
    } });
    states.push(state);
    const driver = new StdioDriver();
    drivers.push(driver);
    driver.launch(process.execPath, [path.resolve('dist/index.js'), '--mode', mode, '--path', state.workspaceRoot, '--config', state.configPath], {
      cwd: state.workspaceRoot, env: { ...process.env, AUTOHAND_HOME: state.autohandHome,
        AUTOHAND_AUTH_API_URL: `${authServer.baseUrl}/api/auth`,
        AUTOHAND_SKIP_UPDATE_CHECK: '1', AUTOHAND_OFFLINE: '1', AUTOHAND_SKIP_PING: '1',
        AUTOHAND_DISABLE_AUTO_REPORT: '1', AUTOHAND_DISABLE_COMPUTER_USE: '1' },
    });
    const response = async (id: number) => vi.waitFor(() => {
      const record = driver.records().find(record => record.id === id);
      if (!record) throw new Error(driver.stderr());
      expect(record.error).toBeUndefined();
      return record.result as Record<string, unknown>;
    }, { timeout: 30_000, interval: 50 });
    if (mode === 'acp') {
      driver.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } });
      await response(1);
      driver.send({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: state.workspaceRoot, mcpServers: [] } });
      const session = await response(2);
      driver.send({ jsonrpc: '2.0', id: 3, method: 'session/prompt', params: { sessionId: session.sessionId, prompt: [{ type: 'text', text: 'Say hello' }] } });
    } else {
      await vi.waitFor(() => expect(driver.records().some(record => record.method === 'autohand.agentStart'), driver.stdout() + driver.stderr()).toBe(true), { timeout: 30_000 });
      driver.send({ jsonrpc: '2.0', id: 3, method: 'autohand.prompt', params: { message: 'Say hello' } });
    }
    const permission = await vi.waitFor(() => {
      const record = driver.records().find(record => record.method === (mode === 'acp' ? 'session/request_permission' : 'autohand.permissionRequest'));
      if (!record) throw new Error(driver.stdout() + driver.stderr());
      return record;
    }, { timeout: 20_000, interval: 50 });
    expect(driver.records().some(record => record.method === 'autohand.hook.programStatus'
      && (record.params as Record<string, unknown>).state === 'blocked'
      && (record.params as Record<string, unknown>).kind === 'permission')).toBe(true);
    if (mode === 'acp') {
      driver.send({ jsonrpc: '2.0', id: permission.id, result: { outcome: { outcome: 'selected', optionId: 'allow_once' } } });
    } else {
      driver.send({ jsonrpc: '2.0', id: 4, method: 'autohand.permissionResponse', params: {
        requestId: (permission.params as Record<string, unknown>).requestId, decision: 'allow_once',
      } });
    }
    await response(3);
    await vi.waitFor(() => expect(driver.records().filter(record => record.method === 'autohand.hook.programStatus')
      .map(record => (record.params as Record<string, unknown>).state)).toContain('done'), { timeout: 30_000 });
    driver.end();
    expect(await driver.waitForExit(), driver.stderr()).toBe(0);
    expect(driver.stdout()).not.toContain('\x1b');
    const statuses = driver.records().filter(record => record.method === 'autohand.hook.programStatus')
      .map(record => record.params as Record<string, unknown>);
    const transitions = statuses.map(report => report.state).filter((state, index, all) => index === 0 || state !== all[index - 1]);
    expect(transitions).toEqual(mode === 'acp'
      ? ['idle', 'working', 'blocked', 'working', 'done']
      : ['idle', 'working', 'blocked', 'working', 'done', 'clear']);
    expect(statuses.every(report => report.id === statuses[0].id && report.app === 'autohand')).toBe(true);
  }, 60_000);
});
