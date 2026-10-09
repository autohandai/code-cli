/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runAgentInteractiveLoop,
  type AgentLifecycleHost,
} from '../../../src/core/agent/AgentLifecycleRunner.js';

function createHost(instructions: string[], overrides: Record<string, unknown> = {}) {
  const events: string[] = [];
  const feedbackSurvey = {
    show: vi.fn(() => { events.push('survey.show'); return true; }),
    clear: vi.fn(() => { events.push('survey.clear'); }),
  };
  const feedbackManager = {
    shouldPrompt: vi.fn((): string | null => 'task_complete'),
    recordInteraction: vi.fn(),
  };
  const host = {
    useInkRenderer: false,
    inkRenderer: null,
    pendingInkInstructions: instructions.map((text) => ({ text, echoInTranscript: false })),
    shouldExit: false,
    persistentInputActiveTurn: false,
    persistentInput: {
      hasQueued: () => false,
      getCurrentInput: () => '',
      stop: vi.fn(),
    },
    runtime: {
      workspaceRoot: '/workspace',
      options: {},
      config: { ui: { terminalBell: false, showCompletionNotification: false } },
    },
    logQueuedProcessingMessage: vi.fn(),
    ensureInitComplete: vi.fn(async () => {}),
    flushMcpStartupSummaryIfPending: vi.fn(),
    runInstruction: vi.fn(async () => {
      events.push('turn');
      if (host.pendingInkInstructions.length === 0) {
        host.shouldExit = true;
      }
      return true;
    }),
    runPostTurnAction: vi.fn(async () => null),
    suggestionEngine: null,
    telemetryManager: {
      trackCommand: vi.fn(async () => {}),
      recordInteraction: vi.fn(),
    },
    feedbackManager,
    feedbackSurvey,
    hookManager: { executeHooks: vi.fn(async () => {}) },
    sessionManager: {
      getCurrentSession: vi.fn(() => ({ metadata: { sessionId: 'session-1' } })),
    },
    getStatusSnapshot: vi.fn(() => ({ tokensUsed: 0, tokensUsageStatus: 'actual' })),
    ensureStdinReady: vi.fn(),
    notificationService: { notify: vi.fn(async () => {}) },
    closeSession: vi.fn(async () => { events.push('close'); }),
    lastErrorMessage: null,
    consecutiveErrorCount: 0,
    // A gap in this partial host must fail the test, not be swallowed by the loop's error path.
    getDisplayErrorMessage: (error: unknown) => { throw error; },
    parseSlashCommand: (instruction: string) => ({ command: instruction, args: [] }),
    isSlashCommandSupported: () => true,
    ...overrides,
  };
  return { host: host as unknown as AgentLifecycleHost & typeof host, events, feedbackSurvey, feedbackManager };
}

describe('feedback survey in the interactive loop', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('offers the survey after a turn without waiting on the user', async () => {
    const { host, feedbackSurvey, feedbackManager } = createHost(['build the feature']);

    await runAgentInteractiveLoop(host);

    expect(feedbackManager.shouldPrompt).toHaveBeenCalledWith({
      userMessage: 'build the feature',
      taskCompleted: true,
    });
    expect(feedbackSurvey.show).toHaveBeenCalledExactlyOnceWith('task_complete', 'session-1');
    expect(host.closeSession).toHaveBeenCalledOnce();
  });

  it('preserves a draft typed after the feedback survey becomes visible', async () => {
    let draft = '';
    const { host } = createHost(['/feedback'], {
      ui: {},
      setComposerIdle: vi.fn(),
      clearComposerInput: vi.fn(() => { draft = ''; }),
      runSlashCommandWithInput: vi.fn(async () => {
        draft = 'still typing';
        host.shouldExit = true;
        return null;
      }),
    });

    await runAgentInteractiveLoop(host);

    expect(draft).toBe('still typing');
  });

  it('clears the previous survey as soon as the next prompt is submitted', async () => {
    const { host, events } = createHost(['first prompt', 'second prompt']);

    await runAgentInteractiveLoop(host);

    expect(events).toEqual([
      'survey.clear', 'turn', 'survey.show',
      'survey.clear', 'turn', 'survey.show',
      'close',
    ]);
  });

  it('does not offer the survey when the manager declines', async () => {
    const { host, feedbackSurvey, feedbackManager } = createHost(['quick question']);
    feedbackManager.shouldPrompt.mockReturnValue(null);

    await runAgentInteractiveLoop(host);

    expect(feedbackSurvey.show).not.toHaveBeenCalled();
  });

  it.each(['/quit', '/exit'])('closes on %s without asking for feedback first', async (command) => {
    const { host, events, feedbackSurvey, feedbackManager } = createHost([command]);

    await runAgentInteractiveLoop(host);

    expect(feedbackManager.shouldPrompt).not.toHaveBeenCalled();
    expect(feedbackSurvey.show).not.toHaveBeenCalled();
    expect(events).toEqual(['survey.clear', 'close']);
  });

  it('keeps working on hosts that were built without a survey controller', async () => {
    const { host } = createHost(['build the feature'], { feedbackSurvey: undefined });

    await expect(runAgentInteractiveLoop(host)).resolves.toBeUndefined();
    expect(host.runInstruction).toHaveBeenCalledOnce();
  });
});
