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
import {
  isTerminalMouseTrackingEnabled,
  openGoalWithHistory,
  releaseMouseForHistory,
  readHistoryDuringGoalWork,
  editComposerAfterReading,
} from '../../src/testing/scenarios/mouseScrollbackScenario.js';

let session: Session | undefined;
let state: TuistoryTempState | undefined;
let server: MockOpenRouterServer | undefined;

afterEach(async () => {
  session?.close();
  await server?.close();
  await state?.cleanup();
});

describe('goal command mouse scrollback', () => {
  it('releases the wheel for retained chat history after opening /goals', async () => {
    server = await createMockOpenRouterSequenceServer([JSON.stringify({
      toolCalls: [],
      finalResponse: [
        'HISTORY_START',
        ...Array.from({ length: 70 }, (_, index) => `History entry ${index + 1}: terminal investigation.`),
        'HISTORY_END',
      ].join('\n\n'),
    }), JSON.stringify({
      toolCalls: [{
        tool: 'shell',
        args: {
          command: `${JSON.stringify(process.execPath)} -e "console.log('HISTORY_BACKGROUND_ACTIVE'); setTimeout(() => console.log('HISTORY_BACKGROUND_DONE'), 5000)"`,
        },
      }],
    }), JSON.stringify({ toolCalls: [], finalResponse: 'HISTORY_BACKGROUND_FINAL' })]);
    state = await createTempAutohandHome({ config: {
      openrouter: { baseUrl: server.baseUrl },
      agent: { autoMemory: false, goalAutoMode: false, maxIterations: 2, sessionRetryLimit: 0 },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false, mouseComposerCursor: true },
    } });
    session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--y'], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      cols: 100,
      rows: 30,
    });
    await openGoalWithHistory(session);

    const data = session.getTerminalData();
    const lines = data.lines.map((line) => line.spans.map((span) => span.text).join(''));
    const historyStart = lines.findIndex((line) => line.includes('HISTORY_START'));
    expect(historyStart).toBeGreaterThanOrEqual(0);
    expect(historyStart).toBeLessThan(lines.length - data.rows);
    expect(isTerminalMouseTrackingEnabled(session)).toBe(true);

    await releaseMouseForHistory(session);
    const backgroundOutput = await readHistoryDuringGoalWork(session);
    expect(backgroundOutput).not.toContain('\x1b[?1000h');
    expect(backgroundOutput).not.toContain('\x1b[?25h');
    expect(session.getTerminalData().cursorVisible).toBe(false);
    expect(session.readAll()).toContain('HISTORY_START');
    expect(session.readAll()).toContain('keep this draft');

    const edited = await editComposerAfterReading(session);
    expect(edited).toContain('heXllo');
    expect(isTerminalMouseTrackingEnabled(session)).toBe(true);
    await exitInteractive(session);
    expect(isTerminalMouseTrackingEnabled(session)).toBe(false);
  });
});
