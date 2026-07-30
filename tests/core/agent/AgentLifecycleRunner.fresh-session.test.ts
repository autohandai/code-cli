/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  resetFreshAgentSessionState,
  startFreshAgentSession,
  type FreshAgentSessionHost,
  type FreshAgentSessionStateHost,
} from '../../../src/core/agent/AgentLifecycleRunner.js';
import { AutohandAgent } from '../../../src/core/agent.js';
import { ImageManager } from '../../../src/core/ImageManager.js';
import type { SessionMetadata } from '../../../src/session/types.js';
import {
  enqueueClaimedMobileInstructionWithImages,
} from '../../../src/core/agent/AgentDependencyComposer.js';

function sessionMetadata(sessionId: string, projectPath: string): SessionMetadata {
  return {
    sessionId,
    createdAt: '2026-07-29T00:00:00.000Z',
    lastActiveAt: '2026-07-30T00:00:00.000Z',
    projectPath,
    projectName: 'workspace',
    model: 'history-model',
    messageCount: 2,
    status: 'active',
  };
}

function createFreshSessionHost(): {
  host: FreshAgentSessionHost & FreshAgentSessionStateHost;
  events: string[];
} {
  const events: string[] = [];
  let currentSession: {
    metadata: {
      sessionId: string;
      model: string;
    };
    getMessages: ReturnType<typeof vi.fn>;
  } | null = {
    metadata: {
      sessionId: 'agent-session-old',
      model: 'old-model',
    },
    getMessages: vi.fn(() => []),
  };

  const host: FreshAgentSessionHost & FreshAgentSessionStateHost = {
    runtime: {
      workspaceRoot: '/workspace',
      options: { model: 'new-model' },
      config: { configPath: '/tmp/autohand-test-config.json' },
    },
    activeProvider: 'openrouter',
    sessionStartedAt: Date.parse('2026-07-30T00:00:00.000Z'),
    sessionManager: {
      getCurrentSession: vi.fn(() => currentSession),
      closeSession: vi.fn(async () => {
        events.push('close-old-session');
        currentSession = null;
      }),
      createSession: vi.fn(async (_workspaceRoot: string, model: string) => {
        events.push('create-new-session');
        currentSession = {
          metadata: {
            sessionId: 'agent-session-new',
            model,
          },
          getMessages: vi.fn(() => []),
        };
        return currentSession;
      }),
      listSessions: vi.fn(async () => []),
    },
    stopActiveAgentHeartbeat: vi.fn(async () => {
      events.push('stop-old-heartbeat');
    }),
    startActiveAgentHeartbeat: vi.fn(async () => {
      events.push('start-new-heartbeat');
    }),
    flushScheduledSessionSnapshot: vi.fn(async () => {
      events.push('flush-old-session');
    }),
    cancelPendingTurnMemoryReflections: vi.fn(() => {
      events.push('cancel-old-reflections');
    }),
    syncFreshAgentSessionSnapshot: vi.fn(async () => {
      events.push('sync-old-session');
    }),
    hookManager: {
      executeHooks: vi.fn(async (name: string) => {
        events.push(name);
      }),
    },
    telemetryManager: {
      endSession: vi.fn(async () => {
        events.push('end-old-telemetry');
      }),
      startSession: vi.fn(async () => {
        events.push('start-new-telemetry');
      }),
    },
    feedbackManager: {
      startSession: vi.fn(() => {
        events.push('start-new-feedback');
      }),
    },
    resetConversationContext: vi.fn(async () => {
      events.push('reset-conversation');
    }),
    resetAgentStateForFreshSession: vi.fn((startedAt: number) => {
      resetFreshAgentSessionState(host, startedAt);
    }),
    injectSessionBootstrap: vi.fn(async () => {
      events.push('inject-bootstrap');
    }),
    restoreSessionState: vi.fn(async (sessionId: string) => {
      currentSession = {
        metadata: {
          sessionId,
          model: 'history-model',
        },
        getMessages: vi.fn(() => []),
      };
      return currentSession;
    }),
    imageManager: {
      clear: vi.fn(() => {
        events.push('clear-images');
      }),
      add: vi.fn(() => 1),
      formatPlaceholder: vi.fn(() => '[Image #1]'),
    },
    taskStartedAt: 1,
    totalTokensUsed: 91,
    currentTurnActualUsage: { kind: 'actual', promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    currentTurnHadUnavailableUsage: true,
    lastTurnActualUsage: { kind: 'actual', promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    sessionTokensUsed: 91,
    sessionActualTokensUsed: 89,
    sessionTokenUsageUnavailable: true,
    sessionPromptTokens: 60,
    sessionCompletionTokens: 29,
    lastContextTokens: 70,
    filesModifiedThisSession: true,
    fileModCount: 3,
    modifiedFilePaths: new Set(['src/old.ts']),
    executedActionNames: ['write_file'],
    searchQueries: ['old query'],
    sessionRetryCount: 2,
    consecutiveCancellations: 1,
    restoredChatMessages: [{ role: 'user', content: 'old prompt' }],
    lastAssistantResponseForNotification: 'old response',
    lastActivityAt: Date.parse('2026-07-30T00:00:30.000Z'),
  };

  return { host, events };
}

function makeMobileAgent(host: FreshAgentSessionHost & FreshAgentSessionStateHost) {
  const agent = Object.assign(
    Object.create(AutohandAgent.prototype) as AutohandAgent,
    host,
  ) as unknown as {
    runInstruction: AutohandAgent['runInstruction'];
    instructionRunner: { run: ReturnType<typeof vi.fn> };
    files: {
      enterPreviewMode: ReturnType<typeof vi.fn>;
      getPendingChanges: ReturnType<typeof vi.fn>;
      clearPendingChanges: ReturnType<typeof vi.fn>;
      exitPreviewMode: ReturnType<typeof vi.fn>;
    };
    conversation: { history: ReturnType<typeof vi.fn> };
    mobileTurnFailureMessage: string | null;
    lastAssistantResponseForNotification: string;
  };
  agent.mobileTurnFailureMessage = null;
  agent.lastAssistantResponseForNotification = '';
  (agent as any).createFreshAgentSessionHost = vi.fn(() => host);
  agent.instructionRunner = { run: vi.fn(async () => true) };
  agent.files = {
    enterPreviewMode: vi.fn(),
    getPendingChanges: vi.fn(() => []),
    clearPendingChanges: vi.fn(),
    exitPreviewMode: vi.fn(),
  };
  agent.conversation = { history: vi.fn(() => []) };
  return agent;
}

describe('startFreshAgentSession', () => {
  it('rotates the agent session and resets per-session state without shutting down the runtime', async () => {
    const { host, events } = createFreshSessionHost();

    const identity = await startFreshAgentSession(host);

    expect(identity).toEqual({ agentSessionId: 'agent-session-new' });
    expect(events).toEqual([
      'cancel-old-reflections',
      'stop-old-heartbeat',
      'flush-old-session',
      'close-old-session',
      'session-end',
      'sync-old-session',
      'end-old-telemetry',
      'reset-conversation',
      'clear-images',
      'create-new-session',
      'start-new-feedback',
      'start-new-heartbeat',
      'inject-bootstrap',
      'start-new-telemetry',
      'session-start',
    ]);
    expect(host.sessionManager.closeSession).toHaveBeenCalledWith(
      'Session ended - new mobile task started',
    );
    expect(host.sessionManager.createSession).toHaveBeenCalledWith('/workspace', 'new-model');
    expect(host.hookManager.executeHooks).toHaveBeenNthCalledWith(1, 'session-end', {
      sessionId: 'agent-session-old',
      sessionEndReason: 'clear',
      duration: expect.any(Number),
    });
    expect(host.hookManager.executeHooks).toHaveBeenNthCalledWith(2, 'session-start', {
      sessionId: 'agent-session-new',
      sessionType: 'clear',
    });
    expect(host.telemetryManager.startSession).toHaveBeenCalledWith(
      'agent-session-new',
      'new-model',
      'openrouter',
      expect.any(Number),
      {},
    );
    expect(host.totalTokensUsed).toBe(0);
    expect(host.sessionTokensUsed).toBe(0);
    expect(host.sessionActualTokensUsed).toBe(0);
    expect(host.sessionTokenUsageUnavailable).toBe(false);
    expect(host.sessionPromptTokens).toBe(0);
    expect(host.sessionCompletionTokens).toBe(0);
    expect(host.lastContextTokens).toBe(0);
    expect(host.filesModifiedThisSession).toBe(false);
    expect(host.fileModCount).toBe(0);
    expect(host.modifiedFilePaths).toEqual(new Set());
    expect(host.executedActionNames).toEqual([]);
    expect(host.searchQueries).toEqual([]);
    expect(host.sessionRetryCount).toBe(0);
    expect(host.consecutiveCancellations).toBe(0);
    expect(host.restoredChatMessages).toEqual([]);
    expect(host.lastAssistantResponseForNotification).toBe('');
    expect(host.imageManager.clear).toHaveBeenCalledOnce();
    expect(host.syncFreshAgentSessionSnapshot).toHaveBeenCalledOnce();
  });

  it('uses a distinct start timestamp after finalizing the old session', async () => {
    const { host } = createFreshSessionHost();
    const endedAt = Date.parse('2026-07-30T00:01:00.000Z');
    const startedAt = Date.parse('2026-07-30T00:01:05.000Z');
    const now = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(endedAt)
      .mockReturnValue(startedAt);

    try {
      await startFreshAgentSession(host);
    } finally {
      now.mockRestore();
    }

    expect(host.hookManager.executeHooks).toHaveBeenNthCalledWith(1, 'session-end', {
      sessionId: 'agent-session-old',
      sessionEndReason: 'clear',
      duration: 60_000,
    });
    expect(host.sessionStartedAt).toBe(startedAt);
    expect(host.telemetryManager.startSession).toHaveBeenCalledWith(
      'agent-session-new',
      'new-model',
      'openrouter',
      startedAt,
      {},
    );
  });

  it('keeps bare session rotation free of feedback, hooks, and telemetry', async () => {
    const { host } = createFreshSessionHost();
    host.runtime.options.bare = true;

    await expect(startFreshAgentSession(host)).resolves.toEqual({
      agentSessionId: 'agent-session-new',
    });

    expect(host.sessionManager.closeSession).toHaveBeenCalledOnce();
    expect(host.sessionManager.createSession).toHaveBeenCalledOnce();
    expect(host.feedbackManager.startSession).not.toHaveBeenCalled();
    expect(host.injectSessionBootstrap).not.toHaveBeenCalled();
    expect(host.hookManager.executeHooks).not.toHaveBeenCalled();
    expect(host.telemetryManager.endSession).not.toHaveBeenCalled();
    expect(host.syncFreshAgentSessionSnapshot).not.toHaveBeenCalled();
    expect(host.telemetryManager.startSession).not.toHaveBeenCalled();
  });
});

describe('mobile agent context boundary', () => {
  it('completes a fresh rotation before executing the claimed instruction', async () => {
    const { host } = createFreshSessionHost();
    const agent = makeMobileAgent(host);
    const turn = {
      workId: 'mobile-work-fresh',
      prompt: 'start a new task',
      startedAt: '2026-07-30T00:01:00.000Z',
      agentContext: 'fresh' as const,
      agentSessionId: undefined as string | undefined,
    };
    const publishClaimedTurnSession = vi.fn(async () => {});
    const mobileTurn = {
      turn,
      relay: {
        finishClaimedTurn: vi.fn(async () => {}),
        publishClaimedTurnSession,
        requestChangesDecision: vi.fn(),
        refreshDeliveryStatus: vi.fn(async () => {}),
        publishArtifactsFromText: vi.fn(async () => {}),
      },
    };
    agent.instructionRunner.run = vi.fn(async () => {
      expect(host.sessionManager.getCurrentSession()?.metadata.sessionId).toBe('agent-session-new');
      expect(turn.agentSessionId).toBe('agent-session-new');
      expect(publishClaimedTurnSession).toHaveBeenCalledWith(turn);
      return true;
    });

    await expect(agent.runInstruction(turn.prompt, { mobileTurn })).resolves.toBe(true);

    expect(agent.instructionRunner.run).toHaveBeenCalledWith(turn.prompt, { mobileTurn });
  });

  it('clears prior images then hydrates only the executing fresh turn attachments', async () => {
    const { host } = createFreshSessionHost();
    const imageManager = new ImageManager();
    imageManager.add(Buffer.from('old-session-image'), 'image/png', 'old.png');
    host.imageManager = imageManager;
    const agent = makeMobileAgent(host);
    const turn = {
      workId: 'mobile-work-fresh-image',
      prompt: 'inspect this image',
      startedAt: '2026-07-30T00:01:00.000Z',
      agentContext: 'fresh' as const,
      agentSessionId: undefined as string | undefined,
    };
    const mobileTurn = {
      turn,
      relay: {
        finishClaimedTurn: vi.fn(async () => {}),
        publishClaimedTurnSession: vi.fn(async () => {}),
        requestChangesDecision: vi.fn(),
        refreshDeliveryStatus: vi.fn(async () => {}),
        publishArtifactsFromText: vi.fn(async () => {}),
      },
    };
    const pendingInstructions: Array<{
      text: string;
      mobileTurn: typeof mobileTurn;
    }> = [];
    enqueueClaimedMobileInstructionWithImages(
      { pendingInkInstructions: pendingInstructions },
      turn.prompt,
      [{
        data: Buffer.from('fresh-turn-image').toString('base64'),
        mimeType: 'image/png',
        filename: 'fresh.png',
      }],
      mobileTurn,
    );
    const pending = pendingInstructions[0];
    agent.instructionRunner.run = vi.fn(async (instruction: string) => {
      expect(instruction).toBe('inspect this image\n\n[Image #1] fresh.png');
      expect(imageManager.count()).toBe(1);
      expect(imageManager.get(1)?.data.toString()).toBe('fresh-turn-image');
      expect(imageManager.get(1)?.filename).toBe('fresh.png');
      return true;
    });

    await expect(agent.runInstruction(pending.text, {
      mobileTurn: pending.mobileTurn,
    })).resolves.toBe(true);

    expect((mobileTurn as typeof mobileTurn & { pendingImages?: unknown }).pendingImages)
      .toBeUndefined();
  });

  it('uses the current agent session for continue without rotating it', async () => {
    const { host } = createFreshSessionHost();
    const agent = makeMobileAgent(host);
    const turn = {
      workId: 'mobile-work-continue',
      prompt: 'continue the task',
      startedAt: '2026-07-30T00:01:00.000Z',
      agentContext: 'continue' as const,
      agentSessionId: undefined as string | undefined,
    };
    const mobileTurn = {
      turn,
      relay: {
        finishClaimedTurn: vi.fn(async () => {}),
        publishClaimedTurnSession: vi.fn(async () => {}),
        requestChangesDecision: vi.fn(),
        refreshDeliveryStatus: vi.fn(async () => {}),
        publishArtifactsFromText: vi.fn(async () => {}),
      },
    };
    agent.instructionRunner.run = vi.fn(async () => {
      expect(turn.agentSessionId).toBe('agent-session-old');
      return true;
    });

    await expect(agent.runInstruction(turn.prompt, { mobileTurn })).resolves.toBe(true);

    expect(host.sessionManager.closeSession).not.toHaveBeenCalled();
    expect(host.sessionManager.createSession).not.toHaveBeenCalled();
    expect(agent.instructionRunner.run).toHaveBeenCalledWith(turn.prompt, { mobileTurn });
  });

  it('restores an exact local same-workspace session before executing resume work', async () => {
    const { host } = createFreshSessionHost();
    const agent = makeMobileAgent(host);
    const targetSessionId = 'history-session-1';
    vi.mocked(host.sessionManager.listSessions!).mockResolvedValue([
      sessionMetadata(targetSessionId, '/workspace'),
    ]);
    const turn = {
      workId: 'mobile-work-resume',
      prompt: 'continue the historical task',
      startedAt: '2026-07-30T00:01:00.000Z',
      agentContext: 'resume' as const,
      resumeSessionId: targetSessionId,
      agentSessionId: undefined as string | undefined,
    };
    const publishClaimedTurnSession = vi.fn(async () => {});
    const finishClaimedTurn = vi.fn(async () => {});
    const mobileTurn = {
      turn,
      relay: {
        finishClaimedTurn,
        publishClaimedTurnSession,
        requestChangesDecision: vi.fn(),
        refreshDeliveryStatus: vi.fn(async () => {}),
        publishArtifactsFromText: vi.fn(async () => {}),
      },
    };
    agent.instructionRunner.run = vi.fn(async () => {
      expect(host.restoreSessionState).toHaveBeenCalledWith(targetSessionId);
      expect(turn.agentSessionId).toBe(targetSessionId);
      expect(publishClaimedTurnSession).toHaveBeenCalledWith(turn);
      return true;
    });

    await expect(agent.runInstruction(turn.prompt, { mobileTurn })).resolves.toBe(true);

    expect(host.restoreSessionState).toHaveBeenCalledOnce();
    expect(host.sessionManager.createSession).not.toHaveBeenCalled();
    expect(host.sessionManager.closeSession).not.toHaveBeenCalled();
    expect(finishClaimedTurn).toHaveBeenCalledWith(turn, { status: 'completed' });
  });

  it('fails resume work without fallback or execution when the exact local target is missing', async () => {
    const { host } = createFreshSessionHost();
    const agent = makeMobileAgent(host);
    const turn = {
      workId: 'mobile-work-resume-missing',
      prompt: 'do not run without history',
      startedAt: '2026-07-30T00:01:00.000Z',
      agentContext: 'resume' as const,
      resumeSessionId: 'missing-session-1',
      agentSessionId: undefined as string | undefined,
    };
    const finishClaimedTurn = vi.fn(async () => {});
    const mobileTurn = {
      turn,
      relay: {
        finishClaimedTurn,
        publishClaimedTurnSession: vi.fn(async () => {}),
        requestChangesDecision: vi.fn(),
        refreshDeliveryStatus: vi.fn(async () => {}),
        publishArtifactsFromText: vi.fn(async () => {}),
      },
    };

    await expect(agent.runInstruction(turn.prompt, { mobileTurn })).rejects.toThrow(
      'Failed to resume agent session: Resume agent session not found locally: missing-session-1',
    );

    expect(host.restoreSessionState).not.toHaveBeenCalled();
    expect(host.sessionManager.createSession).not.toHaveBeenCalled();
    expect(agent.instructionRunner.run).not.toHaveBeenCalled();
    expect(turn.agentSessionId).toBeUndefined();
    expect(finishClaimedTurn).toHaveBeenCalledWith(turn, {
      status: 'failed',
      error: 'Failed to resume agent session: Resume agent session not found locally: missing-session-1',
    });
  });

  it('fails resume work without restoring or executing a target from another workspace', async () => {
    const { host } = createFreshSessionHost();
    const agent = makeMobileAgent(host);
    const targetSessionId = 'history-session-other-workspace';
    vi.mocked(host.sessionManager.listSessions!).mockResolvedValue([
      sessionMetadata(targetSessionId, '/another/workspace'),
    ]);
    const turn = {
      workId: 'mobile-work-resume-wrong-workspace',
      prompt: 'do not cross workspace boundaries',
      startedAt: '2026-07-30T00:01:00.000Z',
      agentContext: 'resume' as const,
      resumeSessionId: targetSessionId,
      agentSessionId: undefined as string | undefined,
    };
    const finishClaimedTurn = vi.fn(async () => {});
    const mobileTurn = {
      turn,
      relay: {
        finishClaimedTurn,
        publishClaimedTurnSession: vi.fn(async () => {}),
        requestChangesDecision: vi.fn(),
        refreshDeliveryStatus: vi.fn(async () => {}),
        publishArtifactsFromText: vi.fn(async () => {}),
      },
    };

    await expect(agent.runInstruction(turn.prompt, { mobileTurn })).rejects.toThrow(
      `Failed to resume agent session: Resume agent session ${targetSessionId} belongs to a different workspace`,
    );

    expect(host.restoreSessionState).not.toHaveBeenCalled();
    expect(host.sessionManager.createSession).not.toHaveBeenCalled();
    expect(agent.instructionRunner.run).not.toHaveBeenCalled();
    expect(finishClaimedTurn).toHaveBeenCalledWith(turn, {
      status: 'failed',
      error: `Failed to resume agent session: Resume agent session ${targetSessionId} belongs to a different workspace`,
    });
  });

  it('rejects a non-canonical resume session ID before local lookup', async () => {
    const { host } = createFreshSessionHost();
    const agent = makeMobileAgent(host);
    const turn = {
      workId: 'mobile-work-resume-invalid',
      prompt: 'do not resolve paths as session references',
      startedAt: '2026-07-30T00:01:00.000Z',
      agentContext: 'resume' as const,
      resumeSessionId: '../history-session-1',
      agentSessionId: undefined as string | undefined,
    };
    const finishClaimedTurn = vi.fn(async () => {});
    const mobileTurn = {
      turn,
      relay: {
        finishClaimedTurn,
        publishClaimedTurnSession: vi.fn(async () => {}),
        requestChangesDecision: vi.fn(),
        refreshDeliveryStatus: vi.fn(async () => {}),
        publishArtifactsFromText: vi.fn(async () => {}),
      },
    };

    await expect(agent.runInstruction(turn.prompt, { mobileTurn })).rejects.toThrow(
      'Failed to resume agent session: Resume mobile work requires a canonical resume session ID',
    );

    expect(host.sessionManager.listSessions).not.toHaveBeenCalled();
    expect(host.restoreSessionState).not.toHaveBeenCalled();
    expect(agent.instructionRunner.run).not.toHaveBeenCalled();
  });

  it('defaults an omitted agent context to continue', async () => {
    const { host } = createFreshSessionHost();
    const agent = makeMobileAgent(host);
    const turn = {
      workId: 'mobile-work-default-continue',
      prompt: 'continue by default',
      startedAt: '2026-07-30T00:01:00.000Z',
      agentContext: undefined as 'fresh' | 'continue' | undefined,
      agentSessionId: undefined as string | undefined,
    };
    const mobileTurn = {
      turn,
      relay: {
        finishClaimedTurn: vi.fn(async () => {}),
        publishClaimedTurnSession: vi.fn(async () => {}),
        requestChangesDecision: vi.fn(),
        refreshDeliveryStatus: vi.fn(async () => {}),
        publishArtifactsFromText: vi.fn(async () => {}),
      },
    };

    await expect(agent.runInstruction(turn.prompt, { mobileTurn })).resolves.toBe(true);

    expect(turn.agentContext).toBe('continue');
    expect(turn.agentSessionId).toBe('agent-session-old');
    expect(host.sessionManager.closeSession).not.toHaveBeenCalled();
  });

  it('fails the claimed work without executing it when fresh rotation fails', async () => {
    const { host } = createFreshSessionHost();
    const agent = makeMobileAgent(host);
    const turn = {
      workId: 'mobile-work-failed-fresh',
      prompt: 'start a task that cannot be isolated',
      startedAt: '2026-07-30T00:01:00.000Z',
      agentContext: 'fresh' as const,
      agentSessionId: undefined as string | undefined,
    };
    const finishClaimedTurn = vi.fn(async () => {
      host.shouldExit = true;
    });
    const publishArtifactsFromText = vi.fn(async () => {});
    const mobileTurn = {
      turn,
      relay: {
        finishClaimedTurn,
        publishClaimedTurnSession: vi.fn(async () => {}),
        requestChangesDecision: vi.fn(),
        refreshDeliveryStatus: vi.fn(async () => {}),
        publishArtifactsFromText,
      },
    };
    agent.conversation.history = vi.fn(() => [
      { role: 'assistant', content: 'artifact from the previous agent session' },
    ]);
    host.sessionManager.createSession = vi.fn(async () => {
      throw new Error('session storage unavailable');
    });

    await expect(agent.runInstruction(turn.prompt, { mobileTurn })).rejects.toThrow(
      'Failed to start a fresh agent session: session storage unavailable',
    );

    expect(agent.instructionRunner.run).not.toHaveBeenCalled();
    expect(finishClaimedTurn).toHaveBeenCalledWith(turn, {
      status: 'failed',
      error: 'Failed to start a fresh agent session: session storage unavailable',
    });
    expect(publishArtifactsFromText).not.toHaveBeenCalled();
  });
});
