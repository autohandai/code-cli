/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs-extra before importing modules that use it
vi.mock('fs-extra', () => ({
  default: {
    ensureFile: vi.fn().mockResolvedValue(undefined),
    appendFile: vi.fn().mockResolvedValue(undefined),
    ensureDir: vi.fn().mockResolvedValue(undefined),
    pathExists: vi.fn().mockResolvedValue(false),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    readJson: vi.fn(),
    writeJson: vi.fn(),
  },
}));

// Mock the prompt utility
vi.mock('../../src/utils/prompt.js', () => ({
  safePrompt: vi.fn(),
}));

// Mock chalk to avoid ANSI in tests
vi.mock('chalk', () => ({
  default: {
    gray: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
    cyan: (s: string) => s,
    bold: {
      cyan: (s: string) => s,
      green: (s: string) => s,
    },
  },
}));

// Must import after mocks are set up
import { feedback } from '../../src/commands/feedback.js';
import { safePrompt } from '../../src/utils/prompt.js';

describe('feedback command', () => {
  let originalFetch: typeof global.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;
  let consoleOutput: string[];
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    // Mock fetch
    originalFetch = global.fetch;
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Capture console output
    consoleOutput = [];
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    console.log = (...args: unknown[]) => {
      consoleOutput.push(args.join(' '));
    };
    console.error = (...args: unknown[]) => {
      consoleOutput.push(args.join(' '));
    };

    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  describe('rating capture', () => {
    it('should prompt for rating (1-5) in addition to feedback text', async () => {
      // Simulate user providing rating and feedback
      (safePrompt as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rating: '4' })
        .mockResolvedValueOnce({ feedback: 'Great CLI tool!' });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, id: 'test-123' }),
      });

      await feedback({ sessionManager: null as any });

      // Should call safePrompt for rating first, then for feedback text
      expect(safePrompt).toHaveBeenCalledTimes(2);

      // First call should be for rating
      const firstCall = (safePrompt as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(firstCall).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'rating',
          }),
        ])
      );
    });

    it('should accept ratings from 1-5 or skip', async () => {
      (safePrompt as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rating: '5' })
        .mockResolvedValueOnce({ feedback: 'Love it!' });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, id: 'test-456' }),
      });

      await feedback({ sessionManager: null as any });

      // Verify API was called with npsScore
      expect(mockFetch).toHaveBeenCalled();
      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.npsScore).toBe(5);
    });
  });

  describe('API submission', () => {
    it('should send feedback to api.autohand.ai', async () => {
      (safePrompt as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rating: '3' })
        .mockResolvedValueOnce({ feedback: 'Works okay' });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, id: 'test-789' }),
      });

      await feedback({ sessionManager: null as any });

      expect(mockFetch).toHaveBeenCalled();
      const fetchCall = mockFetch.mock.calls[0];
      const url = fetchCall[0];

      // Should use api.autohand.ai as base URL
      expect(url).toContain('https://api.autohand.ai');
      expect(url).toContain('/v1/feedback');
    });

    it('should include required fields matching API schema', async () => {
      (safePrompt as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rating: '4' })
        .mockResolvedValueOnce({ feedback: 'The feedback text' });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, id: 'test-schema' }),
      });

      await feedback({ sessionManager: null as any });

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);

      // Required fields per API schema
      expect(body).toHaveProperty('npsScore');
      expect(body).toHaveProperty('triggerType', 'manual');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('deviceId');
      expect(body).toHaveProperty('cliVersion');
      expect(body).toHaveProperty('platform');

      // Free-form feedback should be in freeformFeedback field
      expect(body).toHaveProperty('freeformFeedback', 'The feedback text');
    });

    it('should set npsScore to 0 when user skips rating', async () => {
      (safePrompt as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rating: 'skip' })
        .mockResolvedValueOnce({ feedback: 'Just text feedback' });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, id: 'test-skip' }),
      });

      await feedback({ sessionManager: null as any });

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);

      // npsScore should be 0 for skipped rating (per API schema: 0 = no rating)
      expect(body.npsScore).toBe(0);
    });

    it('should include environment info in env field', async () => {
      (safePrompt as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rating: '5' })
        .mockResolvedValueOnce({ feedback: 'Excellent!' });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, id: 'test-env' }),
      });

      await feedback({ sessionManager: null as any });

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);

      expect(body).toHaveProperty('env');
      expect(body.env).toHaveProperty('platform');
      expect(body.env).toHaveProperty('node');
      expect(body.env).toHaveProperty('cwd');
    });

    it('should include runtime error if present', async () => {
      // Set up a runtime error
      (globalThis as any).__autohandLastError = new Error('Test error');

      (safePrompt as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rating: '2' })
        .mockResolvedValueOnce({ feedback: 'Had an error' });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, id: 'test-error' }),
      });

      await feedback({ sessionManager: null as any });

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);

      expect(body).toHaveProperty('runtimeError');
      expect(body.runtimeError).toHaveProperty('message', 'Test error');

      // Clean up
      delete (globalThis as any).__autohandLastError;
    });
  });

  describe('cooldown rate limiting', () => {
    it('should allow feedback when no previous submissions exist', async () => {
      const fs = await import('fs-extra');
      (fs.default.pathExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      (safePrompt as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rating: '5' })
        .mockResolvedValueOnce({ feedback: 'First feedback!' });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, id: 'test-first' }),
      });

      await feedback({ sessionManager: null as any });

      // Should proceed to API call
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should block feedback when 5 submissions made in last hour', async () => {
      const fs = await import('fs-extra');
      const now = Date.now();
      const recentSubmissions = [
        now - 5 * 60 * 1000,   // 5 min ago
        now - 10 * 60 * 1000,  // 10 min ago
        now - 15 * 60 * 1000,  // 15 min ago
        now - 20 * 60 * 1000,  // 20 min ago
        now - 25 * 60 * 1000,  // 25 min ago
      ];

      (fs.default.pathExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (fs.default.readJson as ReturnType<typeof vi.fn>).mockResolvedValue({
        submissions: recentSubmissions,
      });

      await feedback({ sessionManager: null as any });

      // Should NOT prompt for feedback or call API
      expect(safePrompt).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();

      // Should show rate limit message
      expect(consoleOutput.some(msg => msg.includes('limit') || msg.includes('wait'))).toBe(true);
    });

    it('should allow feedback when old submissions are outside 1 hour window', async () => {
      const fs = await import('fs-extra');
      const now = Date.now();
      const oldSubmissions = [
        now - 2 * 60 * 60 * 1000,  // 2 hours ago
        now - 3 * 60 * 60 * 1000,  // 3 hours ago
        now - 4 * 60 * 60 * 1000,  // 4 hours ago
        now - 5 * 60 * 60 * 1000,  // 5 hours ago
        now - 6 * 60 * 60 * 1000,  // 6 hours ago
      ];

      (fs.default.pathExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (fs.default.readJson as ReturnType<typeof vi.fn>).mockResolvedValue({
        submissions: oldSubmissions,
      });

      (safePrompt as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rating: '4' })
        .mockResolvedValueOnce({ feedback: 'Back again!' });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, id: 'test-allowed' }),
      });

      await feedback({ sessionManager: null as any });

      // Should proceed to API call since old submissions don't count
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should save submission timestamp after successful feedback', async () => {
      const fs = await import('fs-extra');
      (fs.default.pathExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      (safePrompt as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rating: '5' })
        .mockResolvedValueOnce({ feedback: 'Great!' });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, id: 'test-save' }),
      });

      await feedback({ sessionManager: null as any });

      // Should save the cooldown state
      expect(fs.default.writeJson).toHaveBeenCalled();
      const writeCall = (fs.default.writeJson as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(writeCall[1]).toHaveProperty('submissions');
      expect(writeCall[1].submissions.length).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      (safePrompt as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rating: '4' })
        .mockResolvedValueOnce({ feedback: 'Test feedback' });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      // Should not throw
      const result = await feedback({ sessionManager: null as any });

      // Should complete without error even if API fails
      expect(result).toBeNull();
    });

    it('should handle network errors gracefully', async () => {
      (safePrompt as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ rating: '4' })
        .mockResolvedValueOnce({ feedback: 'Test feedback' });

      mockFetch.mockRejectedValue(new Error('Network error'));

      // Should not throw
      const result = await feedback({ sessionManager: null as any });
      expect(result).toBeNull();
    });

    it('should discard feedback when user cancels rating prompt', async () => {
      (safePrompt as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      await feedback({ sessionManager: null as any });

      // Should not call API
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
