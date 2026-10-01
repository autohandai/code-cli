/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { chmod, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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

async function writePermissionFixture(state: TuistoryTempState): Promise<Record<string, string>> {
  const driver = await writeFakeCuaDriver(state);
  const app = path.join(await realpath(state.workspaceRoot), 'Autohand Computer Use.app');
  const executable = path.join(app, 'Contents/MacOS/AutohandComputerUse');
  await mkdir(path.dirname(executable), { recursive: true });
  await writeFile(executable, await readFile(await writeFakeComputerUseHost(state)));
  await chmod(executable, 0o755);
  const preload = path.join(state.workspaceRoot, 'permission-fixture.mjs');
  await writeFile(preload, `
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const spawn = childProcess.spawn;
const app = ${JSON.stringify(app)};
childProcess.spawn = function(command, args, options) {
  if (args?.includes(app) && command.endsWith('/lsregister')) {
    return spawn(process.execPath, ['-e', ''], options);
  }
  if (command === '/usr/bin/open' && args?.includes(app) && args.includes('--result-path')) {
    const resultPath = args[args.indexOf('--result-path') + 1];
    const script = 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({accessibility:false,screenRecording:true,bundleIdentifier:"ai.autohand.computer-use"}))';
    return spawn(process.execPath, ['-e', script, resultPath], options);
  }
  return spawn(command, args, options);
};
syncBuiltinESMExports();
`);
  return {
    AUTOHAND_DISABLE_COMPUTER_USE: '0',
    AUTOHAND_CUA_DRIVER_PATH: driver,
    AUTOHAND_COMPUTER_USE_APP_PATH: app,
    NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
  };
}

describe('built native computer control', () => {
  it.runIf(process.platform === 'darwin')('reports denied native permissions as JSON with recovery guidance', async () => {
    const state = await createTempAutohandHome({ initializeGit: false });
    states.push(state);
    const session = await launchBuiltAutohand(['computer', 'doctor', '--json'], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      env: await writePermissionFixture(state),
      cols: 1000,
    });
    sessions.push(session);
    await waitForExit(session, 15_000);
    expect(session.exitInfo?.exitCode).toBe(1);
    const report = JSON.parse(session.readAll());
    expect(report).toMatchObject({ mcpReady: false, permissions: { accessibility: false } });
    expect(report.error).toContain('remove the old entry');
    expect(report.error).toContain('Autohand Computer Use.app');
  });

  it.runIf(process.platform === 'darwin')('stops different app requests before inference and leaves the terminal usable', async () => {
    const provider = await createMockAutohandAINativeSequenceServer([{ content: 'UNEXPECTED_MODEL_REQUEST' }]);
    servers.push(provider);
    const state = await createTempAutohandHome({
      config: {
        provider: 'autohandai',
        autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-key', model: 'moa', baseUrl: provider.baseUrl },
        features: { autohand_inference: true },
        agent: { autoMemory: false, sessionRetryLimit: 0 },
        ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
      },
    });
    states.push(state);
    const session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath, '--yes'], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      env: await writePermissionFixture(state),
      cols: 160,
      rows: 50,
      waitForDataTimeout: 15_000,
    });
    sessions.push(session);
    await session.waitForText('❯', { timeout: 20_000 });
    for (const [index, request] of ['open the Calculator app', 'type hello in the TextEdit window', 'open my browser'].entries()) {
      await session.type(request);
      await session.press('enter');
      await session.text({ timeout: 15_000, waitFor: () =>
        session.readAll().split('needs Accessibility permission').length > index + 1 });
    }
    expect(provider.requests).toHaveLength(0);
    expect(session.readAll()).toContain('remove the old entry');
    expect(session.readAll()).toContain('autohand computer doctor');
    await exitInteractive(session);
  }, 60_000);

  it('exits unsuccessfully when the required postinstall component cannot be written', async () => {
    const state = await createTempAutohandHome({ initializeGit: false });
    states.push(state);
    const occupiedPath = path.join(state.workspaceRoot, 'occupied');
    await writeFile(occupiedPath, 'fixture');
    const session = await launchBuiltAutohand([
      'computer', 'install', '--postinstall', '--non-interactive', '--force', '--bin-dir', occupiedPath,
    ], { autohandHome: state.autohandHome, cwd: state.workspaceRoot });
    sessions.push(session);
    await waitForExit(session, 15_000);
    expect(session.exitInfo?.exitCode).toBe(1);
    expect(session.readAll()).toContain('Could not install native computer control');
    expect(session.readAll()).toContain('autohand computer install');
  });

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

  it('waits for native control and preserves window IDs for the next app inspection', async () => {
    const provider = await createMockAutohandAINativeSequenceServer([
      {
        content: 'Checking the native app connection.',
        toolCall: {
          id: 'call_windows',
          name: 'mcp__autohand-computer-use__list_windows',
          args: { pid: 6844 },
        },
      },
      {
        content: 'Inspecting the discovered window.',
        toolCall: { id: 'call_window_state', name: 'mcp__autohand-computer-use__get_window_state', args: { pid: 6844, window_id: 280 } },
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
        agent: { autoMemory: false, sessionRetryLimit: 0, maxIterations: 4 },
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
      .toContain('mcp__autohand-computer-use__list_windows');
    const userMessage = firstRequest.messages?.find((message) => message.role === 'user')?.content ?? '';
    expect(userMessage).toBe('use my spotify and play Felix Rosch');
    const turnContext = firstRequest.messages?.filter(message => message.role === 'system').map(message => message.content).join('\n') ?? '';
    expect(turnContext).toContain('Computer control mode');
    expect(turnContext).toContain('Operate one exact local app or window');
    expect(turnContext).toContain('mcp__autohand-computer-use__');

    const secondRequest = provider.requests[1] as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const windowResult = secondRequest.messages?.find(message => message.role === 'tool')?.content;
    expect(windowResult).toContain('Found 1 window(s).');
    expect(windowResult).toContain('"window_id":280');
    expect(windowResult).toContain('"pid":6844');
    expect(windowResult).toContain('Spotify Free');
    expect(JSON.stringify(provider.requests[2])).toContain('Spotify window 280 inspected');
    expect(session.readAll()).not.toContain('window_id is not a live window');
    expect(await readFile(state.configPath, 'utf8')).not.toContain('cua-driver');
    await exitInteractive(session);
  }, 45_000);

  it('hands a computer-control screenshot to the model without rendering or persisting its bytes', async () => {
    const provider = await createMockAutohandAINativeSequenceServer([
      {
        content: 'Inspecting the desktop.',
        toolCall: {
          id: 'call_cua_screenshot',
          name: 'mcp__autohand-computer-use__screenshot_test',
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
