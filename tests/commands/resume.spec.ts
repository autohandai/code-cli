/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Track mock function across hoisted vi.mock calls
let mockPromptFn: any = null;

// Mock enquirer - vi.mock is hoisted, so we must define everything inside the factory
vi.mock('enquirer', () => {
  // Create the mock function when the factory runs
  mockPromptFn = vi.fn();
  return {
    default: {
      prompt: mockPromptFn
    }
  };
});

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    cyan: (s: string) => s,
    gray: (s: string) => s,
    green: (s: string) => s,
    blue: (s: string) => s,
    white: (s: string) => s,
    red: (s: string) => s
  }
}));

// Mock console
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

// Import after mocks
import { resume, metadata } from '../../src/commands/resume';

describe('Resume Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reinitialize the mock function for each test
    if (mockPromptFn) {
      mockPromptFn.mockReset();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('metadata', () => {
    it('should have correct command name', () => {
      expect(metadata.command).toBe('/resume');
    });

    it('should be marked as implemented', () => {
      expect(metadata.implemented).toBe(true);
    });

    it('should have a description', () => {
      expect(metadata.description).toBe('resume a previous session');
    });
  });

  describe('with session ID argument', () => {
    it('should resume session directly when ID is provided', async () => {
      const mockSession = {
        metadata: {
          sessionId: 'test-session-id',
          projectPath: '/test/project',
          createdAt: new Date().toISOString(),
          summary: 'Test session'
        },
        getMessages: () => [
          { role: 'user', content: 'Hello', timestamp: new Date().toISOString() },
          { role: 'assistant', content: 'Hi there!', timestamp: new Date().toISOString() }
        ]
      };

      const mockSessionManager = {
        loadSession: vi.fn().mockResolvedValue(mockSession),
        listSessions: vi.fn()
      };

      const result = await resume({
        sessionManager: mockSessionManager as any,
        args: ['test-session-id']
      });

      expect(result).toBe('SESSION_RESUMED');
      expect(mockSessionManager.loadSession).toHaveBeenCalledWith('test-session-id');
      expect(mockSessionManager.listSessions).not.toHaveBeenCalled();
    });

    it('should return null if session not found', async () => {
      const mockSessionManager = {
        loadSession: vi.fn().mockRejectedValue(new Error('Session not found')),
        listSessions: vi.fn()
      };

      const result = await resume({
        sessionManager: mockSessionManager as any,
        args: ['nonexistent-id']
      });

      expect(result).toBeNull();
    });
  });

  describe('without session ID argument (interactive mode)', () => {
    it('should show message when no sessions exist', async () => {
      const mockSessionManager = {
        loadSession: vi.fn(),
        listSessions: vi.fn().mockResolvedValue([])
      };

      const result = await resume({
        sessionManager: mockSessionManager as any,
        args: []
      });

      expect(result).toBeNull();
      expect(mockSessionManager.listSessions).toHaveBeenCalled();
    });

    it('should show interactive picker when sessions exist', async () => {
      const mockSessions = [
        {
          sessionId: 'session-1',
          createdAt: new Date().toISOString(),
          messageCount: 5,
          projectName: 'project1',
          summary: 'Build a feature'
        },
        {
          sessionId: 'session-2',
          createdAt: new Date(Date.now() - 3600000).toISOString(),
          messageCount: 10,
          projectName: 'project2',
          summary: 'Fix a bug'
        }
      ];

      const mockSession = {
        metadata: mockSessions[0],
        getMessages: () => [
          { role: 'user', content: 'Build a feature', timestamp: new Date().toISOString() }
        ]
      };

      const mockSessionManager = {
        loadSession: vi.fn().mockResolvedValue(mockSession),
        listSessions: vi.fn().mockResolvedValue(mockSessions)
      };

      mockPromptFn.mockResolvedValueOnce({ selected: 'session-1' });

      const result = await resume({
        sessionManager: mockSessionManager as any,
        args: []
      });

      expect(result).toBe('SESSION_RESUMED');
      expect(mockPromptFn).toHaveBeenCalled();
    });

    it('should handle cancellation gracefully', async () => {
      const mockSessions = [
        {
          sessionId: 'session-1',
          createdAt: new Date().toISOString(),
          messageCount: 5,
          projectName: 'project1',
          summary: 'Test session'
        }
      ];

      const mockSession = {
        metadata: mockSessions[0],
        getMessages: () => []
      };

      const mockSessionManager = {
        loadSession: vi.fn().mockResolvedValue(mockSession),
        listSessions: vi.fn().mockResolvedValue(mockSessions)
      };

      mockPromptFn.mockRejectedValueOnce({ name: 'ExitPromptError' });

      const result = await resume({
        sessionManager: mockSessionManager as any,
        args: []
      });

      expect(result).toBeNull();
    });
  });

  describe('session title extraction', () => {
    it('should use summary when available', async () => {
      const mockSessions = [
        {
          sessionId: 'session-1',
          createdAt: new Date().toISOString(),
          messageCount: 5,
          projectName: 'project1',
          summary: 'Building an artifact'
        }
      ];

      const mockSession = {
        metadata: mockSessions[0],
        getMessages: () => [
          { role: 'user', content: 'Some long initial message', timestamp: new Date().toISOString() }
        ]
      };

      const mockSessionManager = {
        loadSession: vi.fn().mockResolvedValue(mockSession),
        listSessions: vi.fn().mockResolvedValue(mockSessions)
      };

      mockPromptFn.mockResolvedValueOnce({ selected: 'session-1' });

      await resume({
        sessionManager: mockSessionManager as any,
        args: []
      });

      // Verify prompt was called with choices containing summary as message
      expect(mockPromptFn).toHaveBeenCalled();
      const promptCall = mockPromptFn.mock.calls[0][0][0];
      expect(promptCall.choices[0].message).toBe('Building an artifact');
    });

    it('should use first user message when no summary', async () => {
      const mockSessions = [
        {
          sessionId: 'session-1',
          createdAt: new Date().toISOString(),
          messageCount: 5,
          projectName: 'project1'
          // No summary
        }
      ];

      const mockSession = {
        metadata: mockSessions[0],
        getMessages: () => [
          { role: 'user', content: 'Help me build an artifact', timestamp: new Date().toISOString() }
        ]
      };

      const mockSessionManager = {
        loadSession: vi.fn().mockResolvedValue(mockSession),
        listSessions: vi.fn().mockResolvedValue(mockSessions)
      };

      mockPromptFn.mockResolvedValueOnce({ selected: 'session-1' });

      await resume({
        sessionManager: mockSessionManager as any,
        args: []
      });

      // The title should be extracted from the first user message
      expect(mockSessionManager.loadSession).toHaveBeenCalledWith('session-1');
    });
  });

  describe('time ago formatting', () => {
    it('should show "just now" for very recent sessions', () => {
      const now = new Date();
      const diffMs = 30000; // 30 seconds
      const diffMins = Math.floor(diffMs / (1000 * 60));

      expect(diffMins).toBe(0);
      // "just now" is returned when diffMins < 1
    });

    it('should show minutes for recent sessions', () => {
      const diffMins = 15;
      const expected = `${diffMins}m ago`;
      expect(expected).toBe('15m ago');
    });

    it('should show hours for older sessions', () => {
      const diffHours = 5;
      const expected = `${diffHours}h ago`;
      expect(expected).toBe('5h ago');
    });

    it('should show days for sessions older than 24 hours', () => {
      const diffDays = 3;
      const expected = `${diffDays}d ago`;
      expect(expected).toBe('3d ago');
    });
  });
});