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
import fs from 'fs-extra';
import { feedback, type FeedbackCommandContext } from '../../src/commands/feedback.js';
import { safePrompt } from '../../src/utils/prompt.js';
import type { SessionMessage } from '../../src/session/types.js';

const mockedFs = vi.mocked(fs);
const mockedPrompt = vi.mocked(safePrompt);

function sessionWith(messages: SessionMessage[], sessionId = 'session-42'): NonNullable<FeedbackCommandContext['currentSession']> {
  return { metadata: { sessionId }, getMessages: () => messages } as NonNullable<FeedbackCommandContext['currentSession']>;
}

const CONVERSATION: SessionMessage[] = [
  { role: 'user', content: 'rename the helper', timestamp: '2026-10-03T10:00:00.000Z' },
  { role: 'assistant', content: 'Renamed it in 3 files.', timestamp: '2026-10-03T10:00:05.000Z' },
];

describe('feedback command', () => {
  let originalFetch: typeof global.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;
  const originalApiUrl = process.env.AUTOHAND_API_URL;

  const sentPayload = (call = 0) => JSON.parse(mockFetch.mock.calls[call]?.[1]?.body as string) as Record<string, any>;
  const apiAccepts = () => mockFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, id: 'feedback-1' }) });

  beforeEach(() => {
    originalFetch = global.fetch;
    mockFetch = vi.fn();
    global.fetch = mockFetch as unknown as typeof global.fetch;
    delete process.env.AUTOHAND_API_URL;
    delete (globalThis as Record<string, unknown>).__autohandLastError;
    vi.clearAllMocks();
    mockedFs.pathExists.mockResolvedValue(false as never);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiUrl === undefined) {
      delete process.env.AUTOHAND_API_URL;
    } else {
      process.env.AUTOHAND_API_URL = originalApiUrl;
    }
  });

  describe('/feedback <message>', () => {
    it('sends the message with the current session transcript attached', async () => {
      apiAccepts();

      const result = await feedback({ currentSession: sessionWith(CONVERSATION) }, ['the', 'diff', 'view', 'flickers']);

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch.mock.calls[0]?.[0]).toBe('https://api.autohand.ai/v1/feedback');
      const payload = sentPayload();
      expect(payload).toMatchObject({
        npsScore: 0,
        freeformFeedback: 'the diff view flickers',
        triggerType: 'manual',
        sessionId: 'session-42',
        transcript: {
          sessionId: 'session-42',
          messageCount: 2,
          truncated: false,
          messages: [
            { role: 'user', content: 'rename the helper' },
            { role: 'assistant', content: 'Renamed it in 3 files.' },
          ],
        },
      });
      expect(result).toContain('Thank you');
      expect(mockedPrompt).not.toHaveBeenCalled();
    });

    it('includes every field the API schema requires', async () => {
      apiAccepts();

      await feedback({}, ['works', 'well']);

      const payload = sentPayload();
      expect(payload).toEqual(expect.objectContaining({
        timestamp: expect.any(String),
        deviceId: expect.any(String),
        cliVersion: expect.any(String),
        platform: process.platform,
        osVersion: expect.any(String),
        nodeVersion: process.version,
      }));
      expect(payload.env).toEqual(expect.objectContaining({ platform: `${process.platform}-${process.arch}`, node: process.version }));
      expect(payload).not.toHaveProperty('transcript');
      expect(payload).not.toHaveProperty('sessionId');
    });

    it('redacts secrets and the home directory from the message, the transcript and the working directory', async () => {
      apiAccepts();
      const session = sessionWith([
        { role: 'user', content: 'token is ghp_abcdefghijklmnopqrstuvwxyz0123456789', timestamp: '2026-10-03T10:00:00.000Z' },
      ]);

      await feedback({ currentSession: session }, ['my', 'key', 'sk-abcdefghijklmnop1234', 'leaked']);

      const body = mockFetch.mock.calls[0]?.[1]?.body as string;
      expect(body).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
      expect(body).not.toContain('sk-abcdefghijklmnop1234');
      expect(sentPayload().env.cwd).not.toContain(process.env.HOME ?? '/nonexistent-home');
    });

    it('leaves the transcript out when the session has no conversation yet', async () => {
      apiAccepts();

      await feedback({ currentSession: sessionWith([]) }, ['first', 'impression']);

      expect(sentPayload()).not.toHaveProperty('transcript');
      expect(sentPayload().sessionId).toBe('session-42');
    });

    it('attaches the last runtime error when there is one', async () => {
      apiAccepts();
      (globalThis as Record<string, unknown>).__autohandLastError = new Error('Test runtime error');

      const result = await feedback({}, ['it', 'crashed']);

      expect(sentPayload().runtimeError).toEqual(expect.objectContaining({ message: 'Test runtime error' }));
      expect(result).toContain('runtime error');
    });

    it('prefers AUTOHAND_API_URL, then the configured API base URL', async () => {
      apiAccepts();
      const config = { api: { baseUrl: 'https://config.example.test/' } } as FeedbackCommandContext['config'];

      await feedback({ config }, ['hello']);
      expect(mockFetch.mock.calls[0]?.[0]).toBe('https://config.example.test/v1/feedback');

      process.env.AUTOHAND_API_URL = 'https://env.example.test';
      await feedback({ config }, ['hello']);
      expect(mockFetch.mock.calls[1]?.[0]).toBe('https://env.example.test/v1/feedback');
    });

    it('keeps a local copy without the transcript messages', async () => {
      apiAccepts();

      await feedback({ currentSession: sessionWith(CONVERSATION) }, ['note']);

      expect(mockedFs.appendFile).toHaveBeenCalledOnce();
      const line = mockedFs.appendFile.mock.calls[0]?.[1] as string;
      expect(JSON.parse(line)).toMatchObject({ freeformFeedback: 'note', transcript: { messageCount: 2 } });
      expect(line).not.toContain('rename the helper');
    });
  });

  describe('non-blocking delivery', () => {
    it('returns before the API answers and reports the result through notifyUser', async () => {
      let respond!: (value: unknown) => void;
      mockFetch.mockReturnValue(new Promise((resolve) => { respond = resolve; }));
      const notifyUser = vi.fn();

      const result = await feedback({ currentSession: sessionWith(CONVERSATION), notifyUser }, ['slow', 'network']);

      expect(result).toContain('Sending feedback');
      expect(result).toContain('2 messages');
      expect(notifyUser).not.toHaveBeenCalled();

      respond({ ok: true, json: async () => ({ success: true, id: 'feedback-1' }) });
      await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledOnce());
      expect(notifyUser.mock.calls[0]?.[0]).toContain('Thank you');
    });

    it('reports a failed background delivery instead of losing it silently', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));
      const notifyUser = vi.fn();

      await feedback({ notifyUser }, ['offline', 'note']);

      await vi.waitFor(() => expect(notifyUser).toHaveBeenCalledOnce());
      expect(notifyUser.mock.calls[0]?.[0]).toContain('saved locally');
      expect(notifyUser.mock.calls[0]?.[0]).toContain('Network error');
    });

    it('waits for delivery when there is nobody to notify later', async () => {
      apiAccepts();

      const result = await feedback({}, ['from', 'the', 'flag']);

      expect(result).toContain('Thank you');
    });
  });

  describe('/feedback without a message', () => {
    it('opens the survey line above the composer instead of prompting', async () => {
      const requestFeedbackSurvey = vi.fn(() => true);

      const result = await feedback({ requestFeedbackSurvey }, []);

      expect(requestFeedbackSurvey).toHaveBeenCalledOnce();
      expect(result).toContain('/feedback <message>');
      expect(mockedPrompt).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('asks one question when no survey line is available, pausing other input around it', async () => {
      apiAccepts();
      const order: string[] = [];
      mockedPrompt.mockImplementationOnce(async () => {
        order.push('prompt');
        return { message: '  typed in the prompt  ' };
      });

      const result = await feedback({
        requestFeedbackSurvey: () => false,
        onBeforeModal: () => { order.push('before'); },
        onAfterModal: () => { order.push('after'); },
      }, []);

      expect(order).toEqual(['before', 'prompt', 'after']);
      expect(mockedPrompt).toHaveBeenCalledOnce();
      expect(sentPayload().freeformFeedback).toBe('typed in the prompt');
      expect(result).toContain('Thank you');
    });

    it.each([[null], [{ message: '   ' }]])('discards feedback when the prompt returns %j', async (answer) => {
      mockedPrompt.mockResolvedValueOnce(answer as never);

      const result = await feedback({}, []);

      expect(result).toContain('discarded');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('never prompts in a non-interactive session', async () => {
      const result = await feedback({ isNonInteractive: true }, []);

      expect(result).toContain('Usage: /feedback <message>');
      expect(mockedPrompt).not.toHaveBeenCalled();
    });
  });

  describe('cooldown rate limiting', () => {
    it('blocks the sixth submission within an hour', async () => {
      const now = Date.now();
      mockedFs.pathExists.mockResolvedValue(true as never);
      mockedFs.readJson.mockResolvedValue({ submissions: [1, 2, 3, 4, 5].map((minutes) => now - minutes * 60_000) } as never);

      const result = await feedback({}, ['one', 'more']);

      expect(result).toContain('Feedback limit reached');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('allows feedback when earlier submissions are older than an hour', async () => {
      apiAccepts();
      const now = Date.now();
      mockedFs.pathExists.mockResolvedValue(true as never);
      mockedFs.readJson.mockResolvedValue({ submissions: [1, 2, 3, 4, 5].map((hours) => now - (hours + 1) * 3_600_000) } as never);

      await feedback({}, ['fresh', 'window']);

      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('allows feedback when the cooldown state is corrupted', async () => {
      apiAccepts();
      mockedFs.pathExists.mockResolvedValue(true as never);
      mockedFs.readJson.mockRejectedValue(new Error('Unexpected token'));

      await feedback({}, ['still', 'works']);

      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('records the submission time for the next check', async () => {
      apiAccepts();

      await feedback({}, ['tracked']);

      const cooldownWrite = mockedFs.writeJson.mock.calls.find(([, state]) => 'submissions' in (state as object));
      expect((cooldownWrite?.[1] as { submissions: number[] }).submissions).toHaveLength(1);
    });
  });

  describe('error handling', () => {
    it('reports an API error and keeps the local copy', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => '{"error":"Failed to save feedback"}' });

      const result = await feedback({}, ['server', 'down']);

      expect(result).toContain('saved locally');
      expect(result).toContain('API error: 500 Failed to save feedback');
      expect(mockedFs.appendFile).toHaveBeenCalledOnce();
    });

    it('reduces an HTML challenge page to one readable line', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>__cf_chl_opt</body></html>',
      });

      const result = await feedback({}, ['blocked']);

      expect(result).toContain('API error: 403 blocked by Cloudflare challenge');
      expect(result).not.toContain('<html>');
      expect(result).not.toContain('__cf_chl_opt');
    });

    it('explains a rate-limited response', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 429, text: async () => '{"error":"Rate limit exceeded"}' });

      const result = await feedback({}, ['too', 'many']);

      expect(result).toContain('rate limited');
    });

    it('survives a failing local backup', async () => {
      apiAccepts();
      mockedFs.appendFile.mockRejectedValueOnce(new Error('EACCES') as never);

      const result = await feedback({}, ['read-only', 'home']);

      expect(result).toContain('Thank you');
    });
  });
});
