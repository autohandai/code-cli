import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  recordAgentExecutedAction,
  saveAgentAssistantMessage,
  saveAgentUserMessage,
  syncAgentSessionSnapshot,
} from '../../src/core/agent/AgentSessionAccounting.js';
import type { SessionMessage } from '../../src/session/types.js';

function createHost() {
  const messages: SessionMessage[] = [];
  const append = vi.fn(async (message: SessionMessage) => {
    messages.push(message);
  });
  const syncSession = vi.fn(async () => {});
  const startedAt = new Date('2026-05-13T10:00:00.000Z').getTime();
  const host = {
    executedActionNames: [],
    runtime: { workspaceRoot: '/workspace/project' },
    sessionActualTokensUsed: 42,
    sessionManager: {
      getCurrentSession: vi.fn(() => ({
        metadata: { sessionId: 'session-1' },
        append,
        getMessages: () => messages,
      })),
    },
    sessionStartedAt: startedAt,
    telemetryManager: { syncSession },
    totalTokensUsed: 42,
  } as any;

  return { append, host, messages, syncSession };
}

describe('agent near-real-time session sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T10:00:10.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('debounces session snapshots after persisted user and assistant messages', async () => {
    const { append, host, syncSession } = createHost();

    await saveAgentUserMessage(host, 'hello');
    expect(append).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(syncSession).not.toHaveBeenCalled();

    vi.setSystemTime(new Date('2026-05-13T10:00:13.000Z'));
    await saveAgentAssistantMessage(host, 'response');
    await vi.advanceTimersByTimeAsync(4999);
    expect(syncSession).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(syncSession).toHaveBeenCalledTimes(1);
    expect(syncSession).toHaveBeenCalledWith({
      messages: [
        expect.objectContaining({ role: 'user', content: 'hello' }),
        expect.objectContaining({ role: 'assistant', content: 'response' }),
      ],
      metadata: expect.objectContaining({
        workspaceRoot: '/workspace/project',
        startTime: '2026-05-13T10:00:00.000Z',
        durationSeconds: 18,
        totalTokens: 42,
      }),
    });
    expect(syncSession.mock.calls[0][0].metadata).not.toHaveProperty('endTime');
  });

  it('can force a final snapshot with canonical timing metadata', async () => {
    const { host, messages, syncSession } = createHost();
    messages.push({ role: 'user', content: 'finish', timestamp: '2026-05-13T10:00:01.000Z' });

    await syncAgentSessionSnapshot(host, {
      force: true,
      endTimeMs: new Date('2026-05-13T10:02:00.000Z').getTime(),
    });

    expect(syncSession).toHaveBeenCalledTimes(1);
    expect(syncSession).toHaveBeenCalledWith({
      messages: [{ role: 'user', content: 'finish', timestamp: '2026-05-13T10:00:01.000Z' }],
      metadata: expect.objectContaining({
        workspaceRoot: '/workspace/project',
        startTime: '2026-05-13T10:00:00.000Z',
        endTime: '2026-05-13T10:02:00.000Z',
        durationSeconds: 120,
      }),
    });
  });

  it('schedules a snapshot after tool action batches', async () => {
    const { host, messages, syncSession } = createHost();
    messages.push({ role: 'assistant', content: 'ran tests', timestamp: '2026-05-13T10:00:02.000Z' });

    recordAgentExecutedAction(host, 'run_command');
    await vi.advanceTimersByTimeAsync(5000);

    expect(host.executedActionNames).toEqual(['run_command']);
    expect(syncSession).toHaveBeenCalledTimes(1);
  });
});
