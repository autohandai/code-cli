/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { seedTypedMessageHistory, recallTypedMessagesAcrossDirectories } from '../../src/testing/scenarios/typedMessageHistoryScenario.js';
import {
  createMockAuthServer, createMockOpenRouterSequenceServer, createTempAutohandHome, exitInteractive, launchBuiltAutohand,
  type MockAuthServer, type MockOpenRouterServer, type TuistoryTempState,
} from './helpers/autohandTuistory.js';

let session: Session | undefined;
let state: TuistoryTempState | undefined;
let server: MockOpenRouterServer | undefined;
let authServer: MockAuthServer | undefined;
afterEach(async () => {
  session?.close();
  await server?.close();
  await authServer?.close();
  await state?.cleanup();
});

describe('typed-message history across working directories', () => {
  it('recalls, edits, selects, cancels, and exits using the built CLI', async () => {
    authServer = await createMockAuthServer();
    server = await createMockOpenRouterSequenceServer(['HISTORY_FIRST_DONE', 'HISTORY_SECOND_DONE', 'HISTORY_EDIT_DONE']
      .map(finalResponse => JSON.stringify({ toolCalls: [], finalResponse })));
    state = await createTempAutohandHome({ config: {
      openrouter: { baseUrl: server.baseUrl },
      agent: { autoMemory: false },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--y'], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot,
      waitForDataTimeout: 20_000,
      env: { AUTOHAND_AUTH_API_URL: `${authServer.baseUrl}/api/auth` },
    });
    await seedTypedMessageHistory(session);
    await exitInteractive(session);
    session.close();

    const secondCwd = path.join(state.workspaceRoot, 'another-project');
    await mkdir(secondCwd);
    session = await launchBuiltAutohand(['--path', secondCwd, '--config', state.configPath, '--y'], {
      autohandHome: state.autohandHome, cwd: secondCwd,
      waitForDataTimeout: 20_000,
      env: { AUTOHAND_AUTH_API_URL: `${authServer.baseUrl}/api/auth` },
    });
    const snapshots = await recallTypedMessagesAcrossDirectories(session).catch(async error => {
      throw new Error(`${String(error)}\n${await session!.text({ immediate: true })}`, { cause: error });
    });
    expect(snapshots).toMatchInlineSnapshot(`
      [
        "Second typed message",
        "First typed message",
        "Second typed message",
        "Unfinished draft",
        "First typed message",
      ]
    `);
    await exitInteractive(session);
  });
});
