/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import {
  createMockAutohandAINativeSequenceServer,
  createTempAutohandHome,
  expectCleanExit,
  launchBuiltAutohand,
  repoRoot,
  waitForExit,
  type MockNativeToolServer,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
const servers: MockNativeToolServer[] = [];

afterEach(async () => {
  sessions.splice(0).forEach((session) => session.close());
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(states.splice(0).map((state) => state.cleanup()));
});

async function writeFakeCuaDriver(state: TuistoryTempState): Promise<string> {
  const executable = path.join(state.workspaceRoot, 'cua-driver');
  const mcpFixture = path.join(repoRoot(), 'tests/fixtures/mock-mcp-server-framed.mjs');
  await writeFile(executable, [
    '#!/bin/sh',
    'case "${1:-}" in',
    '  --version) printf "cua-driver 0.28.2\\n" ;;',
    `  mcp) exec "${process.execPath}" "${mcpFixture}" ;;`,
    '  doctor) printf "Cua Driver doctor: ready\\n" ;;',
    '  *) exit 2 ;;',
    'esac',
  ].join('\n'));
  await chmod(executable, 0o755);
  return executable;
}

describe('built native computer control', () => {
  it('reports the detected driver through the built command', async () => {
    const state = await createTempAutohandHome();
    states.push(state);
    const driver = await writeFakeCuaDriver(state);
    const session = await launchBuiltAutohand(
      ['computer', 'status', '--json'],
      {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: { AUTOHAND_CUA_DRIVER_PATH: driver },
      },
    );
    sessions.push(session);
    await waitForExit(session, 15_000);
    expectCleanExit(session);
    expect(JSON.parse(session.readAll())).toMatchObject({
      installed: true,
      version: '0.28.2',
      supported: true,
      mcpReady: true,
      path: driver,
    });
  });

  it('auto-connects the detected MCP server and injects the native control skill on the first turn', async () => {
    const provider = await createMockAutohandAINativeSequenceServer([
      {
        content: 'Checking the native app connection.',
        toolCall: {
          id: 'call_cua_echo',
          name: 'mcp__cua-driver__echo_test',
          args: { message: 'computer-control-mcp-ok' },
        },
      },
      { content: 'COMPUTER_CONTROL_TURN_COMPLETE' },
    ]);
    servers.push(provider);
    const state = await createTempAutohandHome({
      config: {
        provider: 'autohandai',
        autohandai: {
          plan: 'cloud',
          authMode: 'api-key',
          apiKey: 'tuistory-key',
          model: 'moa',
          baseUrl: provider.baseUrl,
        },
        features: { autohand_inference: true },
        agent: { autoMemory: false, sessionRetryLimit: 0, maxIterations: 3 },
        network: { maxRetries: 0 },
        ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
      },
    });
    states.push(state);
    const driver = await writeFakeCuaDriver(state);
    const session = await launchBuiltAutohand([
      '--path',
      state.workspaceRoot,
      '--config',
      state.configPath,
      '--prompt',
      'open my browser',
      '--yes',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      env: { AUTOHAND_CUA_DRIVER_PATH: driver },
      waitForDataTimeout: 15_000,
    });
    sessions.push(session);
    await waitForExit(session, 30_000);
    expectCleanExit(session);
    expect(session.readAll()).toContain('COMPUTER_CONTROL_TURN_COMPLETE');

    const firstRequest = provider.requests[0] as {
      messages?: Array<{ role?: string; content?: string }>;
      tools?: Array<{ function?: { name?: string } }>;
    };
    expect(firstRequest.tools?.map((tool) => tool.function?.name))
      .toContain('mcp__cua-driver__echo_test');
    const userMessage = firstRequest.messages?.find((message) => message.role === 'user')?.content ?? '';
    expect(userMessage).toContain('Computer control mode');
    expect(userMessage).toContain('Operate one exact local app or window');

    const secondRequest = provider.requests[1] as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    expect(JSON.stringify(secondRequest.messages)).toContain('Echo: computer-control-mcp-ok');
    expect(await readFile(state.configPath, 'utf8')).not.toContain('cua-driver');
  }, 45_000);
});
