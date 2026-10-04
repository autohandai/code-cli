/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Session } from 'tuistory';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FIRST_PLAN_NOTES,
  REFINED_PLAN_NOTES,
  REVIEW_PROMPT,
  findPlanFile,
  openEditAndAcceptPlan,
  planUntilReview,
} from '../../src/testing/scenarios/planReviewScenario.js';
import {
  createMockAutohandAINativeSequenceServer, createTempAutohandHome, exitInteractive,
  launchBuiltAutohand, type MockNativeToolServer, type TuistoryTempState,
} from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
const servers: MockNativeToolServer[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) session.close();
  for (const server of servers.splice(0)) await server.close();
  for (const state of states.splice(0)) await state.cleanup();
});

async function launch() {
  const server = await createMockAutohandAINativeSequenceServer([
    { content: 'Drafting a plan.', toolCall: { id: 'first-plan', name: 'plan', args: { notes: FIRST_PLAN_NOTES } } },
    { content: 'Refining the plan.', toolCall: { id: 'refined-plan', name: 'plan', args: { notes: REFINED_PLAN_NOTES } } },
    { content: 'Presenting the plan.', toolCall: { id: 'review-plan', name: 'exit_plan_mode', args: {} } },
    { content: 'PLAN_REVIEW_COMPLETE' },
  ]);
  servers.push(server);
  const state = await createTempAutohandHome({ config: {
    provider: 'autohandai',
    autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-test-key', model: 'moa', baseUrl: server.baseUrl },
    features: { autohand_inference: true },
    agent: { autoMemory: false, maxIterations: 6, sessionRetryLimit: 0 },
    network: { maxRetries: 0, retryDelay: 0 },
    ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
  } });
  states.push(state);

  // A stand-in for the VS Code launcher: records what it was asked to open instead of starting an editor.
  const binDir = path.join(state.autohandHome, 'fake-bin');
  const openedLog = path.join(state.autohandHome, 'opened.log');
  await mkdir(binDir, { recursive: true });
  await writeFile(path.join(binDir, 'code'), `#!/bin/sh\necho "$@" >> "${openedLog}"\n`);
  await chmod(path.join(binDir, 'code'), 0o755);

  const session = await launchBuiltAutohand(
    ['--plan', '--config', state.configPath, '--path', state.workspaceRoot],
    {
      autohandHome: state.autohandHome,
      cwd: state.workspaceRoot,
      rows: 48,
      env: { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}` },
    },
  );
  sessions.push(session);
  return { session, state, server, openedLog };
}

function toolResult(server: MockNativeToolServer, toolCallId: string): string | undefined {
  for (const request of server.requests) {
    const messages = request.messages as Array<{ role: string; tool_call_id?: string; content?: string }> | undefined;
    const result = messages?.find((message) => message.role === 'tool' && message.tool_call_id === toolCallId)?.content;
    if (result) return result;
  }
  return undefined;
}

describe('plan review', () => {
  it('shows the plan as written, goes straight to review after a refinement, and says where the file is', async () => {
    const { session, state } = await launch();

    const review = await planUntilReview(session);
    const everything = session.readAll();

    expect(review).toContain(REVIEW_PROMPT);
    expect(everything).not.toContain('resume an incomplete plan');
    expect(everything).toContain('Refresh session tokens lazily instead of at startup.');
    expect(everything).toContain('note which callers run at startup');
    expect(everything).toContain('The mobile relay reads the token synchronously');
    expect(everything).not.toContain('host plan');
    expect(review).toContain('ctrl-g to open the plan in your editor');
    expect(review.replace(/\s*\n\s*/gu, '')).toContain(path.join(state.autohandHome, 'plans', 'plan-'));

    const planFile = await findPlanFile(path.join(state.autohandHome, 'plans'), 'Replace the eager refresh with a lazy getter');
    const saved = await readFile(planFile, 'utf8');
    expect(saved).toContain('- [ ] 4. Run the test suite');
    expect(saved).not.toContain('- [ ] 5.');
    expect(saved).toContain('## Notes\n\n## Goal\nRefresh session tokens lazily instead of at startup.');

    await session.press('escape');
    await session.waitForText('PLAN_REVIEW_COMPLETE', { timeout: 20_000 });
    await exitInteractive(session);
  });

  it('opens the plan file on ctrl+g and executes the version the user edited', async () => {
    const { session, state, server, openedLog } = await launch();

    await planUntilReview(session);
    const planFile = await findPlanFile(path.join(state.autohandHome, 'plans'), 'Replace the eager refresh with a lazy getter');
    await openEditAndAcceptPlan(session, planFile, 'Add a migration for stored tokens');
    await session.waitForText('PLAN_REVIEW_COMPLETE', { timeout: 20_000 });

    // The launcher is started detached, so its log line can land after the prompt has moved on.
    await expect.poll(() => readFile(openedLog, 'utf8').then((log) => log.trim(), () => ''), { timeout: 10_000 })
      .toBe(`--reuse-window ${planFile}`);
    const accepted = toolResult(server, 'review-plan') ?? '';
    expect(accepted).toContain('The user edited the plan before accepting it');
    expect(accepted).toContain('4. Add a migration for stored tokens\n5. Run the test suite');

    await exitInteractive(session);
  });
});
