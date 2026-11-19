/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { leaveActiveAgentDetailsWithProtocolKeys, navigateActiveAgentSessions, publishActiveAgentSessions, seedSavedSessions, switchBetweenSavedSessions, type ActiveAgentSessionsFixture, type SavedSessionSeed } from '../../src/testing/scenarios/activeAgentSessionsScenario.js';
import { createTempAutohandHome, exitInteractive, launchBuiltAutohand, waitForExit, type TuistoryTempState } from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
const fixtures: ActiveAgentSessionsFixture[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) fixture.stop();
  for (const session of sessions.splice(0)) {
    if (!session.isDead) {
      session.killProcess();
      await session.waitForExit(5_000);
    }
    session.close();
  }
  await Promise.all(states.splice(0).map((state) => state.cleanup()));
});

describe('autohand agents live session view', () => {
  it('navigates between live sessions across refreshes, opens one, and exits on Escape', async () => {
    const state = await createTempAutohandHome();
    states.push(state);
    fixtures.push(await publishActiveAgentSessions(state.autohandHome, ['alpha', 'beta', 'gamma']));

    const session = await launchBuiltAutohand(['agents'], { autohandHome: state.autohandHome, cwd: state.workspaceRoot, rows: 30, cols: 120 });
    sessions.push(session);

    const { list, details } = await navigateActiveAgentSessions(session, ['alpha', 'beta', 'gamma']);

    const order = list.split('\n').map((line) => line.match(/\b(alpha|beta|gamma)\b/u)?.[1]).filter((name, index, all) => name && all.indexOf(name) === index);
    expect(order).toEqual(['alpha', 'beta', 'gamma']);
    expect(list).toContain('↑/↓ select');
    expect(details).toContain('Session: beta-session-1');
    expect(details).not.toContain('gamma');
    await waitForExit(session, 10_000);
  }, 60_000);

  it.each([
    ['kitty protocol', { escape: '\u001b[27u', ctrlC: '\u001b[99;5u' }],
    ['modifyOtherKeys', { escape: '\u001b[27;1;27~', ctrlC: '\u001b[27;5;99~' }],
    ['legacy', { escape: '\u001b', ctrlC: '\u0003' }],
  ] as const)('returns from session details and back to a usable composer inside a full-screen session with %s keys', async (_name, keys) => {
    const state = await createTempAutohandHome({ config: { features: { fullScreenMode: true }, ui: { promptSuggestions: false } } });
    states.push(state);
    fixtures.push(await publishActiveAgentSessions(state.autohandHome, ['alpha', 'beta']));

    const session = await launchBuiltAutohand(['--config', state.configPath, '--offline'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000,
      cols: 120, rows: 40, env: { TERM_PROGRAM: 'ghostty' },
    });
    sessions.push(session);
    await session.waitForText('❯');

    const { details, list } = await leaveActiveAgentDetailsWithProtocolKeys(session, ['alpha', 'beta'], keys);

    expect(details).toContain('Session: beta-session-1');
    expect(details).toContain('Esc back to list');
    expect(list).toContain('↑/↓ select');
    await session.waitIdle();
    await session.type('after agents view');
    await session.waitForText('❯ after agents view');
    await exitInteractive(session);
  }, 60_000);
});

describe('/agents session command center', () => {
  it('lists saved sessions from every directory and switches between them with keyboard and mouse', async () => {
    const state = await createTempAutohandHome({ config: { features: { fullScreenMode: true }, ui: { promptSuggestions: false } } });
    states.push(state);
    const here = await realpath(state.workspaceRoot);
    const elsewhere = path.join(path.dirname(here), 'elsewhere');
    await mkdir(elsewhere, { recursive: true });
    const beta: SavedSessionSeed = { sessionId: 'beta-saved', title: 'Beta parser port', projectPath: elsewhere, firstPrompt: 'Port the beta parser', reply: 'BETA_HISTORY_REPLY', minutesAgo: 5 };
    const alpha: SavedSessionSeed = { sessionId: 'alpha-saved', title: 'Alpha login fix', projectPath: here, firstPrompt: 'Fix the alpha login', reply: 'ALPHA_HISTORY_REPLY', minutesAgo: 90 };
    await seedSavedSessions(state.autohandHome, [alpha, beta]);

    const session = await launchBuiltAutohand(['--config', state.configPath, '--offline'], {
      autohandHome: state.autohandHome, cwd: here, waitForDataTimeout: 15_000,
      cols: 120, rows: 40, env: { TERM_PROGRAM: 'ghostty' },
    });
    sessions.push(session);
    await session.waitForText('❯');

    const { center, directoryStep, first, second } = await switchBetweenSavedSessions(session, { first: beta, second: alpha });

    expect(center).toContain('Beta parser port');
    expect(center).toContain('Alpha login fix');
    expect(center).toContain('(this session)');
    expect(center).toMatch(/elsewhere 1/u);
    expect(center).toContain('esc back · ↑/↓ move · tab filter · enter open');
    expect(directoryStep).toContain('Beta parser port');
    expect(directoryStep).toContain('2. Use current directory');
    expect(first).toContain('BETA_HISTORY_REPLY');
    expect(first).not.toContain('ALPHA_HISTORY_REPLY');
    expect(second).toContain('ALPHA_HISTORY_REPLY');
    await exitInteractive(session);
  }, 120_000);
});
