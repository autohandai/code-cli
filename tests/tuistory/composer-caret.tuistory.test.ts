/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { launchTerminal, type Session } from 'tuistory';
import { composerCaretLine, sampleComposerCaret } from '../../src/testing/assertions/composerCaret.js';
import {
  createMockOpenRouterSequenceServer,
  createTempAutohandHome,
  exitInteractive,
  expectCleanExit,
  launchBuiltAutohand,
  waitForExit,
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

describe('composer caret stability', () => {
  it.each([
    { animated: false, incremental: false },
    { animated: true, incremental: false },
    { animated: true, incremental: true },
  ])('keeps the caret visible with animation=$animated incremental=$incremental', async ({ animated, incremental }) => {
    session = await launchTerminal({
      command: process.execPath,
      args: [
        '--import', 'tsx', path.resolve('src/testing/scenarios/composerCaretScenario.tsx'),
        ...(animated ? [] : ['--idle']),
        ...(incremental ? ['--incremental'] : []),
      ],
      cols: 80,
      rows: 24,
      waitForDataTimeout: 15_000,
      env: { ...process.env, CI: 'false', TERM: 'xterm-256color', TERM_PROGRAM: 'iTerm.app' },
    });
    await session.waitForText('❯');
    const inputOutputStart = session.getRawOutput().length;
    await session.type('hello');
    await session.waitForText('hello');

    const visibleSamples = await sampleComposerCaret(session);
    expect(session.getRawOutput().slice(inputOutputStart)).toContain('\x1b[?25h');
    expect(visibleSamples).toEqual(Array.from({ length: 12 }, () => true));
    expect(composerCaretLine(session)).toBe('❯ hello|');

    await session.press(['ctrl', 'd']);
    await session.waitForText('CARET_DISABLED');
    expect(await sampleComposerCaret(session, 6)).toEqual(Array.from({ length: 6 }, () => false));
    await session.press(['ctrl', 'd']);
    await session.waitForText('CARET_ENABLED');
    expect(await sampleComposerCaret(session, 6)).toEqual(Array.from({ length: 6 }, () => true));

    await session.press(['ctrl', 'u']);
    await session.waitForText('CARET_UNMOUNTED');
    expect(await sampleComposerCaret(session, 6)).toEqual(Array.from({ length: 6 }, () => false));
    await session.press(['ctrl', 'u']);
    await session.waitForText('CARET_ENABLED');
    expect(await sampleComposerCaret(session, 6)).toEqual(Array.from({ length: 6 }, () => true));

    await session.press(['ctrl', 'l']);
    await session.waitForText('CARET_EXTRA_ROW');
    await session.press(['ctrl', 's']);
    await session.waitForText('CARET_TRANSCRIPT_1');
    expect(await sampleComposerCaret(session, 6)).toEqual(Array.from({ length: 6 }, () => true));
    expect(composerCaretLine(session)).toBe('❯ hello|');
    session.resize({ cols: 100, rows: 20 });
    expect(await sampleComposerCaret(session, 6)).toEqual(Array.from({ length: 6 }, () => true));
    expect(composerCaretLine(session)).toBe('❯ hello|');
    await session.press(['ctrl', 'c']);
    await waitForExit(session);
    expectCleanExit(session);
    expect(session.getTerminalData().cursorVisible).toBe(true);
  });

  it('keeps the built CLI caret visible while composing beside a live command', async () => {
    server = await createMockOpenRouterSequenceServer([
      JSON.stringify({
        toolCalls: [{
          tool: 'shell',
          args: {
            command: `${JSON.stringify(process.execPath)} -e "console.log('CARET_LIVE_ACTIVE'); const deadline = setTimeout(() => process.exit(1), 30000); const timer = setInterval(() => { if (require('node:fs').existsSync('.caret-release')) { clearInterval(timer); clearTimeout(deadline); console.log('CARET_LIVE_DONE'); } }, 50)"`,
          },
        }],
      }),
      JSON.stringify({ toolCalls: [], finalResponse: 'CARET_TURN_COMPLETE' }),
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
      env: { TERM_PROGRAM: 'iTerm.app' },
    });
    await session.waitForText('❯');
    await session.type('Run the caret investigation command');
    await session.press('enter');
    await session.waitForText('CARET_LIVE_ACTIVE');
    const inputOutputStart = session.getRawOutput().length;
    await session.type('keep this draft');
    await session.waitForText('keep this draft');

    const visibleSamples = await sampleComposerCaret(session, 24);
    expect(session.getRawOutput().slice(inputOutputStart)).toContain('\x1b[?25h');
    expect(visibleSamples).toEqual(Array.from({ length: 24 }, () => true));
    expect(composerCaretLine(session)).toBe('❯ keep this draft|');
    await session.press('left');
    await session.type('X');
    await session.waitForText('keep this drafXt');
    expect(composerCaretLine(session)).toBe('❯ keep this drafX|t');
    await session.scrollUp(1, 5, 3);
    expect(await sampleComposerCaret(session, 6)).toEqual(Array.from({ length: 6 }, () => false));
    await session.type('!');
    await session.waitForText('keep this drafX!t');
    expect(await sampleComposerCaret(session, 6)).toEqual(Array.from({ length: 6 }, () => true));
    expect(composerCaretLine(session)).toBe('❯ keep this drafX!|t');
    await writeFile(path.join(state.workspaceRoot, '.caret-release'), 'done');
    await session.waitForText('CARET_TURN_COMPLETE', { timeout: 15_000 });
    await exitInteractive(session);
  });
});
