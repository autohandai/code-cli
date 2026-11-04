import { afterEach, describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { answerThreeChoiceFollowup, cancelFollowupAndRetainDraft } from '../../src/testing/scenarios/followupQuestionScenario.js';
import { capturedToolResult } from './helpers/adaptiveSkillsFixture.js';
import { createMockAutohandAINativeSequenceServer, createTempAutohandHome, exitInteractive, launchBuiltAutohand,
  waitForExit, type MockNativeToolServer, type TuistoryTempState } from './helpers/autohandTuistory.js';

const sessions: Session[] = [];
const states: TuistoryTempState[] = [];
const servers: MockNativeToolServer[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) { session.close(); await waitForExit(session); }
  await Promise.all(servers.splice(0).map(server => server.close()));
  await Promise.all(states.splice(0).map(state => state.cleanup()));
});

describe('built factual follow-up questions under approval auto-confirm', () => {
  it('collects a real three-choice answer under yes and preserves cancellation and the composer', async () => {
    const server = await createMockAutohandAINativeSequenceServer([
      { content: 'I need your workflow choice.', toolCall: { id: 'workflow-question', name: 'ask_followup_question', args: {
        question: 'Which skill workflow?', suggested_answers: ['Local discovery', 'Registry matching', 'Skill creation'],
      } } },
      { content: 'I also need an environment.', toolCall: { id: 'cancel-question', name: 'ask_followup_question', args: {
        question: 'Which environment?', suggested_answers: ['Staging', 'Production'],
      } } },
      { content: 'FOLLOWUP_QUESTION_COMPLETE' },
    ]);
    servers.push(server);
    const state = await createTempAutohandHome({ config: {
      provider: 'custom:followup-fixture',
      customProviders: { 'followup-fixture': { id: 'followup-fixture', displayName: 'Follow-up Fixture', apiFormat: 'openai-compatible',
        apiKeyRequired: false, model: 'fixture-model', baseUrl: server.baseUrl, backgroundCalls: false, maxConcurrentThreads: 1 } },
      features: { adaptiveSkills: false, autohand_inference: true },
      hooks: { enabled: false, hooks: [] }, agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
      network: { maxRetries: 0 }, ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    states.push(state);
    const session = await launchBuiltAutohand(['--yes', '--path', state.workspaceRoot, '--config', state.configPath], {
      autohandHome: state.autohandHome, cwd: state.workspaceRoot, rows: 40,
      env: { HOME: state.autohandHome, OPENROUTER_API_KEY: undefined, OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined,
        AUTOHAND_API_KEY: undefined, AUTOHAND_AUTH_TOKEN: undefined, AUTOHAND_NON_INTERACTIVE: '0' },
    });
    sessions.push(session);

    const choiceScreen = await answerThreeChoiceFollowup(session);
    expect(choiceScreen).toContain('Which skill workflow?');
    expect(choiceScreen).toMatch(/▸\s+2\. Registry matching/u);
    const resumedScreen = await cancelFollowupAndRetainDraft(session);
    expect(resumedScreen).toContain('FOLLOWUP_RETAINED_DRAFT');
    expect(capturedToolResult(server, 'workflow-question')).toBe('<answer>Registry matching</answer>');
    expect(capturedToolResult(server, 'cancel-question')).toContain('User cancelled this question. Do NOT call ask_followup_question again.');
    expect(server.requests).toHaveLength(3);
    expect(session.getRawOutput()).not.toContain('Auto-answered: Yes');

    await exitInteractive(session);
    expect(session.exitInfo?.exitCode).toBe(0);
  }, 60_000);
});
