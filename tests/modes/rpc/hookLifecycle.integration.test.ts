/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/modes/rpc/protocol.js', () => ({
  writeNotification: vi.fn(),
  createTimestamp: () => '2026-07-22T00:00:00.000Z',
  generateId: (prefix: string) => `${prefix}_hooks`,
}));

const modelSupportsImages = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('../../../src/providers/modelCapabilities.js', () => ({ modelSupportsImages }));

import { HookManager } from '../../../src/core/HookManager.js';
import type { AutohandAgent } from '../../../src/core/agent.js';
import type { ConversationManager } from '../../../src/core/conversationManager.js';
import { RPCAdapter } from '../../../src/modes/rpc/adapter.js';
import { writeNotification } from '../../../src/modes/rpc/protocol.js';
import type { AgentOutputEvent } from '../../../src/types.js';

const timestamp = '2026-07-22T00:00:00.000Z';

function createHarness() {
  const hookManager = new HookManager({
    workspaceRoot: '/workspace',
    settings: { enabled: false, hooks: [] },
  });
  let outputListener: ((event: AgentOutputEvent) => void) | undefined;
  const agent = {
    setStatusListener: vi.fn(),
    setOutputListener: vi.fn((listener?: (event: AgentOutputEvent) => void) => {
      outputListener = listener;
    }),
    getImageManager: vi.fn().mockReturnValue({ clear: vi.fn() }),
    getHookManager: vi.fn().mockReturnValue(hookManager),
    getFileManager: vi.fn().mockReturnValue(undefined),
    getStatusSnapshot: vi.fn().mockReturnValue({
      tokensUsed: 21,
      tokensUsageStatus: 'actual',
    }),
    getPermissionManager: vi.fn().mockReturnValue({ setMode: vi.fn() }),
    cancelCurrentInstruction: vi.fn(),
    shutdownRuntimeResources: vi.fn().mockResolvedValue(undefined),
    isSlashCommand: vi.fn().mockReturnValue(false),
    parseSlashCommand: vi.fn(),
    isSlashCommandSupported: vi.fn().mockReturnValue(false),
    handleSlashCommand: vi.fn(),
    runInstruction: vi.fn().mockResolvedValue(true),
  };
  const conversation = {
    history: vi.fn().mockReturnValue([]),
    reset: vi.fn(),
  };
  const adapter = new RPCAdapter();
  adapter.initialize(
    agent as unknown as AutohandAgent,
    conversation as unknown as ConversationManager,
    'model',
    '/workspace',
  );
  return { adapter, agent, hookManager, emitOutput: (event: AgentOutputEvent) => outputListener?.(event) };
}

function hookNotifications(): Array<[string, Record<string, unknown>]> {
  return vi.mocked(writeNotification).mock.calls
    .filter(([method]) => method.startsWith('autohand.hook.')) as Array<[
      string,
      Record<string, unknown>,
    ]>;
}

describe('HookManager to RPC lifecycle integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('observes lifecycle events even when user hooks are disabled or unconfigured', async () => {
    const manager = new HookManager({
      workspaceRoot: '/workspace',
      settings: { enabled: false, hooks: [] },
    });
    const listener = vi.fn();

    const unsubscribe = manager.subscribeLifecycle(listener);
    await manager.executeHooks('pre-tool', {
      tool: 'read_file',
      toolCallId: 'tool-1',
      args: { path: 'README.md' },
    });
    unsubscribe();
    await manager.executeHooks('pre-tool', { tool: 'ignored' });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      event: 'pre-tool',
      workspace: '/workspace',
      tool: 'read_file',
      toolCallId: 'tool-1',
      args: { path: 'README.md' },
    });
  });

  it('emits startup exactly once on the real adapter lifecycle', () => {
    const { adapter } = createHarness();

    expect(hookNotifications()).toEqual([
      ['autohand.hook.sessionStart', { sessionType: 'startup', timestamp }],
    ]);
    expect(adapter).toBeDefined();
  });

  it.each([
    ['completed', 'exit'],
    ['aborted', 'exit'],
    ['disconnected', 'exit'],
    ['error', 'error'],
  ] as const)('emits session-end exactly once for %s shutdown', async (shutdownReason, hookReason) => {
    const { adapter } = createHarness();

    vi.mocked(writeNotification).mockClear();
    await adapter.shutdown(shutdownReason);

    expect(hookNotifications()).toEqual([
      ['autohand.hook.sessionEnd', {
        reason: hookReason, duration: expect.any(Number), timestamp,
      }],
    ]);
    expect(vi.mocked(writeNotification).mock.calls.at(-1)?.[0]).toBe('autohand.agentEnd');
  });

  it('closes and starts reset sessions exactly once and restarts the session timer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T00:00:00.000Z'));
    const { adapter, hookManager } = createHarness();
    const executeHooks = vi.spyOn(hookManager, 'executeHooks');
    vi.mocked(writeNotification).mockClear();
    vi.advanceTimersByTime(250);

    await adapter.handleReset('reset-1');

    expect(hookNotifications()).toEqual([
      ['autohand.hook.sessionEnd', { reason: 'clear', duration: 250, timestamp }],
      ['autohand.hook.sessionStart', { sessionType: 'clear', timestamp }],
    ]);
    expect(executeHooks).toHaveBeenCalledWith('session-end', {
      sessionId: 'session_hooks',
      sessionEndReason: 'clear',
      duration: 250,
    });
    expect(executeHooks).toHaveBeenCalledWith('session-start', {
      sessionId: 'session_hooks',
      sessionType: 'clear',
    });

    vi.mocked(writeNotification).mockClear();
    vi.advanceTimersByTime(75);
    await adapter.shutdown('completed');
    expect(hookNotifications()).toEqual([
      ['autohand.hook.sessionEnd', { reason: 'exit', duration: 75, timestamp }],
    ]);
  });

  it('maps every hook lifecycle event to its exact RPC payload once', async () => {
    const { hookManager } = createHarness();
    vi.mocked(writeNotification).mockClear();

    await hookManager.executeHooks('pre-tool', {
      toolCallId: 'tool-1', tool: 'read_file', args: { path: 'README.md' },
    });
    await hookManager.executeHooks('post-tool', {
      toolCallId: 'tool-1', tool: 'read_file', success: true, duration: 12, output: 'ok',
    });
    await hookManager.executeHooks('file-modified', {
      path: '/workspace/README.md', changeType: 'modify', toolCallId: 'tool-1',
    });
    await hookManager.executeHooks('pre-prompt', {
      instruction: 'Fix it', mentionedFiles: ['README.md'],
    });
    await hookManager.executeHooks('stop', {
      tokensUsed: 34, tokensUsageStatus: 'actual', toolCallsCount: 2, turnDuration: 56,
    });
    await hookManager.executeHooks('session-error', {
      error: 'boom', errorCode: 'E_BOOM',
    });
    await hookManager.executeHooks('session-start', { sessionType: 'resume' });
    await hookManager.executeHooks('session-end', { sessionEndReason: 'exit', duration: 78 });
    await hookManager.executeHooks('subagent-stop', {
      subagentId: 'sub-1', subagentName: 'reviewer', subagentType: 'review',
      subagentSuccess: false, subagentDuration: 90, subagentError: 'failed',
    });
    await hookManager.executeHooks('permission-request', {
      tool: 'write_file', path: 'README.md', args: { content: 'next' }, permissionType: 'tool_approval',
    });
    await hookManager.executeHooks('notification', {
      notificationType: 'question', notificationMessage: 'Need input',
    });
    await hookManager.executeHooks('context:compact', {
      croppedCount: 3, summary: 'Earlier work', usagePercent: 0.61, reason: 'tiered-compaction',
    });
    await hookManager.executeHooks('context:overflow', {
      tokensBefore: 1200, tokensAfter: 700, croppedCount: 4, usagePercent: 0.7,
    });
    await hookManager.executeHooks('context:warning', {
      usagePercent: 0.82, remainingTokens: 180,
    });
    await hookManager.executeHooks('context:critical', {
      usagePercent: 0.93, remainingTokens: 40,
    });

    expect(hookNotifications()).toEqual([
      ['autohand.hook.preTool', { toolId: 'tool-1', toolName: 'read_file', args: { path: 'README.md' }, timestamp }],
      ['autohand.hook.postTool', { toolId: 'tool-1', toolName: 'read_file', success: true, duration: 12, output: 'ok', timestamp }],
      ['autohand.hook.fileModified', { filePath: '/workspace/README.md', changeType: 'modify', toolId: 'tool-1', timestamp }],
      ['autohand.hook.prePrompt', { instruction: 'Fix it', mentionedFiles: ['README.md'], timestamp }],
      ['autohand.hook.stop', { tokensUsed: 34, tokensUsageStatus: 'actual', toolCallsCount: 2, duration: 56, timestamp }],
      ['autohand.hook.postResponse', { tokensUsed: 34, tokensUsageStatus: 'actual', toolCallsCount: 2, duration: 56, timestamp }],
      ['autohand.hook.sessionError', { error: 'boom', code: 'E_BOOM', context: undefined, timestamp }],
      ['autohand.hook.sessionStart', { sessionType: 'resume', timestamp }],
      ['autohand.hook.sessionEnd', { reason: 'exit', duration: 78, timestamp }],
      ['autohand.hook.subagentStop', { subagentId: 'sub-1', subagentName: 'reviewer', subagentType: 'review', success: false, duration: 90, error: 'failed', timestamp }],
      ['autohand.hook.permissionRequest', { tool: 'write_file', path: 'README.md', command: undefined, args: { content: 'next' }, timestamp }],
      ['autohand.hook.notification', { notificationType: 'question', message: 'Need input', timestamp }],
      ['autohand.hook.contextCompacted', { croppedCount: 3, summary: 'Earlier work', usagePercent: 0.61, reason: 'tiered-compaction', timestamp }],
      ['autohand.hook.contextOverflow', { tokensBefore: 1200, tokensAfter: 700, croppedCount: 4, usagePercent: 0.7, timestamp }],
      ['autohand.hook.contextWarning', { usagePercent: 0.82, remainingTokens: 180, timestamp }],
      ['autohand.hook.contextCritical', { usagePercent: 0.93, remainingTokens: 40, timestamp }],
    ]);
  });

  it('emits pre-prompt and session-error from the real accepted-prompt path', async () => {
    const { adapter, agent, emitOutput } = createHarness();
    agent.runInstruction.mockImplementationOnce(async () => {
      emitOutput({ type: 'error', content: 'provider failed' });
      return false;
    });
    vi.mocked(writeNotification).mockClear();

    await adapter.handlePrompt('request-1', {
      message: 'Run checks',
      context: { files: ['README.md', 'src/index.ts'] },
    });

    expect(hookNotifications().filter(([method]) => method === 'autohand.hook.prePrompt')).toEqual([
      ['autohand.hook.prePrompt', {
        instruction: 'Run checks',
        mentionedFiles: ['README.md', 'src/index.ts'],
        timestamp,
      }],
    ]);
    expect(hookNotifications().filter(([method]) => method === 'autohand.hook.sessionError')).toEqual([
      ['autohand.hook.sessionError', {
        error: 'provider failed', code: undefined, context: undefined, timestamp,
      }],
    ]);
  });

  it('reports the actual tool-call count for each accepted prompt and resets it for the next turn', async () => {
    const { adapter, agent, emitOutput } = createHarness();
    agent.runInstruction
      .mockImplementationOnce(async () => {
        emitOutput({ type: 'tool_start', toolId: 'tool-1', toolName: 'read_file' });
        emitOutput({ type: 'tool_start', toolId: 'tool-2', toolName: 'write_file' });
        return true;
      })
      .mockResolvedValueOnce(true);
    vi.mocked(writeNotification).mockClear();

    await adapter.handlePrompt('request-1', { message: 'First turn' });
    await adapter.handlePrompt('request-2', { message: 'Second turn' });

    expect(hookNotifications().filter(([method]) => method === 'autohand.hook.stop')).toEqual([
      ['autohand.hook.stop', {
        tokensUsed: 21,
        tokensUsageStatus: 'actual',
        toolCallsCount: 2,
        duration: expect.any(Number),
        timestamp,
      }],
      ['autohand.hook.stop', {
        tokensUsed: 21,
        tokensUsageStatus: 'actual',
        toolCallsCount: 0,
        duration: expect.any(Number),
        timestamp,
      }],
    ]);
    expect(hookNotifications().filter(([method]) => method === 'autohand.hook.postResponse'))
      .toEqual([
        ['autohand.hook.postResponse', {
          tokensUsed: 21,
          tokensUsageStatus: 'actual',
          toolCallsCount: 2,
          duration: expect.any(Number),
          timestamp,
        }],
        ['autohand.hook.postResponse', {
          tokensUsed: 21,
          tokensUsageStatus: 'actual',
          toolCallsCount: 0,
          duration: expect.any(Number),
          timestamp,
        }],
      ]);
  });

  it('detaches the lifecycle observer before sealing shutdown notifications', async () => {
    const { adapter, hookManager } = createHarness();
    vi.mocked(writeNotification).mockClear();

    await adapter.shutdown('disconnected');
    const countAfterShutdown = vi.mocked(writeNotification).mock.calls.length;
    await hookManager.executeHooks('notification', {
      notificationType: 'task_complete',
      notificationMessage: 'too late',
    });

    expect(vi.mocked(writeNotification)).toHaveBeenCalledTimes(countAfterShutdown);
    expect(vi.mocked(writeNotification).mock.calls.at(-1)?.[0]).toBe('autohand.agentEnd');
  });
});
