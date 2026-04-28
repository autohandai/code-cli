/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockValidateSession = vi.fn();
const mockLoadConfig = vi.fn();

vi.mock('../../src/ui/ink/components/Modal.js', () => ({
  showModal: vi.fn(),
}));

vi.mock('../../src/auth/AuthClient.js', () => ({
  AuthClient: vi.fn().mockImplementation(() => ({
    validateSession: mockValidateSession,
  })),
}));

vi.mock('../../src/config.js', () => ({
  loadConfig: mockLoadConfig,
  saveConfig: vi.fn(),
}));

vi.mock('../../src/auth/index.js', () => ({
  getAuthClient: vi.fn().mockImplementation(() => ({
    validateSession: mockValidateSession,
    initiateDeviceAuth: vi.fn().mockResolvedValue({ success: false, error: 'mock' }),
    pollDeviceAuth: vi.fn(),
  })),
}));

import { showModal } from '../../src/ui/ink/components/Modal.js';
import { ensureAuthenticated } from '../../src/auth/ensureAuth.js';
import type { LoadedConfig } from '../../src/types.js';

describe('ensureAuthenticated', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const originalIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('PROCESS_EXIT');
    });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true });
  });

  it('returns config immediately when server validates token', async () => {
    const mockConfig: LoadedConfig = {
      configPath: '/tmp/config.json',
      auth: {
        token: 'valid-token',
        user: { id: 'u1', email: 'test@example.com', name: 'Test' },
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    };

    mockValidateSession.mockResolvedValue({
      authenticated: true,
      user: { id: 'u1', email: 'test@example.com', name: 'Test' },
    });

    const result = await ensureAuthenticated(mockConfig);

    expect(result.auth?.token).toBe('valid-token');
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
    expect(showModal).not.toHaveBeenCalled();
  });

  it('updates user info when server returns fresh user data', async () => {
    const mockConfig: LoadedConfig = {
      configPath: '/tmp/config.json',
      auth: {
        token: 'valid-token',
        user: { id: 'u1', email: 'old@example.com', name: 'Old Name' },
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    };

    mockValidateSession.mockResolvedValue({
      authenticated: true,
      user: { id: 'u1', email: 'new@example.com', name: 'New Name' },
    });

    const result = await ensureAuthenticated(mockConfig);

    expect(result.auth?.user?.email).toBe('new@example.com');
    expect(result.auth?.user?.name).toBe('New Name');
  });

  it('uses a 5-second timeout for validation requests', async () => {
    const { AuthClient } = await import('../../src/auth/AuthClient.js');

    const mockConfig: LoadedConfig = {
      configPath: '/tmp/config.json',
      auth: {
        token: 'valid-token',
        user: { id: 'u1', email: 'test@example.com', name: 'Test' },
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    };

    mockValidateSession.mockResolvedValue({ authenticated: true });

    await ensureAuthenticated(mockConfig);

    expect(AuthClient).toHaveBeenCalledWith(expect.objectContaining({ timeout: 5000 }));
  });
});
