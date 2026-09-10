/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import {
  createTempAutohandHome, exitInteractive, launchBuiltAutohand, type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const ENABLE_MOUSE_REPORTING = '\x1b[?1000h';
let session: Session | undefined;
let state: TuistoryTempState | undefined;

afterEach(async () => {
  session?.close();
  await state?.cleanup();
  session = undefined;
  state = undefined;
});

async function launch(termProgram: string, ui: Record<string, unknown> = {}): Promise<Session> {
  state = await createTempAutohandHome({ config: { ui: { promptSuggestions: false, ...ui } } });
  session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
    autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000,
    env: { TERM_PROGRAM: termProgram, LC_TERMINAL: undefined },
  });
  await session.waitForText('❯');
  await session.type('hello');
  await session.waitForText('hello');
  return session;
}

describe('terminal mouse reporting', () => {
  it('requests mouse reporting by default outside iTerm2', async () => {
    const live = await launch('ghostty');
    expect(live.getRawOutput()).toContain(ENABLE_MOUSE_REPORTING);
    await exitInteractive(live);
  });

  it('leaves the wheel with iTerm2 by default', async () => {
    const live = await launch('iTerm.app');
    expect(live.getRawOutput()).not.toContain(ENABLE_MOUSE_REPORTING);
    await exitInteractive(live);
  });

  it('honours an explicit opt-in on iTerm2', async () => {
    const live = await launch('iTerm.app', { mouseComposerCursor: true });
    expect(live.getRawOutput()).toContain(ENABLE_MOUSE_REPORTING);
    await exitInteractive(live);
  });
});
