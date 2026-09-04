/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { runSessionBranchingScenario } from '../../src/testing/scenarios/sessionBranchingScenario.js';
import {
  createTempAutohandHome,
  exitInteractive,
  launchBuiltAutohand,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    session.close();
  }
  for (const state of states.splice(0)) {
    await state.cleanup();
  }
});

describe('session branching Tuistory', () => {
  it('forks, clones, and renders the resulting session tree', async () => {
    const state = await createTempAutohandHome({
      config: {
        features: {
          experimentalFork: true,
          experimentalClone: true,
        },
        ui: { promptSuggestions: false },
      },
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

    const output = await runSessionBranchingScenario(session);

    expect(output).toContain('Forked session');
    expect(output).toContain('Cloned session');
    expect(output).toContain('(fork)');
    expect(output).toContain('(clone)');
    expect(output).not.toContain('1 peer');

    await new Promise((resolve) => setTimeout(resolve, 5_500));
    expect(await session.text({ immediate: true })).not.toContain('1 peer');

    await exitInteractive(session);
    sessions.splice(sessions.indexOf(session), 1);
  }, 60_000);
});
