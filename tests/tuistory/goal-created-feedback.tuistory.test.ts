/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import stripAnsi from 'strip-ansi';
import { outputViewport } from '../../src/testing/scenarios/compactOutputScenario.js';
import { clickFullScreenTranscript } from '../../src/testing/scenarios/fullScreenScenario.js';
import { createMockOpenRouterSequenceServer, exitInteractive } from './helpers/autohandTuistory.js';
import { launchInteractive, mockServers, registerBuiltCliCleanup, waitForComposer } from './helpers/builtCli.js';

registerBuiltCliCleanup();

const OBJECTIVE = 'build a toddler-friendly browser game';
/** Holds the turn in its pre-model phase long enough to observe what the screen shows meanwhile. */
const SLOW_TURN_START_HOOK = { event: 'pre-prompt', command: 'node -e "setTimeout(() => {}, 4000)"', timeout: 20_000 };

function screenOf(text: string): string {
  return stripAnsi(text);
}

describe('interactive /goal feedback', () => {
  it.each([true, false])('confirms a new goal in one line and shows work immediately; fullscreen=%s', async fullScreenMode => {
    const server = await createMockOpenRouterSequenceServer([
      JSON.stringify({ toolCalls: [], finalResponse: 'GOAL_FEEDBACK_TURN_FINISHED' }),
    ]);
    mockServers.push(server);
    const session = await launchInteractive({
      config: {
        openrouter: { baseUrl: server.baseUrl },
        features: { slashGoal: true, fullScreenMode },
        hooks: { enabled: true, hooks: [SLOW_TURN_START_HOOK] },
        agent: { autoMemory: false, goalAutoMode: false, maxIterations: 2, sessionRetryLimit: 0 },
        network: { maxRetries: 0, retryDelay: 0 },
        ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
      },
    });

    await waitForComposer(session);
    await session.type(`/goal ${OBJECTIVE}`);
    await session.press('enter');
    await session.waitForText(`Goal set · ${OBJECTIVE}`, { timeout: 10_000 });

    // The model has not been reached yet: the turn is still preparing, and the user must see that.
    const working = screenOf(await session.text({ timeout: 3_000, waitFor: text => /esc to cancel/u.test(screenOf(text)) }));
    expect(server.requests).toHaveLength(0);
    expect(working).toContain(`Goal set · ${OBJECTIVE}`);
    expect(working).not.toMatch(/Status: active|Elapsed: 0s|Tokens: 0|ID: [0-9a-f-]{36}/u);

    await session.waitForText('GOAL_FEEDBACK_TURN_FINISHED', { timeout: 20_000 });
    await waitForComposer(session);
    await session.press(['ctrl', 'o']);
    const expanded = screenOf(await session.text({ timeout: 5_000, waitFor: text => /Status: active/u.test(screenOf(text)) }));
    expect(expanded).toContain(`Goal: ${OBJECTIVE}`);
    expect(expanded).toMatch(/ID: [0-9a-f-]{36}/u);

    await session.press(['ctrl', 'o']);
    await session.text({ timeout: 5_000, waitFor: text => !/Status: active/u.test(screenOf(text)) });

    if (fullScreenMode) {
      // The row itself opens the same details, as a finished tool result does.
      const row = outputViewport(session).split('\n').findIndex(line => line.includes(`Goal set · ${OBJECTIVE}`));
      expect(row).toBeGreaterThanOrEqual(0);
      await clickFullScreenTranscript(session, 4, row);
      await session.text({ timeout: 5_000, waitFor: text => /Status: active/u.test(screenOf(text)) });
    }

    await exitInteractive(session);
  }, 60_000);

  it('keeps the full status view for bare /goal', async () => {
    const server = await createMockOpenRouterSequenceServer([
      JSON.stringify({ toolCalls: [], finalResponse: 'GOAL_STATUS_TURN_FINISHED' }),
    ]);
    mockServers.push(server);
    const session = await launchInteractive({
      config: {
        openrouter: { baseUrl: server.baseUrl },
        features: { slashGoal: true },
        agent: { autoMemory: false, goalAutoMode: false, maxIterations: 2, sessionRetryLimit: 0 },
        network: { maxRetries: 0, retryDelay: 0 },
        ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
      },
    });

    await waitForComposer(session);
    await session.type(`/goal ${OBJECTIVE}`);
    await session.press('enter');
    await session.waitForText('GOAL_STATUS_TURN_FINISHED', { timeout: 20_000 });

    await waitForComposer(session);
    await session.type('/goal');
    await session.press('enter');
    const status = screenOf(await session.text({ timeout: 5_000, waitFor: text => /Status: active/u.test(screenOf(text)) }));
    expect(status).toContain(`Goal: ${OBJECTIVE}`);
    expect(status).toMatch(/ID: [0-9a-f-]{36}/u);

    await exitInteractive(session);
  }, 60_000);
});
