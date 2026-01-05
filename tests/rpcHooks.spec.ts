/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RPC_NOTIFICATIONS } from '../src/modes/rpc/types.js';

// Capture notifications written to stdout
let writtenNotifications: Array<{ method: string; params: Record<string, unknown> }> = [];

// Mock the protocol module
vi.mock('../src/modes/rpc/protocol.js', () => ({
  writeNotification: vi.fn((method: string, params: Record<string, unknown>) => {
    writtenNotifications.push({ method, params });
  }),
  createTimestamp: vi.fn(() => '2025-01-01T00:00:00.000Z'),
  generateId: vi.fn((prefix: string) => `${prefix}_test123`),
}));

// Import after mocking
import { RPCAdapter } from '../src/modes/rpc/adapter.js';

describe('RPC Hook Notifications', () => {
  let adapter: RPCAdapter;

  beforeEach(() => {
    writtenNotifications = [];
    adapter = new RPCAdapter();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('RPC_NOTIFICATIONS constants', () => {
    it('defines hook notification types', () => {
      expect(RPC_NOTIFICATIONS.HOOK_PRE_TOOL).toBe('autohand.hook.preTool');
      expect(RPC_NOTIFICATIONS.HOOK_POST_TOOL).toBe('autohand.hook.postTool');
      expect(RPC_NOTIFICATIONS.HOOK_FILE_MODIFIED).toBe('autohand.hook.fileModified');
      expect(RPC_NOTIFICATIONS.HOOK_PRE_PROMPT).toBe('autohand.hook.prePrompt');
      expect(RPC_NOTIFICATIONS.HOOK_POST_RESPONSE).toBe('autohand.hook.postResponse');
      expect(RPC_NOTIFICATIONS.HOOK_SESSION_ERROR).toBe('autohand.hook.sessionError');
    });
  });

  describe('emitHookPreTool', () => {
    it('emits pre-tool notification with correct params', () => {
      adapter.emitHookPreTool('tool_123', 'read_file', { path: '/test/file.ts' });

      expect(writtenNotifications).toHaveLength(1);
      expect(writtenNotifications[0].method).toBe('autohand.hook.preTool');
      expect(writtenNotifications[0].params).toEqual({
        toolId: 'tool_123',
        toolName: 'read_file',
        args: { path: '/test/file.ts' },
        timestamp: '2025-01-01T00:00:00.000Z',
      });
    });

    it('handles empty args', () => {
      adapter.emitHookPreTool('tool_456', 'get_workspace', {});

      expect(writtenNotifications[0].params.args).toEqual({});
    });
  });

  describe('emitHookPostTool', () => {
    it('emits post-tool notification on success', () => {
      adapter.emitHookPostTool('tool_123', 'read_file', true, 150, 'file contents');

      expect(writtenNotifications).toHaveLength(1);
      expect(writtenNotifications[0].method).toBe('autohand.hook.postTool');
      expect(writtenNotifications[0].params).toEqual({
        toolId: 'tool_123',
        toolName: 'read_file',
        success: true,
        duration: 150,
        output: 'file contents',
        timestamp: '2025-01-01T00:00:00.000Z',
      });
    });

    it('emits post-tool notification on failure', () => {
      adapter.emitHookPostTool('tool_789', 'write_file', false, 50, undefined);

      expect(writtenNotifications[0].params.success).toBe(false);
      expect(writtenNotifications[0].params.output).toBeUndefined();
    });

    it('handles zero duration', () => {
      adapter.emitHookPostTool('tool_abc', 'quick_op', true, 0);

      expect(writtenNotifications[0].params.duration).toBe(0);
    });
  });

  describe('emitHookFileModified', () => {
    it('emits file-modified notification for create', () => {
      adapter.emitHookFileModified('/src/new-file.ts', 'create', 'tool_123');

      expect(writtenNotifications).toHaveLength(1);
      expect(writtenNotifications[0].method).toBe('autohand.hook.fileModified');
      expect(writtenNotifications[0].params).toEqual({
        filePath: '/src/new-file.ts',
        changeType: 'create',
        toolId: 'tool_123',
        timestamp: '2025-01-01T00:00:00.000Z',
      });
    });

    it('emits file-modified notification for modify', () => {
      adapter.emitHookFileModified('/src/existing.ts', 'modify', 'tool_456');

      expect(writtenNotifications[0].params.changeType).toBe('modify');
    });

    it('emits file-modified notification for delete', () => {
      adapter.emitHookFileModified('/src/old-file.ts', 'delete', 'tool_789');

      expect(writtenNotifications[0].params.changeType).toBe('delete');
    });
  });

  describe('emitHookPrePrompt', () => {
    it('emits pre-prompt notification with instruction and files', () => {
      adapter.emitHookPrePrompt('Add unit tests', ['src/foo.ts', 'src/bar.ts']);

      expect(writtenNotifications).toHaveLength(1);
      expect(writtenNotifications[0].method).toBe('autohand.hook.prePrompt');
      expect(writtenNotifications[0].params).toEqual({
        instruction: 'Add unit tests',
        mentionedFiles: ['src/foo.ts', 'src/bar.ts'],
        timestamp: '2025-01-01T00:00:00.000Z',
      });
    });

    it('handles empty mentioned files', () => {
      adapter.emitHookPrePrompt('General question', []);

      expect(writtenNotifications[0].params.mentionedFiles).toEqual([]);
    });
  });

  describe('emitHookPostResponse', () => {
    it('emits post-response notification with usage stats', () => {
      adapter.emitHookPostResponse(1500, 3, 2500);

      expect(writtenNotifications).toHaveLength(1);
      expect(writtenNotifications[0].method).toBe('autohand.hook.postResponse');
      expect(writtenNotifications[0].params).toEqual({
        tokensUsed: 1500,
        toolCallsCount: 3,
        duration: 2500,
        timestamp: '2025-01-01T00:00:00.000Z',
      });
    });

    it('handles zero values', () => {
      adapter.emitHookPostResponse(0, 0, 0);

      expect(writtenNotifications[0].params.tokensUsed).toBe(0);
      expect(writtenNotifications[0].params.toolCallsCount).toBe(0);
      expect(writtenNotifications[0].params.duration).toBe(0);
    });
  });

  describe('emitHookSessionError', () => {
    it('emits session-error notification with error details', () => {
      adapter.emitHookSessionError('API rate limit exceeded', 'RATE_LIMIT', { retryAfter: 60 });

      expect(writtenNotifications).toHaveLength(1);
      expect(writtenNotifications[0].method).toBe('autohand.hook.sessionError');
      expect(writtenNotifications[0].params).toEqual({
        error: 'API rate limit exceeded',
        code: 'RATE_LIMIT',
        context: { retryAfter: 60 },
        timestamp: '2025-01-01T00:00:00.000Z',
      });
    });

    it('handles error without code', () => {
      adapter.emitHookSessionError('Unknown error');

      expect(writtenNotifications[0].params.code).toBeUndefined();
      expect(writtenNotifications[0].params.context).toBeUndefined();
    });

    it('handles error with code but no context', () => {
      adapter.emitHookSessionError('Timeout', 'TIMEOUT');

      expect(writtenNotifications[0].params.code).toBe('TIMEOUT');
      expect(writtenNotifications[0].params.context).toBeUndefined();
    });
  });

  describe('notification sequence', () => {
    it('emits multiple notifications in order', () => {
      adapter.emitHookPrePrompt('Test instruction', []);
      adapter.emitHookPreTool('t1', 'read_file', { path: 'a.ts' });
      adapter.emitHookPostTool('t1', 'read_file', true, 100);
      adapter.emitHookFileModified('/src/a.ts', 'modify', 't2');
      adapter.emitHookPostResponse(500, 1, 1000);

      expect(writtenNotifications).toHaveLength(5);
      expect(writtenNotifications.map(n => n.method)).toEqual([
        'autohand.hook.prePrompt',
        'autohand.hook.preTool',
        'autohand.hook.postTool',
        'autohand.hook.fileModified',
        'autohand.hook.postResponse',
      ]);
    });
  });
});
