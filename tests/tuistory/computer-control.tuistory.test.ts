/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { chmod, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import {
  createMockAutohandAINativeSequenceServer,
  createTempAutohandHome,
  exitInteractive,
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

async function writeFakeCuaDriver(state: TuistoryTempState, initializeDelayMs = 0): Promise<string> {
  const executable = path.join(state.workspaceRoot, 'cua-driver');
  const mcpFixture = path.join(repoRoot(), 'tests/fixtures/mock-mcp-server.mjs');
  await writeFile(executable, [
    '#!/bin/sh',
    'case "${1:-}" in',
    '  --version) printf "cua-driver 0.28.2\\n" ;;',
    `  mcp) MCP_TEST_INITIALIZE_DELAY_MS="${initializeDelayMs}" exec "${process.execPath}" "${mcpFixture}" ;;`,
    '  doctor) printf "Cua Driver doctor: ready\\n" ;;',
    '  *) exit 2 ;;',
    'esac',
  ].join('\n'));
  await chmod(executable, 0o755);
  return executable;
}

async function writeFakeComputerUseHost(state: TuistoryTempState): Promise<string> {
  const executable = path.join(state.workspaceRoot, 'autohand-computer-use');
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "${1:-}" = "mcp" ] && [ "${2:-}" = "--driver-path" ] && [ -n "${3:-}" ]; then',
    '  exec "$3" mcp',
    'fi',
    'exit 2',
  ].join('\n'));
  await chmod(executable, 0o755);
  return executable;
}

describe('built native computer control', () => {
  it('uses the Autohand Computer Use product name in user-facing status', async () => {
    const state = await createTempAutohandHome();
    states.push(state);
    const driver = await writeFakeCuaDriver(state);
    const computerUseHost = await writeFakeComputerUseHost(state);
    const session = await launchBuiltAutohand(
      ['computer', 'status'],
      {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: {
          AUTOHAND_DISABLE_COMPUTER_USE: '0',
          AUTOHAND_CUA_DRIVER_PATH: driver,
          AUTOHAND_COMPUTER_USE_APP_PATH: computerUseHost,
        },
      },
    );
    sessions.push(session);
    await waitForExit(session, 15_000);
    expectCleanExit(session);
    expect(session.readAll()).toContain('Autohand Computer Use');
    expect(session.readAll()).not.toContain('Ready · Cua Driver');
  });

  it('reports the detected driver through the built command', async () => {
    const state = await createTempAutohandHome();
    states.push(state);
    const driver = await writeFakeCuaDriver(state);
    const computerUseHost = await writeFakeComputerUseHost(state);
    const session = await launchBuiltAutohand(
      ['computer', 'status', '--json'],
      {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: {
          AUTOHAND_DISABLE_COMPUTER_USE: '0',
          AUTOHAND_CUA_DRIVER_PATH: driver,
          AUTOHAND_COMPUTER_USE_APP_PATH: computerUseHost,
        },
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

  it('waits for native control and exposes its tools on the first direct app turn', async () => {
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
    const driver = await writeFakeCuaDriver(state, 5_000);
    const computerUseHost = await writeFakeComputerUseHost(state);
    const session = await launchBuiltAutohand([
      '--path',
      state.workspaceRoot,
      '--config',
      state.configPath,
      '--yes',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      env: {
        AUTOHAND_DISABLE_COMPUTER_USE: '0',
        AUTOHAND_CUA_DRIVER_PATH: driver,
        AUTOHAND_COMPUTER_USE_APP_PATH: computerUseHost,
      },
      waitForDataTimeout: 15_000,
    });
    sessions.push(session);
    await session.text({ timeout: 20_000, waitFor: (text) => text.includes('❯') });
    await session.type('use my spotify and play Felix Rosch');
    await session.press('enter');
    await session.text({
      timeout: 30_000,
      waitFor: (text) => text.includes('COMPUTER_CONTROL_TURN_COMPLETE'),
    });

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
    await exitInteractive(session);
  }, 45_000);

  it('hands a computer-control screenshot to the model without rendering or persisting its bytes', async () => {
    const provider = await createMockAutohandAINativeSequenceServer([
      {
        content: 'Inspecting the desktop.',
        toolCall: {
          id: 'call_cua_screenshot',
          name: 'mcp__cua-driver__screenshot_test',
          args: {},
        },
      },
      { content: 'COMPUTER_CONTROL_SCREENSHOT_COMPLETE' },
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
    const computerUseHost = await writeFakeComputerUseHost(state);
    const session = await launchBuiltAutohand([
      '--path',
      state.workspaceRoot,
      '--config',
      state.configPath,
      '--yes',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      env: {
        AUTOHAND_DISABLE_COMPUTER_USE: '0',
        AUTOHAND_CUA_DRIVER_PATH: driver,
        AUTOHAND_COMPUTER_USE_APP_PATH: computerUseHost,
      },
      waitForDataTimeout: 15_000,
    });
    sessions.push(session);
    await session.text({ timeout: 20_000, waitFor: (text) => text.includes('❯') });
    await session.type('look at my desktop and describe the current screen');
    await session.press('enter');
    await session.waitForText('COMPUTER_CONTROL_SCREENSHOT_COMPLETE', { timeout: 30_000 });

    const screen = session.readAll();
    expect(screen).toContain('desktop screenshot 1x1 px');
    expect(screen).toContain('[1 image available for visual inspection.]');
    expect(screen).not.toContain('iVBORw0KGgo');
    const secondRequest = provider.requests[1] as {
      messages?: Array<{ role?: string; content?: unknown }>;
    };
    const requestText = JSON.stringify(secondRequest.messages);
    expect(requestText).toContain('data:image/png;base64,');
    const toolMessage = secondRequest.messages?.find((message) => message.role === 'tool');
    const toolText = JSON.stringify(toolMessage?.content);
    expect(toolText).toContain('desktop screenshot 1x1 px');
    expect(toolText).toContain('[1 image available for visual inspection.]');
    expect(toolText).not.toContain('iVBORw0KGgo');
    expect(toolText).not.toContain('structuredContent');
    expect(requestText.length).toBeLessThan(100_000);

    await exitInteractive(session);
    const storedSessions = path.join(state.autohandHome, 'sessions');
    for (const relative of await readdir(storedSessions, { recursive: true })) {
      if (!relative.endsWith('.json') && !relative.endsWith('.jsonl')) continue;
      const persisted = await readFile(path.join(storedSessions, relative), 'utf8');
      expect(persisted).not.toContain('data:image/');
      expect(persisted).not.toContain('iVBORw0KGgo');
    }
  }, 45_000);

  it('keeps tool discovery compact until the user expands it', async () => {
    const provider = await createMockAutohandAINativeSequenceServer([
      {
        content: 'Looking up the exact tool.',
        toolCall: {
          id: 'call_tool_search',
          name: 'tool_search',
          args: { query: 'read_file', limit: 1 },
        },
      },
      { content: 'REGISTRY_DISCOVERY_COMPLETE' },
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
    const session = await launchBuiltAutohand([
      '--path',
      state.workspaceRoot,
      '--config',
      state.configPath,
      '--yes',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    });
    sessions.push(session);
    await session.text({ timeout: 20_000, waitFor: (text) => text.includes('❯') });
    await session.type('find the exact file reading tool');
    await session.press('enter');
    await session.waitForText('REGISTRY_DISCOVERY_COMPLETE', { timeout: 30_000 });
    await session.waitForText('1 matching tool', { timeout: 10_000 });
    await session.waitForText('Ctrl+O expand', { timeout: 10_000 });
    expect(session.readAll()).not.toContain('"name": "read_file"');

    await session.press(['ctrl', 'o']);
    await session.waitForText('Ctrl+O collapse', { timeout: 5_000 });
    await session.waitForText('"name": "read_file"', { timeout: 5_000 });

    await exitInteractive(session);
  }, 45_000);
});
