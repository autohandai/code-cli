/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MOCK_ISSUE_URL,
  SURVEY_QUESTION,
  answerSurvey,
  createMockFeedbackApiServer,
  fileBugReport,
  openSurveyAndDraftBelowIt,
  runOneTurn,
  sendFeedbackMessage,
  waitForApiRequest,
  type MockFeedbackApiServer,
} from '../../src/testing/scenarios/feedbackScenario.js';
import {
  clearComposerInput,
  createMockOpenRouterSequenceServer,
  createTempAutohandHome,
  exitInteractive,
  launchBuiltAutohand,
} from './helpers/autohandTuistory.js';
import {
  launchInteractive,
  mockServers,
  registerBuiltCliCleanup,
  tempStates,
  trackSession,
  waitForComposer,
} from './helpers/builtCli.js';

registerBuiltCliCleanup();

const apiServers: MockFeedbackApiServer[] = [];

afterEach(async () => {
  for (const server of apiServers.splice(0)) await server.close();
});

async function startApi(): Promise<MockFeedbackApiServer> {
  const server = await createMockFeedbackApiServer();
  apiServers.push(server);
  return server;
}

const QUIET_UI = { promptSuggestions: false, showCompletionNotification: false, terminalBell: false };

describe('non-blocking feedback', () => {
  it.each([1, 2, 3, 4, 5])('shows the survey above the composer and submits the selected score %i unchanged', async (score) => {
    const api = await startApi();
    const session = await launchInteractive({ config: { api: { baseUrl: api.baseUrl }, ui: QUIET_UI } });
    await waitForComposer(session);

    const drafting = await openSurveyAndDraftBelowIt(session, 'still typing');
    const lines = drafting.split('\n');
    const surveyRow = lines.findIndex((line) => line.includes(SURVEY_QUESTION));
    const composerRow = lines.findIndex((line) => line.includes('❯') && line.includes('still typing'));
    const optionsRow = lines.findIndex((line) => line.includes('1: Bad'));
    expect(surveyRow).toBeGreaterThanOrEqual(0);
    expect(lines[surveyRow]).not.toContain('1: Bad');
    expect(optionsRow).toBe(surveyRow + 1);
    expect(lines[optionsRow]).toContain('5: Great');
    expect(lines[optionsRow]).toContain('0: Dismiss');
    expect(optionsRow).toBeLessThan(composerRow);
    expect(api.requests).toHaveLength(0);

    await clearComposerInput(session);
    const acknowledgement = await answerSurvey(session, String(score));

    const [request] = await waitForApiRequest(api, '/v1/feedback');
    expect(request?.body).toMatchObject({ npsScore: score, triggerType: 'manual' });
    expect(request?.body).not.toHaveProperty('transcript');

    const settled = await session.text({
      timeout: 10_000,
      waitFor: (text) => !text.includes(acknowledgement) && !text.includes(SURVEY_QUESTION),
      trimEnd: true,
    });
    expect(settled).toContain('❯');

    await exitInteractive(session);
  });

  it('dismisses the survey with 0 and sends nothing', async () => {
    const api = await startApi();
    const session = await launchInteractive({ config: { api: { baseUrl: api.baseUrl }, ui: QUIET_UI } });
    await waitForComposer(session);

    await openSurveyAndDraftBelowIt(session, 'x');
    await clearComposerInput(session);
    await session.type('0');
    await session.text({ timeout: 5_000, waitFor: (text) => !text.includes(SURVEY_QUESTION), trimEnd: true });

    // The digit answered the survey; it must not have been typed into the composer.
    const screen = await session.text({ immediate: true, trimEnd: true });
    expect(screen.split('\n').find((line) => line.includes('❯'))).not.toContain('0');
    expect(api.requests).toHaveLength(0);

    await exitInteractive(session);
  });

  it('sends /feedback <message> in the background with the session transcript', async () => {
    const api = await startApi();
    const llm = await createMockOpenRouterSequenceServer([
      JSON.stringify({ toolCalls: [], finalResponse: 'FEEDBACK_TURN_FINISHED' }),
    ]);
    mockServers.push(llm);
    const session = await launchInteractive({
      config: {
        api: { baseUrl: api.baseUrl },
        openrouter: { baseUrl: llm.baseUrl },
        agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
        network: { maxRetries: 0, retryDelay: 0 },
        ui: QUIET_UI,
      },
    });
    await waitForComposer(session);

    await runOneTurn(session, 'summarise the transcript marker', 'FEEDBACK_TURN_FINISHED');
    await waitForComposer(session);
    await sendFeedbackMessage(session, 'the diff view flickers');

    const [request] = await waitForApiRequest(api, '/v1/feedback');
    expect(request?.body).toMatchObject({
      npsScore: 0,
      triggerType: 'manual',
      freeformFeedback: 'the diff view flickers',
      sessionId: expect.any(String),
    });
    const transcript = request?.body.transcript as { messages: Array<{ role: string; content: string }> };
    expect(transcript.messages.some(({ role, content }) => role === 'user' && content.includes('summarise the transcript marker'))).toBe(true);
    expect(transcript.messages.some(({ content }) => content.includes('FEEDBACK_TURN_FINISHED'))).toBe(true);
    expect(JSON.stringify(transcript)).not.toContain('<system-reminder>');

    await exitInteractive(session);
  });
});

describe('/bug and /bug-report', () => {
  it('files an issue as the gh account and honours --anonymous', async () => {
    const api = await startApi();
    const state = await createTempAutohandHome({ config: { api: { baseUrl: api.baseUrl }, ui: QUIET_UI } });
    tempStates.push(state);
    const binDir = path.join(state.autohandHome, 'fake-bin');
    await mkdir(binDir, { recursive: true });
    await writeFile(path.join(binDir, 'gh'), '#!/bin/sh\necho tuistory-octocat\n');
    await chmod(path.join(binDir, 'gh'), 0o755);

    const session = await trackSession(launchBuiltAutohand(
      ['--path', state.workspaceRoot, '--config', state.configPath],
      {
        autohandHome: state.autohandHome,
        cwd: state.workspaceRoot,
        env: { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}` },
        waitForDataTimeout: 15_000,
      },
    ));
    await waitForComposer(session);

    const filed = await fileBugReport(session, '/bug undo restores the wrong file', 'Bug report filed as @tuistory-octocat');
    expect(filed).toContain(MOCK_ISSUE_URL);
    expect(filed).toContain('❯');

    const [first] = await waitForApiRequest(api, '/v1/reports');
    expect(first?.body).toMatchObject({
      reportKind: 'user',
      errorType: 'user_bug_report',
      errorMessage: 'undo restores the wrong file',
      reporter: { githubLogin: 'tuistory-octocat', githubSource: 'gh' },
      platform: process.platform,
    });
    expect(first?.body.environment).toMatchObject({ os: expect.any(String), runtime: expect.any(String) });

    await fileBugReport(session, '/bug-report --anonymous the composer loses focus', 'Bug report filed:');
    const [, second] = await waitForApiRequest(api, '/v1/reports', 2);
    expect(second?.body).toMatchObject({ reportKind: 'user', errorMessage: 'the composer loses focus' });
    expect(second?.body.reporter).toBeUndefined();

    await exitInteractive(session);
  });

  it('asks for a description instead of filing an empty report', async () => {
    const api = await startApi();
    const session = await launchInteractive({ config: { api: { baseUrl: api.baseUrl }, ui: QUIET_UI } });
    await waitForComposer(session);

    await session.type('/bug');
    await session.press('enter');
    await session.waitForText('Usage: /bug <what went wrong>', { timeout: 10_000 });

    expect(api.requests).toHaveLength(0);

    await exitInteractive(session);
  });
});
