/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { selectMaximumMoaReasoning } from '../../src/testing/scenarios/maxReasoningThreadsScenario.js';
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

describe('maximum reasoning thread warning Tuistory', () => {
  it.each([
    { label: 'default nine-thread session', limit: undefined, warns: true },
    { label: 'four-thread session', limit: 4, warns: false },
  ])('sets maximum Moa reasoning in a $label', async ({ limit, warns }) => {
    const state = await createTempAutohandHome({
      config: {
        provider: 'autohandai',
        autohandai: {
          plan: 'cloud',
          authMode: 'api-key',
          apiKey: 'tuistory-autohand-api-key',
          model: 'moa',
          reasoningEffort: 'high',
        },
        features: {
          autohand_inference: true,
          automaticSpecialists: false,
          ...(limit === undefined ? {} : { multi_agent_v2: { max_concurrent_threads_per_session: limit } }),
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
      cols: 240,
      waitForDataTimeout: 15_000,
    });
    sessions.push(session);

    const output = await selectMaximumMoaReasoning(session);

    expect(await fs.readJson(state.configPath)).toMatchObject({
      provider: 'autohandai',
      autohandai: { model: 'moa', reasoningEffort: 'xhigh' },
    });
    if (warns) {
      expect(output).toContain('This session is configured for 9 concurrent threads with up to 8 subagents');
      expect(output).toContain('which can increase usage quickly');
      expect(output).toContain('features.multi_agent_v2.max_concurrent_threads_per_session below 8');
    } else {
      expect(output).not.toContain('This session is configured for');
      expect(output).not.toContain('which can increase usage quickly');
      expect(await fs.readJson(state.configPath)).toMatchObject({
        features: { multi_agent_v2: { max_concurrent_threads_per_session: 4 } },
      });
    }

    await exitInteractive(session);
    sessions.splice(sessions.indexOf(session), 1);
  }, 60_000);
});
