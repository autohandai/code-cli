/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import stripAnsi from 'strip-ansi';
import { createMockOpenRouterServer, exitInteractive, expectCleanExit } from './helpers/autohandTuistory.js';
import {
  launchInteractive,
  mockServers,
  registerBuiltCliCleanup,
  tempStates,
  typeLikeUser,
  waitForComposer,
} from './helpers/builtCli.js';

registerBuiltCliCleanup();

const ANSWER = 'A cozy burrow is the best place to debug!';

describe('interactive built CLI Tuistory tests: ~axo', () => {
  it('summons Axo, answers a question with the model, and sends it home, all without a turn', async () => {
    const openRouterServer = await createMockOpenRouterServer(ANSWER);
    mockServers.push(openRouterServer);
    const session = await launchInteractive({
      config: { openrouter: { baseUrl: openRouterServer.baseUrl } },
      // The harness turns colour off; Axo needs it to be drawn at all.
      env: { NO_COLOR: undefined, FORCE_COLOR: '3' },
      cols: 120,
      rows: 40,
    });
    const state = tempStates.at(-1)!;
    await waitForComposer(session);

    await typeLikeUser(session, '~axo');
    await session.press('enter');
    const greeted = stripAnsi(await session.text({ timeout: 10_000, waitFor: (text) => text.includes("hi! I'm Axo") }));
    expect(greeted).toMatch(/[▀▄█]/u);
    // The command never became a message in the transcript.
    expect(greeted.split('\n').filter((line) => line.includes('~axo'))).toEqual([]);

    await typeLikeUser(session, '~axo where do you live?');
    await session.press('enter');
    // The mock model also feeds the composer's ghost suggestion, so look for the
    // answer on Axo's own bubble line (the one pointing at Axo).
    const bubbleSays = (text: string, words: string) =>
      stripAnsi(text).split('\n').some((line) => line.includes('◂') && line.includes(words));
    const answered = await session.text({ timeout: 20_000, waitFor: (text) => bubbleSays(text, 'best place to debug!') });
    expect(stripAnsi(answered)).not.toContain('where do you live?');
    expect(JSON.parse(await readFile(path.join(state.autohandHome, 'axo.json'), 'utf8'))).toEqual({ enabled: true });

    await typeLikeUser(session, '~axo home');
    await session.press('enter');
    await session.text({ timeout: 10_000, waitFor: (text) => bubbleSays(text, 'bye!') });
    await session.text({ timeout: 10_000, waitFor: (text) => !text.includes('bye!') && !/[▀▄]/u.test(stripAnsi(text)) });
    expect(JSON.parse(await readFile(path.join(state.autohandHome, 'axo.json'), 'utf8'))).toEqual({ enabled: false });

    await exitInteractive(session);
    await expectCleanExit(session);
  });
});
