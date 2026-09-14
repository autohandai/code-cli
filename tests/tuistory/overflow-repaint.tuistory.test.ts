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

let session: Session | undefined;
let server: MockOpenRouterServer | undefined;
let state: TuistoryTempState | undefined;

afterEach(async () => {
  session?.close();
  await server?.close();
  await state?.cleanup();
  session = undefined;
  server = undefined;
  state = undefined;
});

const SCROLLBACK_WIPE = /\x1b\[3J/g;

describe('idle repaints after a long reply', () => {
  it('leaves the scrollback alone while the user reads a reply taller than the viewport', async () => {
    const wall = Array.from({ length: 80 }, (_, index) => `wall line ${index + 1}`).join('\n');
    server = await createMockOpenRouterSequenceServer([
      JSON.stringify({ toolCalls: [], finalResponse: `${wall}\nWALL_DONE` }),
    ]);
    state = await createTempAutohandHome({ config: {
      openrouter: { baseUrl: server.baseUrl },
      agent: { autoMemory: false, maxIterations: 2, sessionRetryLimit: 0 },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--y'], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      cols: 100,
      rows: 30,
      waitForDataTimeout: 15_000,
    });
    await session.waitForText('❯');
    await session.type('print a wall of text');
    await session.press('enter');
    await session.waitForText('WALL_DONE', { timeout: 15_000 });
    await session.waitForText('Completed in', { timeout: 15_000 });
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000));

    const idleStart = session.getRawOutput().length;
    await new Promise<void>((resolve) => setTimeout(resolve, 12_000));
    const idleOutput = session.getRawOutput().slice(idleStart);

    expect(idleOutput.match(SCROLLBACK_WIPE) ?? []).toHaveLength(0);
    expect(session.getTerminalData().lines.slice(-30).map((line) => line.spans.map((span) => span.text).join('')).join('\n')).toContain('WALL_DONE');
    await exitInteractive(session);
  }, 60_000);
});
