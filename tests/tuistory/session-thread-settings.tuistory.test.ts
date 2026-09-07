/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { configureSessionThreadLimit, setSessionThreadLimitDirectly, submitSessionThreadLimitAlias } from '../../src/testing/scenarios/sessionThreadSettingsScenario.js';
import { loadConfig } from '../../src/config.js';
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

describe('session thread settings Tuistory', () => {
  it('echoes each settings submission once, including an intentionally repeated command', async () => {
    const state = await createTempAutohandHome({
      config: { ui: { promptSuggestions: false }, features: { automaticSpecialists: false } },
    });
    states.push(state);
    const session = await launchBuiltAutohand([
      '--path', state.workspaceRoot, '--config', state.configPath, '--yes',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      cols: 120,
      rows: 40,
      waitForDataTimeout: 15_000,
    });
    sessions.push(session);

    const first = await submitSessionThreadLimitAlias(session, 4);
    expect(first.match(/\/settings max_agents 4/g)).toHaveLength(1);
    await setSessionThreadLimitDirectly(session, 1);
    const repeated = await submitSessionThreadLimitAlias(session, 4);
    expect(repeated.match(/\/settings max_agents 4/g)).toHaveLength(2);

    await exitInteractive(session);
    sessions.splice(sessions.indexOf(session), 1);
  }, 60_000);

  it('validates a Teams limit, saves it, and accepts the direct settings command', async () => {
    const state = await createTempAutohandHome({
      config: {
        ui: { promptSuggestions: false },
        features: { automaticSpecialists: false },
        teams: { maxTeammates: 3 },
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

    const validationScreen = await configureSessionThreadLimit(session);
    expect(validationScreen).toContain('Session thread limit (main agent included)');
    expect(validationScreen).toContain('integer between 1 and 64');
    expect(await fs.readJson(state.configPath)).toMatchObject({
      features: { multi_agent_v2: { max_concurrent_threads_per_session: 4 } },
      teams: { maxTeammates: 3 },
    });

    await setSessionThreadLimitDirectly(session, 1);
    const saved = await loadConfig(state.configPath, undefined, { initializeTheme: false });
    expect(saved.features?.multi_agent_v2?.max_concurrent_threads_per_session).toBe(1);
    expect(saved.features?.automaticSpecialists).toBe(false);
    expect(saved.teams?.maxTeammates).toBe(3);

    await exitInteractive(session);
    sessions.splice(sessions.indexOf(session), 1);
  }, 90_000);
});
