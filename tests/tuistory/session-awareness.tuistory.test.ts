/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
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

describe('session awareness Tuistory', () => {
  it('shows and clears a peer across two built CLI sessions', async () => {
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
    await second.text({
      timeout: 30_000,
      waitFor: (text) => text.includes('1 peer'),
    });

    expect(second.readAll()).toContain('other session');

    await exitInteractive(first);
    sessions.splice(sessions.indexOf(first), 1);
    await second.text({
      timeout: 30_000,
      waitFor: (text) => !text.includes('1 peer'),
    });
    expect(await second.text({ immediate: true })).not.toContain('1 peer');

    await exitInteractive(second);
    sessions.splice(sessions.indexOf(second), 1);
  });
});
