/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import {
  setTaskListPositionDirectly,
  setTaskListPositionUp,
} from '../../src/testing/scenarios/taskListPositionScenario.js';
import {
  createMockOpenRouterSequenceServer,
  createTempAutohandHome,
  exitInteractive,
  launchBuiltAutohand,
  type MockOpenRouterServer,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
const servers: MockOpenRouterServer[] = [];

async function launchTaskListPositionSession(
  initialPosition: 'up' | 'above-composer',
): Promise<{ session: Session; state: TuistoryTempState }> {
  const server = await createMockOpenRouterSequenceServer([
    JSON.stringify({
      thought: 'Create a visible plan while the next response is pending.',
      toolCalls: [{
        tool: 'todo_write',
        args: {
          tasks: [
            { content: 'Prepare the placement test', activeForm: 'Preparing the placement test', status: 'completed' },
            { content: 'Keep the task list visible', activeForm: 'Keeping the task list visible', status: 'in_progress' },
            { content: 'Finish the placement test', activeForm: 'Finishing the placement test', status: 'pending' },
          ],
        },
      }],
    }),
    JSON.stringify({ toolCalls: [], finalResponse: 'TASK_LIST_POSITION_COMPLETE' }),
  ], 4_000);
  servers.push(server);

  const state = await createTempAutohandHome({
    config: {
      openrouter: { baseUrl: server.baseUrl },
      agent: { maxIterations: 3, sessionRetryLimit: 0 },
      ui: {
        activityVerbs: 'STATUS_SENTINEL',
        promptSuggestions: false,
        taskListPosition: initialPosition,
      },
    },
  });
  states.push(state);

  const session = await launchBuiltAutohand([
    '--path', state.workspaceRoot,
    '--config', state.configPath,
    '--yes',
  ], {
    autohandHome: state.autohandHome,
    cwd: state.workspaceRoot,
    cols: 90,
    rows: 24,
    waitForDataTimeout: 15_000,
  });
  sessions.push(session);
  return { session, state };
}

function activeViewportText(session: Session): string {
  const data = session.getTerminalData();
  return data.lines
    .slice(Math.max(0, data.lines.length - data.rows))
    .map((line) => line.spans.map((span) => span.text).join(''))
    .join('\n');
}

async function waitForActiveViewport(
  session: Session,
  predicate: (viewport: string) => boolean,
): Promise<string> {
  const deadline = Date.now() + 20_000;
  let viewport = '';
  while (Date.now() < deadline) {
    viewport = activeViewportText(session);
    if (predicate(viewport)) return viewport;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  expect(predicate(viewport), viewport).toBe(true);
  return viewport;
}

afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(states.splice(0).map((state) => state.cleanup()));
});

describe('task list position setting', () => {
  it('moves live tasks above status after selecting up in /settings', async () => {
    const { session, state } = await launchTaskListPositionSession('above-composer');

    await setTaskListPositionUp(session);

    const savedConfig = await fs.readJson(state.configPath) as {
      ui?: { taskListPosition?: string };
    };
    expect(savedConfig.ui?.taskListPosition).toBe('up');

    await session.type('Show the task list while the response is pending.');
    await session.press('enter');

    const viewport = await waitForActiveViewport(
      session,
      (text) => text.includes('Tasks')
        && text.includes('1/3 done')
        && text.includes('Keeping the task list visible')
        && text.includes('STATUS_SENTINEL...')
        && text.includes('❯'),
    );
    const taskIndex = viewport.indexOf('Tasks');
    const statusIndex = viewport.indexOf('STATUS_SENTINEL...');
    const composerIndex = viewport.lastIndexOf('❯');

    expect(taskIndex).toBeGreaterThan(-1);
    expect(statusIndex).toBeGreaterThan(taskIndex);
    expect(composerIndex).toBeGreaterThan(statusIndex);

    await exitInteractive(session);
  }, 90_000);

  it.each([
    { input: 'up', initialPosition: 'above-composer', savedPosition: 'up' },
    { input: 'above-composer', initialPosition: 'up', savedPosition: 'above-composer' },
    { input: 'above composer', initialPosition: 'up', savedPosition: 'above-composer' },
  ] as const)('saves and renders /settings task_list position $input', async ({
    input,
    initialPosition,
    savedPosition,
  }) => {
    const { session, state } = await launchTaskListPositionSession(initialPosition);

    await setTaskListPositionDirectly(session, input);

    const savedConfig = await fs.readJson(state.configPath) as {
      ui?: { taskListPosition?: string };
    };
    expect(savedConfig.ui?.taskListPosition).toBe(savedPosition);

    await session.type('Show the task list while the response is pending.');
    await session.press('enter');

    const viewport = await waitForActiveViewport(
      session,
      (text) => text.includes('Tasks')
        && text.includes('1/3 done')
        && text.includes('Keeping the task list visible')
        && text.includes('STATUS_SENTINEL...')
        && text.includes('❯'),
    );
    const taskIndex = viewport.indexOf('Tasks');
    const statusIndex = viewport.indexOf('STATUS_SENTINEL...');
    const composerIndex = viewport.lastIndexOf('❯');

    expect(taskIndex).toBeGreaterThan(-1);
    expect(statusIndex).toBeGreaterThan(-1);
    if (savedPosition === 'up') {
      expect(taskIndex).toBeLessThan(statusIndex);
    } else {
      expect(taskIndex).toBeGreaterThan(statusIndex);
    }
    expect(composerIndex).toBeGreaterThan(taskIndex);
    expect(composerIndex).toBeGreaterThan(statusIndex);

    await exitInteractive(session);
  }, 90_000);
});
