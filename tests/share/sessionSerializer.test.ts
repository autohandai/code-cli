/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { serializeSession } from '../../src/share/sessionSerializer';
import type { Session } from '../../src/session/SessionManager';
import type { SessionMetadata, SessionMessage } from '../../src/session/types';

describe('sessionSerializer', () => {
  let mockSession: Session;
  let mockMetadata: SessionMetadata;
  let mockMessages: SessionMessage[];

  beforeEach(() => {
    mockMetadata = {
      sessionId: 'test-session-123',
      createdAt: '2025-01-10T10:00:00.000Z',
      lastActiveAt: '2025-01-10T10:30:00.000Z',
      projectPath: '/home/user/project',
      projectName: 'my-project',
      model: 'anthropic/claude-3.5-sonnet',
      messageCount: 4,
      status: 'active',
    };

    mockMessages = [
      {
        role: 'user',
        content: 'Hello, can you help me?',
        timestamp: '2025-01-10T10:00:00.000Z',
      },
      {
        role: 'assistant',
        content: 'Of course! How can I help you today?',
        timestamp: '2025-01-10T10:00:05.000Z',
        toolCalls: [
          {
            function: { name: 'read_file', arguments: '{"path": "/test.ts"}' },
          },
        ],
      },
      {
        role: 'tool',
        content: 'File content here...',
        timestamp: '2025-01-10T10:00:06.000Z',
        name: 'read_file',
      },
      {
        role: 'assistant',
        content: 'I found the file.',
        timestamp: '2025-01-10T10:00:10.000Z',
      },
    ];

    mockSession = {
      metadata: mockMetadata,
      getMessages: vi.fn().mockReturnValue(mockMessages),
      getState: vi.fn().mockReturnValue(null),
    } as unknown as Session;
  });

  describe('serializeSession', () => {
    it('should serialize session with basic options', () => {
      const result = serializeSession(mockSession, {
        model: 'anthropic/claude-3.5-sonnet',
        provider: 'openrouter',
        visibility: 'public',
        deviceId: 'test-device-123',
      });

      expect(result.metadata.sessionId).toBe('test-session-123');
      expect(result.metadata.projectName).toBe('my-project');
      expect(result.metadata.model).toBe('anthropic/claude-3.5-sonnet');
      expect(result.visibility).toBe('public');
      expect(result.client.deviceId).toBe('test-device-123');
      expect(result.messages).toHaveLength(4);
    });

    it('should calculate duration correctly', () => {
      const closedMetadata = {
        ...mockMetadata,
        closedAt: '2025-01-10T10:30:00.000Z',
      };
      mockSession.metadata = closedMetadata;

      const result = serializeSession(mockSession, {
        model: 'anthropic/claude-3.5-sonnet',
        visibility: 'public',
        deviceId: 'test-device',
      });

      // 30 minutes = 1800 seconds
      expect(result.metadata.durationSeconds).toBe(1800);
    });

    it('should extract tool usage from messages', () => {
      const result = serializeSession(mockSession, {
        model: 'anthropic/claude-3.5-sonnet',
        visibility: 'public',
        deviceId: 'test-device',
      });

      expect(result.toolUsage).toHaveLength(1);
      expect(result.toolUsage[0].name).toBe('read_file');
      expect(result.toolUsage[0].count).toBe(1);
    });

    it('should use provided token count', () => {
      const result = serializeSession(mockSession, {
        model: 'anthropic/claude-3.5-sonnet',
        visibility: 'public',
        deviceId: 'test-device',
        totalTokens: 50000,
      });

      expect(result.usage.totalTokens).toBe(50000);
      expect(result.usage.inputTokens).toBe(15000); // 30% of total
      expect(result.usage.outputTokens).toBe(35000); // 70% of total
    });

    it('should estimate tokens from messages when not provided', () => {
      const result = serializeSession(mockSession, {
        model: 'anthropic/claude-3.5-sonnet',
        visibility: 'public',
        deviceId: 'test-device',
      });

      // Tokens estimated from message content length
      expect(result.usage.totalTokens).toBeGreaterThan(0);
      expect(result.usage.inputTokens).toBeGreaterThan(0);
      expect(result.usage.outputTokens).toBeGreaterThan(0);
    });

    it('should include git diff when provided', () => {
      const gitDiff = `diff --git a/test.ts b/test.ts
--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,4 @@
+// New line
 const x = 1;
-const y = 2;
+const y = 3;`;

      const result = serializeSession(mockSession, {
        model: 'anthropic/claude-3.5-sonnet',
        visibility: 'public',
        deviceId: 'test-device',
        gitDiff,
      });

      expect(result.gitDiff).toBeDefined();
      expect(result.gitDiff?.filesChanged).toContain('test.ts');
      expect(result.gitDiff?.linesAdded).toBe(2);
      expect(result.gitDiff?.linesRemoved).toBe(1);
    });

    it('should strip _meta from messages', () => {
      const messagesWithMeta: SessionMessage[] = [
        {
          role: 'user',
          content: 'Test',
          timestamp: '2025-01-10T10:00:00.000Z',
          _meta: { sensitive: 'data' },
        },
      ];
      mockSession.getMessages = vi.fn().mockReturnValue(messagesWithMeta);

      const result = serializeSession(mockSession, {
        model: 'anthropic/claude-3.5-sonnet',
        visibility: 'public',
        deviceId: 'test-device',
      });

      expect(result.messages[0]).not.toHaveProperty('_meta');
    });

    it('should include userId when provided', () => {
      const result = serializeSession(mockSession, {
        model: 'anthropic/claude-3.5-sonnet',
        visibility: 'private',
        deviceId: 'test-device',
        userId: 'user-123',
      });

      expect(result.userId).toBe('user-123');
      expect(result.visibility).toBe('private');
    });
  });
});
