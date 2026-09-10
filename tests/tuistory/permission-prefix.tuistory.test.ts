/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import fs from 'fs-extra';
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

const OPTION_ROW = /^\s*(?:▸\s*)?([1-9])\.\s+(.*)$/;

function optionNumber(screen: string, label: string): string {
  for (const line of screen.split('\n')) {
    const match = OPTION_ROW.exec(line);
    if (match && match[2]!.includes(label)) return match[1]!;
  }
  throw new Error(`Option "${label}" is not on screen:\n${screen}`);
}

describe('permission prompt command prefix approval', () => {
  it('always allows a command prefix so the next call with other arguments runs without a prompt', async () => {
    server = await createMockOpenRouterSequenceServer([
      JSON.stringify({ toolCalls: [{ tool: 'shell', args: { command: 'echo PREFIX_FIRST_RUN' } }] }),
      JSON.stringify({ toolCalls: [{ tool: 'shell', args: { command: 'echo PREFIX_SECOND_RUN --other args' } }] }),
      JSON.stringify({ toolCalls: [], finalResponse: 'PREFIX_TURN_COMPLETE' }),
    ]);
    state = await createTempAutohandHome({ config: {
      openrouter: { baseUrl: server.baseUrl },
      agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      cols: 110,
      rows: 34,
      waitForDataTimeout: 15_000,
    });

    await session.waitForText('❯');
    await session.type('Run the echo commands');
    await session.press('enter');

    const prompt = await session.text({
      timeout: 20_000,
      waitFor: (text) => text.includes('Run this shell command') && text.includes('Always allow'),
      trimEnd: true,
    });
    expect(prompt).toContain('Always allow `echo` commands');
    expect(prompt).toContain('Run a different command instead');
    expect(prompt).not.toContain('Enter alternative');

    await session.type(optionNumber(prompt, 'Always allow'));
    await session.waitForText('Choose where to save this decision', { timeout: 10_000 });
    await session.press('enter');

    await session.waitForText('PREFIX_FIRST_RUN', { timeout: 20_000 });
    await session.waitForText('PREFIX_SECOND_RUN', { timeout: 20_000 });
    await session.waitForText('PREFIX_TURN_COMPLETE', { timeout: 20_000 });
    expect(session.readAll().split('Run this shell command').length - 1).toBe(1);

    const stored = await fs.readJson(path.join(state.workspaceRoot, '.autohand', 'settings.local.json'));
    expect(stored.allowList).toContain('shell:echo:*');

    await exitInteractive(session);
  }, 90_000);
});
