/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import {
  createTempAutohandHome,
  exitInteractive,
  launchBuiltAutohand,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

/**
 * Slash commands that open a hand-rolled raw-stdin panel (rather than an Ink
 * modal) must hold the event loop open themselves. onBeforeModal unmounts Ink
 * and leaves stdin unref'd, so a bare 'data' listener receives keys but does not
 * keep the process alive — the runtime drains the loop and exits cleanly (code
 * 0) right after the first paint, killing the whole CLI. The panel paints before
 * the process dies, so asserting on screen text alone passes against the bug;
 * these tests settle first and then assert the process is still running.
 */

const sessions: Session[] = [];
const tempStates: TuistoryTempState[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    session.close();
  }
  for (const state of tempStates.splice(0)) {
    await state.cleanup();
  }
});

async function trackSession(sessionPromise: Promise<Session>): Promise<Session> {
  const session = await sessionPromise;
  sessions.push(session);
  return session;
}

async function waitForComposer(session: Session): Promise<void> {
  await session.text({
    timeout: 20_000,
    waitFor: (text) => text.includes('❯'),
  });
}

async function launchInteractive(): Promise<Session> {
  const state = await createTempAutohandHome({
    config: {
      ui: { promptSuggestions: false },
    },
  });
  tempStates.push(state);

  const session = await trackSession(launchBuiltAutohand(
    ['--path', state.workspaceRoot, '--config', state.configPath, '--yes'],
    {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    },
  ));
  await waitForComposer(session);
  return session;
}

async function expectStillRunning(session: Session, command: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  expect(
    session.exitInfo,
    `CLI exited instead of holding the ${command} panel open (exitInfo=${JSON.stringify(session.exitInfo)})`,
  ).toBeNull();
}

describe('raw-stdin modal slash commands Tuistory', () => {
  it('keeps the CLI alive while the /status panel is open', async () => {
    const session = await launchInteractive();

    await session.type('/status');
    await session.press('enter');
    await expectStillRunning(session, '/status');

    await session.waitForText('(tab to cycle)', { timeout: 10_000 });
    await session.waitForText('Context Compaction', { timeout: 10_000 });

    // A single Escape closes only the panel and hands the composer back. The
    // parser treats a lone ESC as a possibly-incomplete arrow-key sequence, so
    // without a settle timer this needs two presses and the advertised
    // "Esc to exit" does nothing.
    await session.press('escape');
    await waitForComposer(session);
    expect(session.exitInfo, 'Escape closed the /status panel and killed the CLI').toBeNull();

    await exitInteractive(session);
  }, 90_000);

  it('keeps the CLI alive while the /agents live view is open', async () => {
    const session = await launchInteractive();

    await session.type('/agents');
    await session.press('enter');
    await expectStillRunning(session, '/agents');

    // An interactive session registers itself, so the live view lists it rather
    // than showing the empty state the one-shot `agents` subcommand renders.
    await session.waitForText('Active Autohand Agents', { timeout: 10_000 });
    await session.waitForText('Esc/Ctrl+C to exit', { timeout: 10_000 });

    await session.press('escape');
    await waitForComposer(session);
    expect(session.exitInfo, 'Escape closed the /agents view and killed the CLI').toBeNull();

    await exitInteractive(session);
  }, 90_000);
});
