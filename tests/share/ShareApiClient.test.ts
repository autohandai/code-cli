/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShareApiClient } from '../../src/share/ShareApiClient';
import type { ShareSessionPayload } from '../../src/share/types';

// Mock fs-extra
vi.mock('fs-extra', () => ({
  default: {
    pathExists: vi.fn().mockResolvedValue(false),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    ensureDir: vi.fn(),
    readJson: vi.fn(),
    writeJson: vi.fn(),
    remove: vi.fn(),
  },
}));

describe('ShareApiClient', () => {
  let client: ShareApiClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new ShareApiClient({
      baseUrl: 'https://test.autohand.link/api',
      timeout: 5000,
      cliVersion: '0.1.0',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  const createMockPayload = (): ShareSessionPayload => ({
    metadata: {
      sessionId: 'test-session-123',
      projectName: 'my-project',
      model: 'anthropic/claude-3.5-sonnet',
      provider: 'openrouter',
      startedAt: '2025-01-10T10:00:00.000Z',
      endedAt: '2025-01-10T10:30:00.000Z',
      durationSeconds: 1800,
      messageCount: 10,
      status: 'completed',
    },
    usage: {
      totalTokens: 50000,
      inputTokens: 15000,
      outputTokens: 35000,
      estimatedCost: 0.15,
    },
    toolUsage: [{ name: 'read_file', count: 5 }],
    messages: [{ role: 'user', content: 'Test', timestamp: '2025-01-10T10:00:00.000Z' }],
    visibility: 'public',
    client: {
      cliVersion: '0.1.0',
      platform: 'darwin',
      deviceId: 'test-device-123',
    },
  });

  describe('createShare', () => {
    it('should successfully create a public share', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          shareId: 'asid-abc12345',
          url: 'https://autohand.link/s/asid-abc12345',
        }),
      });

      const payload = createMockPayload();
      const result = await client.createShare(payload);

      expect(result.success).toBe(true);
      expect(result.shareId).toBe('asid-abc12345');
      expect(result.url).toBe('https://autohand.link/s/asid-abc12345');
      expect(result.passcode).toBeUndefined();

      expect(fetch).toHaveBeenCalledWith(
        'https://test.autohand.link/api/share',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-CLI-Version': '0.1.0',
          }),
        })
      );
    });

    it('should successfully create a private share with passcode', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          shareId: 'asid-xyz98765',
          url: 'https://autohand.link/s/asid-xyz98765',
          passcode: '1234-5678',
        }),
      });

      const payload = createMockPayload();
      payload.visibility = 'private';
      const result = await client.createShare(payload);

      expect(result.success).toBe(true);
      expect(result.passcode).toBe('1234-5678');
    });

    it('should handle API errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Bad Request: Invalid payload',
      });

      const payload = createMockPayload();
      const result = await client.createShare(payload);

      expect(result.success).toBe(false);
      expect(result.error).toContain('API error: 400');
    });

    it('should handle network errors', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const payload = createMockPayload();
      const result = await client.createShare(payload);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Queued for retry');
    });

    it('should handle timeout', async () => {
      global.fetch = vi.fn().mockImplementation(
        () =>
          new Promise((_, reject) => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            setTimeout(() => reject(error), 100);
          })
      );

      const shortTimeoutClient = new ShareApiClient({
        baseUrl: 'https://test.autohand.link/api',
        timeout: 50,
        cliVersion: '0.1.0',
      });

      const payload = createMockPayload();
      const result = await shortTimeoutClient.createShare(payload);

      expect(result.success).toBe(false);
    });
  });

  describe('deleteShare', () => {
    it('should successfully delete a share', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      const result = await client.deleteShare('asid-abc12345');

      expect(result.success).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'https://test.autohand.link/api/share/asid-abc12345',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('should handle not found error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Share not found',
      });

      const result = await client.deleteShare('asid-invalid');

      expect(result.success).toBe(false);
      expect(result.error).toContain('404');
    });

    it('should handle unauthorized error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Not authorized',
      });

      const result = await client.deleteShare('asid-notowned');

      expect(result.success).toBe(false);
      expect(result.error).toContain('403');
    });
  });

  describe('healthCheck', () => {
    it('should return true when API is reachable', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
      });

      const result = await client.healthCheck();

      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'https://test.autohand.link/api/health',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should return false when API is unreachable', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });

    it('should return false when API returns error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe('getDeviceId', () => {
    it('should generate a new device ID', async () => {
      const deviceId = await client.getDeviceId();

      expect(deviceId).toMatch(/^anon_[a-z0-9]+_[a-z0-9]+$/);
    });

    it('should return the same device ID on subsequent calls', async () => {
      const deviceId1 = await client.getDeviceId();
      const deviceId2 = await client.getDeviceId();

      expect(deviceId1).toBe(deviceId2);
    });
  });
});
