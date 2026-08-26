/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * `/peers` renders per-peer cards from the ActiveAgentRegistry. The command
 * reads its manager off the slash command context, which is assembled far from
 * the command itself, so only an end-to-end run proves the two are wired
 * together — a unit test passes a manager in directly and can never catch a
 * context that omits it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fse from 'fs-extra';
import path from 'node:path';
import type { Session } from 'tuistory';
import {
  createTempAutohandHome,
  exitInteractive,
  launchBuiltAutohand,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

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

describe('/peers Tuistory', () => {
  it('renders a peer card for a live peer instead of reporting awareness unavailable', async () => {
    const state = await createTempAutohandHome({
      config: {
        ui: { promptSuggestions: false },
        sessions: { awareness: 'warn' },
      },
    });
    tempStates.push(state);

    const secondConfigPath = path.join(state.autohandHome, 'second-session', 'config.json');
    await fse.ensureDir(path.dirname(secondConfigPath));
    await fse.copyFile(state.configPath, secondConfigPath);

    const first = await trackSession(launchBuiltAutohand(
      ['--path', state.workspaceRoot, '--config', state.configPath, '--yes'],
      {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        waitForDataTimeout: 15_000,
      },
    ));
    await waitForComposer(first);

    const second = await trackSession(launchBuiltAutohand(
      ['--path', state.workspaceRoot, '--config', secondConfigPath, '--yes'],
      {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        waitForDataTimeout: 15_000,
      },
    ));
    await waitForComposer(second);

    // The peer counter proves the registry sees the first session before
    // /peers is asked to render it.
    await second.text({
      timeout: 30_000,
      waitFor: (text) => text.includes('1 peer'),
    });

    await second.type('/peers');
    await second.press('enter');

    // /peers takes over the alternate screen so the cards can be scrolled
    // independently of the session log.
    const rendered = await second.text({
      timeout: 30_000,
      waitFor: (text) =>
        text.includes('Peers') || text.includes('Peer awareness not available'),
    });

    expect(rendered).not.toContain('Peer awareness not available');
    expect(rendered).toContain('Peers');
    expect(rendered).toContain('Peer:');
    expect(rendered).toContain('Model:');
    expect(rendered).toContain('Provider:');
    expect(rendered).toContain('close');

    // Dismissing returns to the composer rather than leaving the screen up.
    await second.type('q');
    await second.text({
      timeout: 30_000,
      waitFor: (text) => text.includes('❯'),
    });

    // Exit the session under test first: tearing down the peer changes what
    // this one renders and muddies any failure here.
    await exitInteractive(second);
    sessions.splice(sessions.indexOf(second), 1);
    await exitInteractive(first);
    sessions.splice(sessions.indexOf(first), 1);
  });

  it('reports an empty state when the workspace has no peers', async () => {
    const state = await createTempAutohandHome({
      config: {
        ui: { promptSuggestions: false },
        sessions: { awareness: 'warn' },
      },
    });
    tempStates.push(state);

    const only = await trackSession(launchBuiltAutohand(
      ['--path', state.workspaceRoot, '--config', state.configPath, '--yes'],
      {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        waitForDataTimeout: 15_000,
      },
    ));
    await waitForComposer(only);

    await only.type('/peers');
    await only.press('enter');

    const rendered = await only.text({
      timeout: 30_000,
      waitFor: (text) =>
        text.includes('No active peers') || text.includes('Peer awareness not available'),
    });

    // A lone session has no peers, which is not the same as the feature being
    // unavailable. Conflating them is the bug this file exists to prevent.
    expect(rendered).not.toContain('Peer awareness not available');
    expect(rendered).toContain('No active peers');

    await exitInteractive(only);
    sessions.splice(sessions.indexOf(only), 1);
  });
});
