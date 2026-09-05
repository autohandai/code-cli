/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import {
  observeNonInteractiveSecurityReview,
  runInteractiveSecurityReview,
} from '../../src/testing/scenarios/reviewScenario.js';
import {
  createMockAutohandAINativeSequenceServer,
  createTempAutohandHome,
  expectCleanExit,
  exitInteractive,
  launchBuiltAutohand,
  waitForExit,
  type MockNativeToolServer,
  type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
const servers: MockNativeToolServer[] = [];

afterEach(async () => {
  sessions.splice(0).forEach((session) => session.close());
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(states.splice(0).map((state) => state.cleanup()));
});

function appendLifecycleEvent(event: string): string {
  return `node -e "require('node:fs').appendFileSync('review-events.log','${event}\\n')"`;
}

describe('/review built CLI', () => {
  it('executes interactively through the model and brackets the turn with lifecycle hooks', async () => {
    const server = await createMockAutohandAINativeSequenceServer([
      { content: 'REVIEW_TUI_COMPLETE\n\nNo critical security findings in the fixture.' },
    ]);
    servers.push(server);
    const state = await createTempAutohandHome({
      config: {
        provider: 'autohandai',
        autohandai: {
          plan: 'cloud',
          authMode: 'api-key',
          apiKey: 'tuistory-key',
          model: 'moa',
          baseUrl: server.baseUrl,
        },
        features: { autohand_inference: true },
        agent: { autoMemory: false, sessionRetryLimit: 0 },
        network: { maxRetries: 0 },
        ui: {
          promptSuggestions: false,
          showCompletionNotification: false,
          terminalBell: false,
        },
        hooks: {
          enabled: true,
          hooks: ['review:start', 'review:completed', 'review:end'].map((event) => ({
            event,
            command: appendLifecycleEvent(event),
          })),
        },
      },
    });
    states.push(state);
    const session = await launchBuiltAutohand(
      ['--path', state.workspaceRoot, '--config', state.configPath, '--yes'],
      {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        cols: 120,
        rows: 32,
      },
    );
    sessions.push(session);

    await runInteractiveSecurityReview(session);

    const transcript = session.readAll();
    expect(transcript).toContain('/review security src --audience forensic');
    expect(transcript).toContain('REVIEW_TUI_COMPLETE');
    expect(transcript).not.toContain('# Autohand Review invocation');
    const modelMessages = server.requests[0]?.messages as Array<{ content?: string }>;
    const modelInstruction = modelMessages.at(-1)?.content ?? '';
    expect(modelInstruction).toContain('# Autohand Review invocation');
    expect(modelInstruction).toContain('"kind": "security"');
    const lifecycleLogPath = path.join(state.workspaceRoot, 'review-events.log');
    await expect.poll(
      async () => fs.readFile(lifecycleLogPath, 'utf8').catch(() => ''),
      { timeout: 10_000 },
    ).toBe('review:start\nreview:completed\nreview:end\n');

    await exitInteractive(session);
  }, 60_000);

  it('runs autohand review as one non-interactive turn and exits', async () => {
    const server = await createMockAutohandAINativeSequenceServer([
      { content: 'REVIEW_CLI_COMPLETE\n\nNo critical security findings in the fixture.' },
    ]);
    servers.push(server);
    const state = await createTempAutohandHome({
      config: {
        provider: 'autohandai',
        autohandai: {
          plan: 'cloud',
          authMode: 'api-key',
          apiKey: 'tuistory-key',
          model: 'moa',
          baseUrl: server.baseUrl,
        },
        features: { autohand_inference: true },
        agent: { autoMemory: false, sessionRetryLimit: 0 },
        network: { maxRetries: 0 },
        ui: {
          promptSuggestions: false,
          showCompletionNotification: false,
          terminalBell: false,
        },
        hooks: {
          enabled: true,
          hooks: ['review:start', 'review:completed', 'review:end'].map((event) => ({
            event,
            command: appendLifecycleEvent(event),
          })),
        },
      },
    });
    states.push(state);
    const session = await launchBuiltAutohand([
      '--path',
      state.workspaceRoot,
      '--config',
      state.configPath,
      '--offline',
      'review',
      'security',
      'src',
      '--audience',
      'forensic',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      cols: 120,
      rows: 32,
    });
    sessions.push(session);

    await observeNonInteractiveSecurityReview(session);
    await waitForExit(session, 30_000);

    const transcript = session.readAll();
    expect(transcript).toContain('REVIEW_CLI_COMPLETE');
    expect(transcript.match(/REVIEW_CLI_COMPLETE/g)).toHaveLength(1);
    expect(transcript).not.toContain('❯');
    expect(transcript).not.toContain('# Autohand Review invocation');
    expectCleanExit(session);
    const modelInstruction = server.requests
      .map((request) => request.messages as Array<{ content?: string }>)
      .map((messages) => messages.at(-1)?.content ?? '')
      .find((content) => content.includes('"kind": "security"')) ?? '';
    expect(modelInstruction).toContain('# Autohand Review invocation');
    expect(modelInstruction).toContain('"kind": "security"');
    const lifecycleLogPath = path.join(state.workspaceRoot, 'review-events.log');
    await expect.poll(
      async () => fs.readFile(lifecycleLogPath, 'utf8').catch(() => ''),
      { timeout: 10_000 },
    ).toBe('review:start\nreview:completed\nreview:end\n');
  }, 60_000);
});
