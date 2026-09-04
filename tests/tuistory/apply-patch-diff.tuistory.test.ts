/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { runApplyPatchDiffScenario } from '../../src/testing/scenarios/applyPatchDiffScenario.js';
import {
  createMockAutohandAINativeSequenceServer,
  createTempAutohandHome,
  exitInteractive,
  launchBuiltAutohand,
  type MockNativeAssistantTurn,
  type MockNativeToolServer,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
const servers: MockNativeToolServer[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    session.close();
  }
  for (const server of servers.splice(0)) {
    await server.close();
  }
  for (const state of states.splice(0)) {
    await state.cleanup();
  }
});

describe('apply_patch diff Tuistory', () => {
  it('renders changed lines with the active diff palette', async () => {
    const target = 'patch-target.ts';
    const completionMarker = 'PATCH_DIFF_RENDERED';
    const turns: MockNativeAssistantTurn[] = [];
    const server = await createMockAutohandAINativeSequenceServer(turns);
    servers.push(server);

    const state = await createTempAutohandHome({
      config: {
        provider: 'autohandai',
        autohandai: {
          plan: 'cloud',
          authMode: 'api-key',
          apiKey: 'tuistory-autohand-api-key',
          model: 'moa',
          baseUrl: server.baseUrl,
        },
        features: { autohand_inference: true, automaticSpecialists: false },
        agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
        network: { maxRetries: 0, retryDelay: 0 },
        ui: {
          promptSuggestions: false,
          showCompletionNotification: false,
          terminalBell: false,
        },
      },
    });
    states.push(state);
    const absoluteTarget = path.join(state.workspaceRoot, target);
    await fs.writeFile(absoluteTarget, 'const oldValue = true;\n');
    turns.push(
      {
        content: 'Reading the file before changing it.',
        toolCall: {
          id: 'call_read_patch_target',
          name: 'read_file',
          args: { path: absoluteTarget },
        },
      },
      {
        content: 'The read result confirms the first line uses oldValue, so I can safely apply the exact one-line replacement.',
        toolCall: {
          id: 'call_apply_patch_target',
          name: 'apply_patch',
          args: {
            path: absoluteTarget,
            patch: [
              '@@ -1 +1 @@',
              '-const oldValue = true;',
              '+const newValue = true;',
            ].join('\n'),
          },
        },
      },
      { content: completionMarker },
    );

    const session = await launchBuiltAutohand([
      '--path', state.workspaceRoot,
      '--config', state.configPath,
      '--yes',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      env: {
        NO_COLOR: undefined,
        FORCE_COLOR: '3',
        COLORTERM: 'truecolor',
        TERM: 'xterm-256color',
      },
      waitForDataTimeout: 15_000,
    });
    sessions.push(session);

    const { output, rawOutput } = await runApplyPatchDiffScenario(session, {
      instruction: 'Change oldValue to newValue using apply_patch.',
      completionMarker,
    });

    expect(server.requests).toHaveLength(3);
    await expect(fs.readFile(absoluteTarget, 'utf8')).resolves.toBe('const newValue = true;\n');
    expect(output).toContain('✔ apply_patch');
    expect(output).toContain('│    1 -  const oldValue = true;');
    expect(output).toContain('│    1 +  const newValue = true;');
    expect(rawOutput).toContain('\u001b[38;2;244;67;54m  │    1 -  const oldValue = true;');
    expect(rawOutput).toContain('\u001b[38;2;76;175;80m  │    1 +  const newValue = true;');
    await exitInteractive(session);
    sessions.splice(sessions.indexOf(session), 1);
  }, 60_000);
});
