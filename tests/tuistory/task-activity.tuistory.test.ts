/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
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

function activeViewportText(session: Session): string {
  const data = session.getTerminalData();
  return data.lines
    .slice(Math.max(0, data.lines.length - data.rows))
    .map((line) => line.spans.map((span) => span.text).join(''))
    .join('\n');
}

async function waitForActiveViewport(session: Session, predicate: (viewport: string) => boolean): Promise<string> {
  const deadline = Date.now() + 20_000;
  let viewport = '';
  while (Date.now() < deadline) {
    viewport = activeViewportText(session);
    if (predicate(viewport)) {
      return viewport;
    }
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

describe('interactive task activity', () => {
  it('removes completed task activity when the final turn reaches the composer', async () => {
    const server = await createMockOpenRouterSequenceServer([
      JSON.stringify({
        thought: 'Create a five-step plan and start the validation.',
        toolCalls: [
          {
            tool: 'todo_write',
            args: {
              tasks: [
                { content: 'Set up the task-view test', activeForm: 'Setting up the task-view test', status: 'completed' },
                { content: 'Stream the first harmless output batch', activeForm: 'Streaming the first harmless output batch', status: 'completed' },
                { content: 'Update the visible task progress', activeForm: 'Updating the visible task progress', status: 'completed' },
                { content: 'Verify the completion surface', activeForm: 'Verifying the completion surface', status: 'completed' },
                { content: 'Report the task-view result', activeForm: 'Reporting the task-view result', status: 'in_progress' },
              ],
            },
          },
        ],
      }),
      JSON.stringify({
        toolCalls: [],
        finalResponse: 'TASK_ACTIVITY_FINAL_SUMMARY: The task-view check completed successfully.',
      }),
    ], 4_000);
    servers.push(server);

    const state = await createTempAutohandHome({
      config: {
        openrouter: { baseUrl: server.baseUrl },
        agent: { maxIterations: 3, sessionRetryLimit: 0 },
        ui: { promptSuggestions: false },
      },
    });
    states.push(state);

    const session = await launchBuiltAutohand([
      '--path', state.workspaceRoot,
      '--config', state.configPath,
      '--y',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      cols: 100,
      rows: 30,
      waitForDataTimeout: 15_000,
    });
    sessions.push(session);

    await session.waitForText('❯', { timeout: 20_000 });
    await session.type('Run the task-view completion check.');
    await session.press('enter');
    await session.waitForText('4/5 done', { timeout: 30_000 });

    const viewport = await waitForActiveViewport(
      session,
      (text) => text.includes('TASK_ACTIVITY_FINAL_SUMMARY')
        && text.includes('Completed in')
        && text.includes('❯')
        && !text.includes('Tasks')
        && !text.includes('All 5 tasks completed'),
    );

    expect(viewport).not.toContain('5/5 done');
    expect(viewport).not.toContain('100%');
    expect(viewport).not.toContain('Report the task-view result');

    await exitInteractive(session);
  }, 60_000);

  it('keeps the active plan above the composer after tool output fills and resizes the terminal', async () => {
    const server = await createMockOpenRouterSequenceServer([
      JSON.stringify({
        thought: 'Create the plan, then produce enough output to fill the terminal.',
        toolCalls: [
          {
            tool: 'todo_write',
            args: {
              tasks: [
                { content: 'Inspect the active terminal layout', activeForm: 'Inspecting the active terminal layout', status: 'completed' },
                { content: 'Keep task progress in the composer window', activeForm: 'Keeping task progress in the composer window', status: 'in_progress' },
                { content: 'Validate the resized terminal', activeForm: 'Validating the resized terminal', status: 'pending' },
              ],
            },
          },
          {
            tool: 'shell',
            args: {
              command: 'for index in $(seq 1 40); do echo task-activity-log-$index; done',
            },
          },
        ],
      }),
      JSON.stringify({
        thought: 'The terminal inspection is complete; advance the visible plan.',
        toolCalls: [
          {
            tool: 'todo_write',
            args: {
              tasks: [
                { content: 'Inspect the active terminal layout', activeForm: 'Inspecting the active terminal layout', status: 'completed' },
                { content: 'Keep task progress in the composer window', activeForm: 'Keeping task progress in the composer window', status: 'completed' },
                { content: 'Validate the resized terminal', activeForm: 'Validating the resized terminal', status: 'in_progress' },
              ],
            },
          },
        ],
      }),
      JSON.stringify({ toolCalls: [], finalResponse: 'TASK_ACTIVITY_TURN_COMPLETE' }),
    ], 4_000);
    servers.push(server);

    const state = await createTempAutohandHome({
      config: {
        openrouter: { baseUrl: server.baseUrl },
        agent: { maxIterations: 4, sessionRetryLimit: 0 },
        ui: { promptSuggestions: false },
      },
    });
    states.push(state);

    const session = await launchBuiltAutohand([
      '--path', state.workspaceRoot,
      '--config', state.configPath,
      '--y',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      cols: 80,
      rows: 18,
      waitForDataTimeout: 15_000,
    });
    sessions.push(session);

    await session.waitForText('❯', { timeout: 20_000 });
    await session.type('Show a plan while you inspect the terminal.');
    await session.press('enter');
    await session.waitForText('1/3 done', { timeout: 30_000 });
    await session.resize({ cols: 72, rows: 14 });
    await session.waitForText('2/3 done', { timeout: 30_000 });

    const viewport = await waitForActiveViewport(
      session,
      (text) => text.includes('Tasks')
        && text.includes('2/3 done')
        && text.includes('Validating the resized terminal')
        && text.includes('❯'),
    );

    expect(viewport.indexOf('Validating the resized terminal')).toBeLessThan(viewport.lastIndexOf('❯'));
    expect(viewport).not.toContain('Task plan ·');
    expect(viewport).not.toContain('📋 Task Progress:');
    expect(viewport).not.toContain('Updated task list:');

    await exitInteractive(session);
  }, 60_000);
});
