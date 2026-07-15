/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  runAgentInteractiveLoop,
  type AgentLifecycleHost,
} from '../../../src/core/agent/AgentLifecycleRunner.js';
import type { PendingPostTurnAction } from '../../../src/core/agent/PostTurnActionCoordinator.js';

describe('interactive post-turn lifecycle', () => {
  it('consumes the structured publication action once after a successful instruction', async () => {
    const action: PendingPostTurnAction = {
      kind: 'publish-research',
      runId: 'run-1',
      reportPath: '.autohand/research/topic.md',
    };
    const runPostTurnAction = vi.fn(async () => {
      host.shouldExit = true;
      return 'Research published: https://openresearch.autohand.ai/research/topic/';
    });
    const closeSession = vi.fn(async () => {});
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const host = {
      useInkRenderer: false,
      inkRenderer: null,
      pendingInkInstructions: [{ text: 'complete the report', postTurnAction: action }],
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
        config: {
          ui: {
            terminalBell: false,
            showCompletionNotification: false,
          },
        },
      },
      logQueuedProcessingMessage: vi.fn(),
      ensureInitComplete: vi.fn(async () => {}),
      flushMcpStartupSummaryIfPending: vi.fn(),
      runInstruction: vi.fn(async () => true),
      runPostTurnAction,
      suggestionEngine: null,
      telemetryManager: {
        trackCommand: vi.fn(async () => {}),
        recordInteraction: vi.fn(),
      },
      feedbackManager: {
        shouldPrompt: vi.fn(() => null),
        recordInteraction: vi.fn(),
      },
      hookManager: {
        executeHooks: vi.fn(async () => {}),
      },
      sessionManager: {
        getCurrentSession: vi.fn(() => ({ metadata: { sessionId: 'session-1' } })),
      },
      getStatusSnapshot: vi.fn(() => ({
        tokensUsed: 0,
        tokensUsageStatus: 'actual',
      })),
      ensureStdinReady: vi.fn(),
      notificationService: {
        notify: vi.fn(async () => {}),
      },
      closeSession,
      lastErrorMessage: null,
      consecutiveErrorCount: 0,
    } as unknown as AgentLifecycleHost;

    try {
      await runAgentInteractiveLoop(host);

      expect(host.runInstruction).toHaveBeenCalledOnce();
      expect(runPostTurnAction).toHaveBeenCalledOnce();
      expect(runPostTurnAction).toHaveBeenCalledWith(action, true);
      expect(host.pendingInkInstructions).toHaveLength(0);
      expect(closeSession).toHaveBeenCalledOnce();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
