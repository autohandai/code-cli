/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { runCollaborationCommandsScenario } from '../../src/testing/scenarios/collaborationCommandsScenario.js';
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

describe('collaboration slash commands Tuistory', () => {
  it('runs the direct team, task, sub-agent, and peer controls in the compiled CLI', async () => {
    const state = await createTempAutohandHome({
      config: {
        ui: { promptSuggestions: false },
        sessions: { awareness: 'warn' },
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

    const output = await runCollaborationCommandsScenario(session);
    await exitInteractive(session);
    sessions.splice(sessions.indexOf(session), 1);

    expect(output).toContain('Team "docs-demo" created.');
    expect(output).toContain('Team: docs-demo');
    expect(output).toContain('No tasks');
    expect(output).toContain('Usage:');
    expect(output).toContain('Team "docs-demo" has been shut down.');
    expect(output).toContain('Sub-Agent Definitions');
    expect(output).toContain('Active Autohand Agents');
    expect(output).toContain('No active peers');
  }, 90_000);
});
