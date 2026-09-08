import { afterEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { Session } from 'tuistory';
import { prepareMemoryDiskFullScenario } from '../../src/testing/scenarios/memoryResourceScenario.js';
import { prepareVerboseCommandScenario } from '../../src/testing/scenarios/commandOutputScenario.js';
import {
  createMockOpenRouterServer,
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
  const activeSession = session;
  const activeServer = server;
  const activeState = state;
  session = undefined;
  server = undefined;
  state = undefined;
  try {
    if (activeSession && !activeSession.exitInfo) {
      await exitInteractive(activeSession);
    }
  } finally {
    activeSession?.close();
    await activeServer?.close();
    await activeState?.cleanup();
  }
});

describe('memory storage exhaustion', () => {
  it('completes an interactive turn when the project event-log lock cannot be created', async () => {
    server = await createMockOpenRouterServer(JSON.stringify({
      finalResponse: 'MEMORY_DISK_FULL_RECOVERED', toolCalls: [],
    }));
    state = await createTempAutohandHome({ config: {
      openrouter: { baseUrl: server.baseUrl },
      agent: { autoMemory: false, sessionRetryLimit: 0 },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    const scenario = await prepareMemoryDiskFullScenario(state.workspaceRoot);
    await scenario.arm();
    session = await launchBuiltAutohand([
      '--path', state.workspaceRoot, '--config', state.configPath, '--y',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      env: { NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${scenario.preload}`].filter(Boolean).join(' ') },
    });
    await session.waitForText('❯', { timeout: 20_000 });
    await session.type('Reply with the recovery marker');
    await session.press('enter');
    await session.waitForText(/MEMORY_DISK_FULL_RECOVERED|ENOSPC/, { timeout: 20_000 });

    const output = session.readAll();
    expect(output).toContain('MEMORY_DISK_FULL_RECOVERED');
    expect(output).not.toContain('ENOSPC');
    expect(await readFile(scenario.attemptsPath, 'utf8')).toContain('.LOG.jsonl.lock');
    await exitInteractive(session);
  });
});

describe('large immediate shell output', () => {
  it.each([
    { renderer: 'Ink', legacy: '0', marker: '[earlier live output truncated]' },
    { renderer: 'legacy composer', legacy: '1', marker: '[output truncated:' },
  ])('marks an oversized line and accepts another command in the $renderer', async ({ legacy, marker }) => {
    state = await createTempAutohandHome({ config: {
      agent: { autoMemory: false },
      ui: { promptSuggestions: false },
    } });
    const command = await prepareVerboseCommandScenario(state.workspaceRoot);
    session = await launchBuiltAutohand([
      '--path', state.workspaceRoot, '--config', state.configPath, '--y',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      env: { AUTOHAND_LEGACY_UI: legacy, AUTOHAND_NO_INK: '0' },
    });
    await session.waitForText('❯', { timeout: 20_000 });
    await session.type(`! ${command}`);
    await session.press('enter');
    await session.waitForText('CAPTURE_DONE', { timeout: 20_000 });

    const output = session.readAll();
    expect(output).toContain(marker);
    expect(output).toContain('CAPTURE_TAIL');
    await session.type('! printf "%s%s\\n" RESOURCE_SHELL_ RECOVERY_OK');
    await session.press('enter');
    await session.waitForText('RESOURCE_SHELL_RECOVERY_OK', { timeout: 10_000 });
    await exitInteractive(session);
  });
});
