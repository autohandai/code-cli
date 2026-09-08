/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { requestCompletedWorkSummary } from '../../src/testing/scenarios/responseCompletionScenario.js';
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
  await Promise.allSettled(sessions.splice(0).map((session) => exitInteractive(session)));
  await Promise.allSettled(servers.splice(0).map((server) => server.close()));
  await Promise.allSettled(states.splice(0).map((state) => state.cleanup()));
});

describe('response completion', () => {
  it.each([
    {
      name: 'completed status and quoted intent',
      content: [
        'COMPLETED_WORK_SUMMARY_OK',
        'Status: read and search verification passed.',
        'Saved example: `I will remove the demo data when Demo Off is requested`.',
      ].join('\n'),
      expectedContent: 'Status: read and search verification passed.',
      followup: 'UNEXPECTED_COMPLETION_REPAIR',
      expectedRequests: 2,
    },
    {
      name: 'implementation delivered as a code block',
      content: [
        'I will provide the implementation for you:',
        '```ts',
        '// COMPLETED_WORK_SUMMARY_OK',
        'export const hello = 1;',
        '```',
      ].join('\n'),
      expectedContent: 'export const hello = 1;',
      followup: 'UNEXPECTED_COMPLETION_REPAIR',
      expectedRequests: 2,
    },
    {
      name: 'recovery from an action phrase formatted as code',
      content: 'I will `run the test suite` now.',
      expectedContent: 'INLINE_ACTION_RECOVERY_OK',
      followup: 'INLINE_ACTION_RECOVERY_OK',
      expectedRequests: 3,
    },
    {
      name: 'recovery from a next step formatted as code',
      content: 'Next: `inspect src/index.ts`.',
      expectedContent: 'INLINE_ACTION_RECOVERY_OK',
      followup: 'INLINE_ACTION_RECOVERY_OK',
      expectedRequests: 3,
    },
  ])('renders $name after one native tool call', async ({ content, expectedContent, followup, expectedRequests }) => {
    const server = await createMockAutohandAINativeSequenceServer([
      {
        content: 'Reading package.json for verification.',
        toolCall: { id: 'call_verify_package', name: 'read_file', args: { path: 'package.json' } },
      },
      { content },
      { content: followup },
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
        features: { autohand_inference: true },
        agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
        network: { maxRetries: 0, retryDelay: 0 },
        ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
      },
    });
    states.push(state);
    const session = await launchBuiltAutohand([
      '--path', state.workspaceRoot,
      '--config', state.configPath,
      '--y',
    ], {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      waitForDataTimeout: 15_000,
    });
    sessions.push(session);

    const screen = await requestCompletedWorkSummary(session, expectedContent);
    await exitInteractive(session);

    expect(server.requests).toHaveLength(expectedRequests);
    expect(screen).toContain(expectedContent);
    expect(session.readAll()).not.toContain('UNEXPECTED_COMPLETION_REPAIR');
  }, 45_000);
});
