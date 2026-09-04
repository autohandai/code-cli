/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { runUndoSafetyScenario } from '../../src/testing/scenarios/undoSafetyScenario.js';
import {
  createMockAutohandAINativeSequenceServer,
  createTempAutohandHome,
  exitInteractive,
  launchBuiltAutohand,
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

describe('/undo Tuistory', () => {
  it('reverts an agent-created file while preserving unrelated work', async () => {
    const completionMarker = 'AGENT_FILE_CREATED';
    const server = await createMockAutohandAINativeSequenceServer([
      {
        content: 'Creating the requested file.',
        toolCall: {
          id: 'call_create_undo_fixture',
          name: 'write_file',
          args: {
            path: 'agent-created.txt',
            contents: 'agent output\n',
          },
        },
      },
      { content: completionMarker },
    ]);
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

    execFileSync('git', ['config', 'user.email', 'tests@autohand.ai'], { cwd: state.workspaceRoot });
    execFileSync('git', ['config', 'user.name', 'Autohand Tests'], { cwd: state.workspaceRoot });
    await fs.writeFile(path.join(state.workspaceRoot, 'user-notes.txt'), 'committed\n');
    execFileSync('git', ['add', '--', '.'], { cwd: state.workspaceRoot });
    execFileSync('git', ['commit', '-m', 'test fixture'], { cwd: state.workspaceRoot, stdio: 'ignore' });
    await fs.writeFile(path.join(state.workspaceRoot, 'user-notes.txt'), 'uncommitted user edit\n');
    await fs.writeFile(path.join(state.workspaceRoot, 'untracked-user-notes.txt'), 'keep me\n');

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

    const output = await runUndoSafetyScenario(session, {
      instruction: 'Create agent-created.txt with the requested fixture content.',
      completionMarker,
    });

    await expect(fs.stat(path.join(state.workspaceRoot, 'agent-created.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.readFile(path.join(state.workspaceRoot, 'user-notes.txt'), 'utf8'))
      .resolves.toBe('uncommitted user edit\n');
    await expect(fs.readFile(path.join(state.workspaceRoot, 'untracked-user-notes.txt'), 'utf8'))
      .resolves.toBe('keep me\n');
    expect(output).toContain('Undo complete. Ready for new instructions.');

    await exitInteractive(session);
    sessions.splice(sessions.indexOf(session), 1);
  }, 60_000);
});
