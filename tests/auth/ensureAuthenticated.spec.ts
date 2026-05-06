/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/ui/ink/components/Modal.js', () => ({
  showModal: vi.fn(),
}));

vi.mock('../../src/auth/AuthClient.js', () => ({
  AuthClient: vi.fn(),
}));

vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

vi.mock('../../src/auth/index.js', () => ({
  getAuthClient: vi.fn(),
}));

vi.mock('../../src/utils/versionCheck.js', () => ({
  checkForUpdates: vi.fn().mockResolvedValue({
    currentVersion: '0.0.0',
    latestVersion: null,
    isUpToDate: true,
    updateAvailable: false,
    channel: 'stable',
  }),
}));

import { showModal } from '../../src/ui/ink/components/Modal.js';
import { AuthClient } from '../../src/auth/AuthClient.js';
import { ensureAuthenticated } from '../../src/auth/ensureAuth.js';
import { loadConfig } from '../../src/config.js';
import type { LoadedConfig } from '../../src/types.js';

const mockValidateSession = vi.fn();
const mockLoadConfig = loadConfig as unknown as ReturnType<typeof vi.fn>;
const mockAuthClient = AuthClient as unknown as ReturnType<typeof vi.fn>;

describe('ensureAuthenticated', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const originalIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthClient.mockImplementation(function AuthClientMock() {
      return {
        validateSession: mockValidateSession,
      };
    });
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('PROCESS_EXIT');
    });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true });
  });

  it('returns config immediately for a locally valid token without blocking on server validation', async () => {
    const mockConfig: LoadedConfig = {
      configPath: '/tmp/config.json',
      auth: {
        token: 'valid-token',
        user: { id: 'u1', email: 'test@example.com', name: 'Test' },
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    };

    const result = await ensureAuthenticated(mockConfig);

    expect(result.auth?.token).toBe('valid-token');
    expect(AuthClient).not.toHaveBeenCalled();
    expect(mockValidateSession).not.toHaveBeenCalled();
    expect(showModal).not.toHaveBeenCalled();
  });

  it('trusts local token when server returns 401 but token is not expired locally', async () => {
    const mockConfig: LoadedConfig = {
      configPath: '/tmp/config.json',
      auth: {
        token: 'valid-token',
        user: { id: 'u1', email: 'test@example.com', name: 'Test' },
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    };

    mockValidateSession.mockResolvedValue({ authenticated: false });

    const result = await ensureAuthenticated(mockConfig);

    expect(result.auth?.token).toBe('valid-token');
    expect(AuthClient).not.toHaveBeenCalled();
    expect(mockValidateSession).not.toHaveBeenCalled();
    expect(showModal).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('forces login when token is locally expired', async () => {
    const mockConfig: LoadedConfig = {
      configPath: '/tmp/config.json',
      auth: {
        token: 'expired-token',
        user: { id: 'u1', email: 'test@example.com', name: 'Test' },
        expiresAt: new Date(Date.now() - 86400000).toISOString(),
      },
    };

    (showModal as ReturnType<typeof vi.fn>).mockResolvedValue({ value: 'exit' });

    await expect(ensureAuthenticated(mockConfig)).rejects.toThrow('PROCESS_EXIT');

    expect(showModal).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('forces login when no token exists', async () => {
    const mockConfig: LoadedConfig = {
      configPath: '/tmp/config.json',
    };

    mockLoadConfig.mockResolvedValue({ ...mockConfig });
    (showModal as ReturnType<typeof vi.fn>).mockResolvedValue({ value: 'exit' });

    await expect(ensureAuthenticated(mockConfig)).rejects.toThrow('PROCESS_EXIT');

    expect(showModal).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('trusts local token on network error during validation', async () => {
    const mockConfig: LoadedConfig = {
      configPath: '/tmp/config.json',
      auth: {
        token: 'valid-token',
        user: { id: 'u1', email: 'test@example.com', name: 'Test' },
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    };

    mockValidateSession.mockRejectedValue(new Error('Network error'));

    const result = await ensureAuthenticated(mockConfig);

    expect(result.auth?.token).toBe('valid-token');
    expect(AuthClient).not.toHaveBeenCalled();
    expect(mockValidateSession).not.toHaveBeenCalled();
    expect(showModal).not.toHaveBeenCalled();
  });

  it('keeps cached user info on the startup fast path', async () => {
    const mockConfig: LoadedConfig = {
      configPath: '/tmp/config.json',
      auth: {
        token: 'valid-token',
        user: { id: 'u1', email: 'old@example.com', name: 'Old Name' },
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    };

    const result = await ensureAuthenticated(mockConfig);

    expect(result.auth?.user?.email).toBe('old@example.com');
    expect(result.auth?.user?.name).toBe('Old Name');
    expect(AuthClient).not.toHaveBeenCalled();
    expect(mockValidateSession).not.toHaveBeenCalled();
  });

  it('does not construct an auth client on the locally valid startup path', async () => {
    const { AuthClient } = await import('../../src/auth/AuthClient.js');

    const mockConfig: LoadedConfig = {
      configPath: '/tmp/config.json',
      auth: {
        token: 'valid-token',
        user: { id: 'u1', email: 'test@example.com', name: 'Test' },
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    };

    await ensureAuthenticated(mockConfig);

    expect(AuthClient).not.toHaveBeenCalled();
  });
});
