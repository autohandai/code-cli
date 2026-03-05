/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AzureTokenManager } from '../../src/providers/azure/tokenManager';

describe('AzureTokenManager', () => {
  let manager: AzureTokenManager;

  beforeEach(() => {
    manager = new AzureTokenManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('getToken with api-key', () => {
    it('should return the API key directly for api-key auth method', async () => {
      const token = await manager.getToken({
        authMethod: 'api-key',
        apiKey: 'test-api-key-123'
      });
      expect(token).toBe('test-api-key-123');
    });

    it('should throw if api-key auth method has no apiKey', async () => {
      await expect(
        manager.getToken({ authMethod: 'api-key' })
      ).rejects.toThrow('API key is required');
    });
  });

  describe('getToken with entra-id', () => {
    it('should throw if tenantId is missing', async () => {
      await expect(
        manager.getToken({
          authMethod: 'entra-id',
          clientId: 'cid',
          clientSecret: 'secret'
        })
      ).rejects.toThrow('tenantId');
    });

    it('should throw if clientId is missing', async () => {
      await expect(
        manager.getToken({
          authMethod: 'entra-id',
          tenantId: 'tid',
          clientSecret: 'secret'
        })
      ).rejects.toThrow('clientId');
    });

    it('should throw if clientSecret is missing', async () => {
      await expect(
        manager.getToken({
          authMethod: 'entra-id',
          tenantId: 'tid',
          clientId: 'cid'
        })
      ).rejects.toThrow('clientSecret');
    });

    it('should acquire token via OAuth2 client_credentials flow', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          access_token: 'entra-token-abc',
          expires_in: 3600
        })
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as Response);

      const token = await manager.getToken({
        authMethod: 'entra-id',
        tenantId: 'my-tenant',
        clientId: 'my-client',
        clientSecret: 'my-secret'
      });

      expect(token).toBe('entra-token-abc');
      expect(fetch).toHaveBeenCalledWith(
        'https://login.microsoftonline.com/my-tenant/oauth2/v2.0/token',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        })
      );
    });

    it('should cache token and reuse within expiry', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          access_token: 'cached-token',
          expires_in: 3600
        })
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

      const params = {
        authMethod: 'entra-id' as const,
        tenantId: 'tid',
        clientId: 'cid',
        clientSecret: 'secret'
      };

      const token1 = await manager.getToken(params);
      const token2 = await manager.getToken(params);

      expect(token1).toBe('cached-token');
      expect(token2).toBe('cached-token');
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should refresh token after expiry (with 5-min buffer)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token-1', expires_in: 600 })
      } as Response);
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token-2', expires_in: 3600 })
      } as Response);

      const params = {
        authMethod: 'entra-id' as const,
        tenantId: 'tid',
        clientId: 'cid',
        clientSecret: 'secret'
      };

      const token1 = await manager.getToken(params);
      expect(token1).toBe('token-1');

      vi.advanceTimersByTime(6 * 60 * 1000);

      const token2 = await manager.getToken(params);
      expect(token2).toBe('token-2');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should throw on OAuth2 error response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          error: 'invalid_client',
          error_description: 'Bad credentials'
        })
      } as Response);

      await expect(
        manager.getToken({
          authMethod: 'entra-id',
          tenantId: 'tid',
          clientId: 'cid',
          clientSecret: 'bad'
        })
      ).rejects.toThrow('Bad credentials');
    });
  });

  describe('getToken with managed-identity', () => {
    it('should call Azure IMDS endpoint', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'mi-token',
          expires_in: 86400
        })
      } as Response);

      const token = await manager.getToken({ authMethod: 'managed-identity' });

      expect(token).toBe('mi-token');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('169.254.169.254'),
        expect.objectContaining({
          headers: expect.objectContaining({ Metadata: 'true' })
        })
      );
    });

    it('should throw descriptive error when IMDS is unreachable', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('fetch failed'));

      await expect(
        manager.getToken({ authMethod: 'managed-identity' })
      ).rejects.toThrow('Managed Identity');
    });
  });

  describe('getAuthHeaders', () => {
    it('should return api-key header for api-key auth', async () => {
      const headers = await manager.getAuthHeaders({
        authMethod: 'api-key',
        apiKey: 'my-key'
      });
      expect(headers).toEqual({ 'api-key': 'my-key' });
    });

    it('should return Bearer header for entra-id auth', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'bearer-token', expires_in: 3600 })
      } as Response);

      const headers = await manager.getAuthHeaders({
        authMethod: 'entra-id',
        tenantId: 'tid',
        clientId: 'cid',
        clientSecret: 'secret'
      });
      expect(headers).toEqual({ Authorization: 'Bearer bearer-token' });
    });

    it('should return Bearer header for managed-identity auth', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'mi-bearer', expires_in: 3600 })
      } as Response);

      const headers = await manager.getAuthHeaders({ authMethod: 'managed-identity' });
      expect(headers).toEqual({ Authorization: 'Bearer mi-bearer' });
    });
  });
});
