/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { inspectTraceSettings } from '../../src/testing/scenarios/traceSettingsScenario.js';
import {
  createTempAutohandHome,
  exitInteractive,
  launchBuiltAutohand,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  await Promise.all(states.splice(0).map(state => state.cleanup()));
});

describe('agent trace settings Tuistory', () => {
  it('shows each independent trace and Work Map consent in the built terminal', async () => {
    const state = await createTempAutohandHome({
      config: { ui: { promptSuggestions: false } },
    });
    states.push(state);
    const session = await launchBuiltAutohand([
      '--path', state.workspaceRoot,
      '--config', state.configPath,
      '--yes',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    });
    sessions.push(session);

    const screen = await inspectTraceSettings(session);
    expect(screen).toContain('Agent trace monitoring: off (default)');
    expect(screen).toContain('Cloud trace sync: off (default)');
    expect(screen).toContain('Cloud content mode: metadata (default)');
    expect(screen).toContain('Discovery Work Map: on (default)');

    await exitInteractive(session);
    sessions.splice(sessions.indexOf(session), 1);
  }, 60_000);
});
