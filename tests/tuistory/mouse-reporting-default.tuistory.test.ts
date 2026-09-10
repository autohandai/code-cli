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

async function launch(ui: Record<string, unknown>): Promise<Session> {
  state = await createTempAutohandHome({ config: { ui: { promptSuggestions: false, ...ui } } });
  session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
    autohandHome: state.autohandHome, cwd: state.workspaceRoot, waitForDataTimeout: 15_000,
  });
  await session.waitForText('❯');
  await session.type('hello');
  await session.waitForText('hello');
  return session;
}

describe('terminal mouse reporting', () => {
  it('leaves the wheel with the terminal by default: no mouse reporting is requested', async () => {
    const live = await launch({});
    expect(live.getRawOutput()).not.toContain(ENABLE_MOUSE_REPORTING);
    await exitInteractive(live);
  });

  it('requests mouse reporting only when click-to-position is enabled explicitly', async () => {
    const live = await launch({ mouseComposerCursor: true });
    expect(live.getRawOutput()).toContain(ENABLE_MOUSE_REPORTING);
    await exitInteractive(live);
  });
});
