/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted() so mock functions are available when vi.mock is hoisted
const { mockExistsSync, mockReadFileSync, mockFetch, mockHomedir } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockFetch: vi.fn(),
  mockHomedir: vi.fn(),
}));

// Mock fs-extra
vi.mock('fs-extra', () => ({
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
  },
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

// Mock os.homedir
vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal() as any;
  return {
    ...original,
    default: {
      ...original.default,
      homedir: mockHomedir,
      release: () => '23.0.0',
    },
    homedir: mockHomedir,
    release: () => '23.0.0',
  };
});

// Mock package.json
vi.mock('../../package.json', () => ({
  default: { version: '0.7.14' },
}));

// Mock constants
vi.mock('../../src/constants.js', () => ({
  AUTOHAND_FILES: {
    deviceId: '/home/test/.autohand/device-id',
  },
}));

// Mock global fetch
vi.stubGlobal('fetch', mockFetch);

import { AutoReportClient } from '../../src/reporting/AutoReportClient.js';
import { AutoReportManager } from '../../src/reporting/AutoReportManager.js';
import type { AutohandConfig } from '../../src/types.js';

// Helpers
function makeConfig(overrides: Partial<AutohandConfig> = {}): AutohandConfig {
  return {
    provider: 'openrouter',
    ...overrides,
  } as AutohandConfig;
}

function okResponse(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status: 200 });
}

function errorResponse(status: number, text: string) {
  return new Response(text, { status });
}

// ============================================================
// AutoReportClient
// ============================================================
describe('AutoReportClient', () => {
  let client: AutoReportClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHomedir.mockReturnValue('/Users/testuser');
    client = new AutoReportClient('https://api.test.com');
  });

  describe('getDeviceId()', () => {
    it('returns device ID from file when it exists', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('  dev-id-123  \n');

      expect(client.getDeviceId()).toBe('dev-id-123');
    });

    it('returns anon-* ID when file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const id = client.getDeviceId();
      expect(id).toMatch(/^anon-[a-f0-9]{8}$/);
    });

    it('returns anon-* ID when file read throws', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => { throw new Error('EACCES'); });

      const id = client.getDeviceId();
      expect(id).toMatch(/^anon-[a-f0-9]{8}$/);
    });
  });

  describe('sanitizePaths()', () => {
    it('replaces exact home directory with ~', () => {
      mockHomedir.mockReturnValue('/Users/john');
      const c = new AutoReportClient();
      expect(c.sanitizePaths('Error at /Users/john/project/src/index.ts'))
        .toBe('Error at ~/project/src/index.ts');
    });

    it('replaces /Users/<name> patterns', () => {
      const c = new AutoReportClient();
      const result = c.sanitizePaths('at /Users/someoneelse/code/app.js:10');
      expect(result).not.toContain('/Users/someoneelse');
      expect(result).toContain('~/...');
    });

    it('replaces /home/<name> patterns', () => {
      const c = new AutoReportClient();
      const result = c.sanitizePaths('at /home/deploy/app/server.js');
      expect(result).not.toContain('/home/deploy');
      expect(result).toContain('~/...');
    });

    it('replaces Windows paths with any drive letter', () => {
      const c = new AutoReportClient();
      const result = c.sanitizePaths('at D:\\Users\\john\\project\\index.ts');
      expect(result).not.toContain('D:\\Users\\john');
      expect(result).toContain('~\\...');
    });

    it('backward-compatible sanitizeStack() delegates to sanitizePaths()', () => {
      const c = new AutoReportClient();
      const input = 'Error\n  at /Users/bob/proj/a.ts:1';
      expect(c.sanitizeStack(input)).toBe(c.sanitizePaths(input));
    });
  });

  describe('report()', () => {
    it('sends correct payload to /v1/reports', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('dev-123');
      mockFetch.mockResolvedValue(okResponse({ success: true, issueNumber: 42 }));

      const result = await client.report({
        errorType: 'TestError',
        errorMessage: 'test msg',
      });

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.test.com/v1/reports');
      expect(opts.method).toBe('POST');

      const body = JSON.parse(opts.body);
      expect(body.errorType).toBe('TestError');
      expect(body.deviceId).toBe('dev-123');
      expect(body.cliVersion).toBe('0.7.14');
      expect(body.platform).toBeDefined();
      expect(body.timestamp).toBeDefined();
    });

    it('handles HTTP error responses', async () => {
      mockFetch.mockResolvedValue(errorResponse(500, 'Internal Server Error'));

      const result = await client.report({
        errorType: 'TestError',
        errorMessage: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('500');
    });

    it('handles network errors without throwing', async () => {
      mockFetch.mockRejectedValue(new Error('Network failure'));

      const result = await client.report({
        errorType: 'TestError',
        errorMessage: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network failure');
    });

    it('handles timeout (AbortError)', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      const result = await client.report({
        errorType: 'TestError',
        errorMessage: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Request timeout');
    });

    it('never throws on any failure', async () => {
      mockFetch.mockImplementation(() => { throw new Error('Catastrophic'); });

      const result = await client.report({
        errorType: 'TestError',
        errorMessage: 'test',
      });

      expect(result.success).toBe(false);
    });
  });
});

// ============================================================
// AutoReportManager
// ============================================================
describe('AutoReportManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('device-test-id');
    mockHomedir.mockReturnValue('/Users/testuser');
    mockFetch.mockResolvedValue(okResponse({ success: true }));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function advanceRetryDelay() {
    await vi.advanceTimersByTimeAsync(2000);
  }

  describe('isEnabled()', () => {
    it('returns true by default', () => {
      const mgr = new AutoReportManager(makeConfig(), '0.7.14');
      expect(mgr.isEnabled()).toBe(true);
    });

    it('returns true when explicitly enabled', () => {
      const mgr = new AutoReportManager(
        makeConfig({ autoReport: { enabled: true } }),
        '0.7.14',
      );
      expect(mgr.isEnabled()).toBe(true);
    });

    it('returns false when disabled', () => {
      const mgr = new AutoReportManager(
        makeConfig({ autoReport: { enabled: false } }),
        '0.7.14',
      );
      expect(mgr.isEnabled()).toBe(false);
    });
  });

  describe('computeHash()', () => {
    it('generates consistent hash for same error', () => {
      const mgr = new AutoReportManager(makeConfig(), '0.7.14');
      const err = new Error('Rate limited');
      err.name = 'LLMError';

      expect(mgr.computeHash(err)).toBe(mgr.computeHash(err));
      expect(mgr.computeHash(err)).toHaveLength(16);
    });

    it('generates different hashes for different messages', () => {
      const mgr = new AutoReportManager(makeConfig(), '0.7.14');
      const err1 = new Error('Rate limit');
      const err2 = new Error('Auth failed');

      expect(mgr.computeHash(err1)).not.toBe(mgr.computeHash(err2));
    });

    it('generates different hashes for different names', () => {
      const mgr = new AutoReportManager(makeConfig(), '0.7.14');
      const err1 = new Error('Same msg');
      err1.name = 'TypeError';
      const err2 = new Error('Same msg');
      err2.name = 'RangeError';

      expect(mgr.computeHash(err1)).not.toBe(mgr.computeHash(err2));
    });

    it('truncates message to 200 chars for hashing', () => {
      const mgr = new AutoReportManager(makeConfig(), '0.7.14');
      const longMsg = 'x'.repeat(500);
      const err1 = new Error(longMsg);
      const err2 = new Error(longMsg.slice(0, 200) + 'y'.repeat(300));

      expect(mgr.computeHash(err1)).toBe(mgr.computeHash(err2));
    });
  });

  describe('reportError()', () => {
    it('reports error and sends to API', async () => {
      mockFetch.mockResolvedValue(okResponse({ success: true, issueNumber: 99 }));
      const mgr = new AutoReportManager(makeConfig(), '0.7.14');

      await mgr.reportError(new Error('Test error'));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.errorType).toBe('Error');
      expect(body.errorMessage).toBe('Test error');
    });

    it('deduplicates same error within session', async () => {
      mockFetch.mockResolvedValue(okResponse({ success: true }));
      const mgr = new AutoReportManager(makeConfig(), '0.7.14');
      const error = new Error('Duplicate me');

      await mgr.reportError(error);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await mgr.reportError(error);
      expect(mockFetch).toHaveBeenCalledTimes(1); // no second call
    });

    it('retries once on failure', async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse(500, 'Server error'))
        .mockResolvedValueOnce(okResponse({ success: true }));

      const mgr = new AutoReportManager(makeConfig(), '0.7.14');
      const p = mgr.reportError(new Error('Retry me'));
      await advanceRetryDelay();
      await p;

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('gives up after retry failure', async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse(500, 'Fail 1'))
        .mockResolvedValueOnce(errorResponse(503, 'Fail 2'));

      const mgr = new AutoReportManager(makeConfig(), '0.7.14');
      const p = mgr.reportError(new Error('Double fail'));
      await advanceRetryDelay();
      await p;

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does nothing when disabled', async () => {
      const mgr = new AutoReportManager(
        makeConfig({ autoReport: { enabled: false } }),
        '0.7.14',
      );
      await mgr.reportError(new Error('Should not report'));
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('never throws on unexpected errors', async () => {
      mockFetch.mockImplementation(() => { throw new Error('Catastrophic'); });
      const mgr = new AutoReportManager(makeConfig(), '0.7.14');

      const p = mgr.reportError(new Error('Chaos'));
      // Advance past the 2s retry delay (first report() fails, then retry waits 2s)
      await vi.advanceTimersByTimeAsync(2000);
      await expect(p).resolves.toBeUndefined();
    });

    it('allows different errors after dedup', async () => {
      mockFetch.mockImplementation(() => Promise.resolve(okResponse({ success: true })));
      const mgr = new AutoReportManager(makeConfig(), '0.7.14');

      await mgr.reportError(new Error('First'));
      await mgr.reportError(new Error('Second'));

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('sanitizes error message paths', async () => {
      mockFetch.mockResolvedValue(okResponse({ success: true }));
      mockHomedir.mockReturnValue('/Users/testuser');

      const mgr = new AutoReportManager(makeConfig(), '0.7.14');
      const error = new Error('Cannot read /Users/testuser/secret/config.json');

      await mgr.reportError(error);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.errorMessage).not.toContain('/Users/testuser');
      expect(body.errorMessage).toContain('~');
    });

    it('sanitizes stack trace paths', async () => {
      mockFetch.mockResolvedValue(okResponse({ success: true }));
      mockHomedir.mockReturnValue('/Users/testuser');

      const mgr = new AutoReportManager(makeConfig(), '0.7.14');
      const error = new Error('Stack test');
      error.stack = 'Error\n  at /Users/testuser/proj/a.ts:1:1';

      await mgr.reportError(error);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.sanitizedStack).not.toContain('/Users/testuser');
    });

    it('truncates error message to 500 chars', async () => {
      mockFetch.mockResolvedValue(okResponse({ success: true }));
      const mgr = new AutoReportManager(makeConfig(), '0.7.14');

      await mgr.reportError(new Error('A'.repeat(1000)));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.errorMessage.length).toBeLessThanOrEqual(500);
    });
  });

  describe('reportError() context fields', () => {
    it('passes errorType from context', async () => {
      mockFetch.mockResolvedValue(okResponse({ success: true }));
      const mgr = new AutoReportManager(makeConfig(), '0.7.14');

      await mgr.reportError(new Error('fail'), { errorType: 'LLMError' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.errorType).toBe('LLMError');
    });

    it('uses error.name when no context.errorType', async () => {
      mockFetch.mockResolvedValue(okResponse({ success: true }));
      const mgr = new AutoReportManager(makeConfig(), '0.7.14');

      await mgr.reportError(new TypeError('bad input'));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.errorType).toBe('TypeError');
    });

    it('passes model and provider', async () => {
      mockFetch.mockResolvedValue(okResponse({ success: true }));
      const mgr = new AutoReportManager(makeConfig(), '0.7.14');

      await mgr.reportError(new Error('stream fail'), {
        model: 'anthropic/claude-3.5-sonnet',
        provider: 'openrouter',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('anthropic/claude-3.5-sonnet');
      expect(body.provider).toBe('openrouter');
    });

    it('passes sessionId, conversationLength, contextUsagePercent', async () => {
      mockFetch.mockResolvedValue(okResponse({ success: true }));
      const mgr = new AutoReportManager(makeConfig(), '0.7.14');

      await mgr.reportError(new Error('ctx'), {
        sessionId: 'sess-123',
        conversationLength: 42,
        contextUsagePercent: 95.5,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.sessionId).toBe('sess-123');
      expect(body.conversationLength).toBe(42);
      expect(body.contextUsagePercent).toBe(95.5);
    });

    it('passes lastToolCalls and retry info', async () => {
      mockFetch.mockResolvedValue(okResponse({ success: true }));
      const mgr = new AutoReportManager(makeConfig(), '0.7.14');

      await mgr.reportError(new Error('retry fail'), {
        lastToolCalls: ['read_file', 'apply_patch'],
        retryAttempt: 3,
        maxRetries: 3,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.lastToolCalls).toEqual(['read_file', 'apply_patch']);
      expect(body.retryAttempt).toBe(3);
      expect(body.maxRetries).toBe(3);
    });

    it('uses custom API base URL from config', async () => {
      mockFetch.mockResolvedValue(okResponse({ success: true }));
      const mgr = new AutoReportManager(
        makeConfig({ api: { baseUrl: 'https://custom.api.com' } }),
        '0.7.14',
      );

      await mgr.reportError(new Error('url test'));

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://custom.api.com/v1/reports');
    });
  });
});
