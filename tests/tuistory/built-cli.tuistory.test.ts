/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import packageJson from '../../package.json' with { type: 'json' };
import {
  createTempAutohandHome,
  exitInteractive,
  expectCleanExit,
  launchBuiltAutohand,
  waitForExit,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const tempStates: TuistoryTempState[] = [];

async function trackSession(sessionPromise: Promise<Session>): Promise<Session> {
  const session = await sessionPromise;
  sessions.push(session);
  return session;
}

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    session.close();
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
  async function launchInteractive(): Promise<Session> {
    const state = await createTempAutohandHome();
    tempStates.push(state);
    return await trackSession(
      launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
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
});
