/** @license Apache-2.0 */
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from 'tuistory';
import { createHerdrFixture, submitHerdrTurn } from '../../src/testing/scenarios/herdrScenario.js';
import { createMockOpenRouterServer, createTempAutohandHome, exitInteractive, launchBuiltAutohand, waitForExit, type MockOpenRouterServer, type TuistoryTempState } from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
const servers: MockOpenRouterServer[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    session.close();
    await waitForExit(session);
  }
  await Promise.all(servers.splice(0).map(server => server.close()));
  await Promise.all(states.splice(0).map(state => state.cleanup()));
});

describe('Herdr built CLI lifecycle', () => {
  it.skipIf(process.platform === 'win32')('reports a turn and releases its pane on Ctrl+C without interrupting the CLI', async () => {
    const server = await createMockOpenRouterServer('HERDR_TURN_DONE', 2_500);
    servers.push(server);
    const state = await createTempAutohandHome({ config: {
      openrouter: { baseUrl: server.baseUrl },
      agent: { autoMemory: false },
      ui: { promptSuggestions: false, terminalBell: false, showCompletionNotification: false },
    } });
    states.push(state);
    const fixture = await createHerdrFixture(state.autohandHome);
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000,
      env: { HERDR_ENV: '1', HERDR_PANE_ID: 'tuistory:p1', HERDR_BIN_PATH: fixture.binPath },
    });
    sessions.push(session);
    await session.waitForText('❯', { timeout: 20_000 });
    const reports = async (): Promise<string[][]> => (await readFile(fixture.logPath, 'utf8')).trim().split('\n').map(line => line.split('\u001f').filter(Boolean));
    await submitHerdrTurn(session);
    await vi.waitFor(async () => expect(await reports()).toEqual(expect.arrayContaining([
      expect.arrayContaining(['report-agent', 'tuistory:p1', '--state', 'idle']),
      expect.arrayContaining(['--state', 'working']),
    ])), { timeout: 10_000 });
    await exitInteractive(session);
    expect(session.exitInfo?.exitCode).toBe(0);
    const calls = await reports();
    expect(calls.at(-1)).toContain('release-agent');
    expect(calls[0]).toContain('--agent-session-id');
    const sequence = calls.map(args => Number(args[args.indexOf('--seq') + 1]));
    expect(sequence.every((value, index) => index === 0 || value > sequence[index - 1]!)).toBe(true);
  }, 60_000);
});
