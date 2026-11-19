/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LANE_DESCRIPTION, LANE_NAME, LANE_REPORT_REPLY, OPEN_LANE_CALL_ID,
  laneTurns, lanesListRows, submitLanePrompt,
} from '../../src/testing/scenarios/cliLanesScenario.js';
import {
  createMockAutohandAINativeSequenceServer, createTempAutohandHome, exitInteractive,
  launchBuiltAutohand, type MockNativeToolServer, type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
const servers: MockNativeToolServer[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  for (const server of servers.splice(0)) await server.close();
  for (const state of states.splice(0)) await state.cleanup();
});

async function launch(cliLanes: boolean | undefined, turns: Parameters<typeof createMockAutohandAINativeSequenceServer>[0]) {
  const server = await createMockAutohandAINativeSequenceServer(turns);
  servers.push(server);
  const state = await createTempAutohandHome({ config: {
    provider: 'autohandai',
    autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-test-key', model: 'moa', baseUrl: server.baseUrl, backgroundCalls: false, maxConcurrentThreads: 4 },
    features: { autohand_inference: true, codeMode: true, ...(cliLanes === undefined ? {} : { cliLanes }) },
    agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
    network: { maxRetries: 0, retryDelay: 0 },
    ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
  } });
  states.push(state);
  const session = await launchBuiltAutohand(
    ['--config', state.configPath, '--path', state.workspaceRoot],
    { autohandHome: state.autohandHome, cwd: state.workspaceRoot, rows: 40, waitForDataTimeout: 15_000 },
  );
  sessions.push(session);
  return { session, server };
}

function messagesOf(request: Record<string, unknown>): Array<{ role: string; content?: string; tool_call_id?: string }> {
  return (request.messages as Array<{ role: string; content?: string; tool_call_id?: string }> | undefined) ?? [];
}

function systemPrompt(server: MockNativeToolServer): string {
  return messagesOf(server.requests[0] ?? {}).find(message => message.role === 'system')?.content ?? '';
}

describe('cli_lanes experiment', () => {
  it('opens a lane in the background, lists it under the composer, and brings its report back to main', async () => {
    const { session, server } = await launch(true, laneTurns());
    await submitLanePrompt(session);

    await session.waitForText(`○ ${LANE_NAME}`, { timeout: 30_000 });
    const running = await lanesListRows(session);
    expect(running[0]).toBe('● main');
    expect(running[1]).toContain(LANE_DESCRIPTION);
    expect(running[1]).toMatch(/\d+s/);
    const screen = (await session.text({ immediate: true, trimEnd: true })).split('\n');
    expect(screen.findIndex(row => row.trim() === '● main')).toBeGreaterThan(screen.findIndex(row => row.includes('❯')));

    await session.waitForText(`✓ ${LANE_NAME}`, { timeout: 30_000 });
    await session.waitForText(LANE_REPORT_REPLY, { timeout: 30_000 });

    expect(systemPrompt(server)).toContain('### Lanes');
    const requests = server.requests.map(messagesOf);
    const openResult = requests.flat().find(message => message.role === 'tool' && message.tool_call_id === OPEN_LANE_CALL_ID)?.content ?? '';
    expect(openResult).toContain(`Lane \\"${LANE_NAME}\\" is open and running in the background`);
    expect(requests.at(-1)?.some(message => message.role === 'user' && message.content?.includes(`Lane "${LANE_NAME}"`))).toBe(true);

    await exitInteractive(session);
  });

  it('shows and says nothing about lanes while the experiment is off', async () => {
    const { session, server } = await launch(undefined, [{ content: 'NO_LANES_REPLY' }]);
    await submitLanePrompt(session);
    await session.waitForText('NO_LANES_REPLY', { timeout: 30_000 });

    expect(await lanesListRows(session)).toEqual([]);
    expect(systemPrompt(server)).not.toContain('### Lanes');
    expect(JSON.stringify(server.requests[0]?.tools ?? [])).not.toContain('lane_name');

    await exitInteractive(session);
  });
});
