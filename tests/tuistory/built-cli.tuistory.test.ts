/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import fs from 'fs-extra';
import path from 'node:path';
import packageJson from '../../package.json' with { type: 'json' };
import { SLASH_COMMANDS } from '../../src/core/slashCommands.js';
import {
  clearComposerInput,
  createMockOllamaServer,
  createTempAutohandHome,
  dismissAutocompleteMenu,
  exitInteractive,
  expectCleanExit,
  launchBuiltAutohand,
  waitForExit,
  type CreateTempAutohandHomeOptions,
  type MockOllamaServer,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const tempStates: TuistoryTempState[] = [];
const mockServers: MockOllamaServer[] = [];

async function trackSession(sessionPromise: Promise<Session>): Promise<Session> {
  const session = await sessionPromise;
  sessions.push(session);
  return session;
}

async function typeLikeUser(session: Session, text: string): Promise<void> {
  for (const char of text) {
    await session.type(char);
  }
}

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    session.close();
  }
  for (const server of mockServers.splice(0)) {
    await server.close();
  }
  for (const state of tempStates.splice(0)) {
    await state.cleanup();
  }
});

describe('built CLI Tuistory smoke tests', () => {
  it('renders help from the built dist entrypoint', async () => {
    const session = await trackSession(launchBuiltAutohand(['--help']));

    await session.waitForText('Usage', { timeout: 10_000 });
    const output = session.readAll();

    expect(output).toContain('Usage');
    expect(output).toContain('--prompt');
    expect(output).toContain('--mode');
    expect(output).toContain('--help');
    expect(output).toContain('--version');

    await waitForExit(session);
    expectCleanExit(session);
  });

  it('renders version from the built dist entrypoint', async () => {
    const session = await trackSession(launchBuiltAutohand(['--version']));

    await session.waitForText(packageJson.version, { timeout: 10_000 });
    const output = session.readAll();

    expect(output).toContain(packageJson.version);
    expect(output).toMatch(/\d+\.\d+\.\d+ \((?:[0-9a-f]{7,40}|unknown)\)/);

    await waitForExit(session);
    expectCleanExit(session);
  });
});

describe('interactive built CLI Tuistory tests', () => {
  async function launchInteractive(options: {
    config?: CreateTempAutohandHomeOptions['config'];
    env?: Record<string, string | undefined>;
  } = {}): Promise<Session> {
    const state = await createTempAutohandHome({ config: options.config });
    tempStates.push(state);
    return await trackSession(
      launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: options.env,
        waitForDataTimeout: 15_000,
      })
    );
  }

  async function waitForComposer(session: Session): Promise<void> {
    await session.waitForText('Plan, search', { timeout: 20_000 });
  }

  it('starts the interactive TUI without real auth, network, or user home state', async () => {
    const session = await launchInteractive();

    await waitForComposer(session);
    const screen = await session.text({ trimEnd: true });

    expect(screen).toContain('Autohand');
    expect(screen).toContain('model:');

    await exitInteractive(session);
  });

  it('auto-initializes git for an empty workspace before rendering the composer', async () => {
    const state = await createTempAutohandHome({
      initializeGit: false,
      writePackageJson: false,
    });
    tempStates.push(state);
    const session = await trackSession(
      launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        waitForDataTimeout: 15_000,
      })
    );

    await waitForComposer(session);

    expect(await fs.pathExists(path.join(state.workspaceRoot, '.git'))).toBe(true);

    await exitInteractive(session);
  });

  it('shows slash command suggestions for a bare slash', async () => {
    const session = await launchInteractive();

    await waitForComposer(session);
    await session.type('/');
    await session.text({
      timeout: 10_000,
      waitFor: (text) => text.includes('/model') || text.includes('/settings'),
    });
    const screen = await session.text({ trimEnd: true });

    expect(screen).toContain('/help');
    expect(screen).toMatch(/\/model|\/settings/);

    await exitInteractive(session);
  });

  it('runs the slash help command from the interactive TUI', async () => {
    const session = await launchInteractive();

    await waitForComposer(session);
    await session.type('/help');
    await session.press('enter');
    await session.waitForText(/Available|commands/i, { timeout: 10_000 });
    const output = session.readAll();

    expect(output).toContain('/help');
    expect(output).toMatch(/Available|commands/i);

    await exitInteractive(session);
  });

  it('opens every registered slash command suggestion and dismisses the menu with Escape', async () => {
    const session = await launchInteractive();
    const slashCommands = Array.from(
      new Set(SLASH_COMMANDS.map((command) => command.command))
    ).sort();

    await waitForComposer(session);

    for (const command of slashCommands) {
      await typeLikeUser(session, command);
      const menuScreen = await session.text({
        timeout: 10_000,
        waitFor: (text) => text.includes(command) && text.includes('Tab to accept'),
      });

      expect(menuScreen).toContain(command);
      await dismissAutocompleteMenu(session);
      const dismissedScreen = await session.text({ trimEnd: true });
      expect(dismissedScreen).not.toContain('Tab to accept');

      await clearComposerInput(session);
    }

    await exitInteractive(session);
  }, 120_000);

  it('selects the Sandy theme and renders the expected Sandy colors', async () => {
    const session = await launchInteractive({
      env: {
        NO_COLOR: undefined,
        FORCE_COLOR: '3',
        COLORTERM: 'truecolor',
        TERM: 'xterm-256color',
      },
    });

    await waitForComposer(session);
    await session.type('/theme');
    await session.press('enter');
    await session.waitForText('Select a theme:', { timeout: 10_000 });
    await session.press('7');
    await session.waitForText("Theme changed to 'sandy'", { timeout: 10_000 });
    await session.waitForText('Theme preview:', { timeout: 10_000 });

    const output = session.readAll();
    const rawOutput = session.getRawOutput();

    expect(output).toContain("Theme changed to 'sandy'");
    expect(output).toContain('● accent');
    expect(rawOutput).toContain('[38;2;196;92;62m');
    expect(rawOutput).toContain('[48;2;74;58;42m');
    expect(rawOutput).toContain('[38;2;245;240;232m');

    await exitInteractive(session);
  });

  it('selects Ollama and applies the first listed model to the status line', async () => {
    const selectedModel = 'tuistory-first:latest';
    const ollamaServer = await createMockOllamaServer([selectedModel, 'tuistory-second:latest']);
    mockServers.push(ollamaServer);
    const session = await launchInteractive({
      config: {
        provider: 'openrouter',
        ollama: {
          baseUrl: ollamaServer.baseUrl,
          model: 'previous-ollama:latest',
        },
      },
    });

    await waitForComposer(session);
    await session.type('/model');
    await session.press('enter');
    await session.waitForText('Choose an LLM provider', { timeout: 10_000 });
    await session.press('7');
    await session.waitForText('Select a model', { timeout: 10_000 });
    await session.press('enter');
    await session.waitForText(`Using ollama model ${selectedModel}`, { timeout: 10_000 });
    await session.text({
      timeout: 10_000,
      waitFor: (text) => text.includes(`autohand (Ollama, ${selectedModel})`),
    });

    const screen = await session.text({ trimEnd: true });
    expect(screen).toContain(`autohand (Ollama, ${selectedModel})`);

    await exitInteractive(session);
  });
});
