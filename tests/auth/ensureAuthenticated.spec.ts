/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import stringWidth from 'string-width';

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

vi.mock('../../src/commands/login.js', () => ({
  login: vi.fn(),
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
import { login } from '../../src/commands/login.js';
import { checkForUpdates } from '../../src/utils/versionCheck.js';
import type { LoadedConfig } from '../../src/types.js';

const mockValidateSession = vi.fn();
const mockLoadConfig = loadConfig as unknown as ReturnType<typeof vi.fn>;
const mockAuthClient = AuthClient as unknown as ReturnType<typeof vi.fn>;
const mockLogin = login as unknown as ReturnType<typeof vi.fn>;
const mockShowModal = showModal as unknown as ReturnType<typeof vi.fn>;
const mockCheckForUpdates = checkForUpdates as unknown as ReturnType<typeof vi.fn>;

describe('ensureAuthenticated', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const originalIsTTY = process.stdout.isTTY;
  const originalColumns = process.stdout.columns;
  const originalApiKey = process.env.AUTOHAND_API_KEY;
  const originalStartupAuthMenu = process.env.AUTOHAND_STARTUP_AUTH_MENU;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthClient.mockImplementation(function AuthClientMock() {
      return {
        validateSession: mockValidateSession,
      };
    });
    mockShowModal.mockResolvedValue({ value: 'login' });
    mockCheckForUpdates.mockResolvedValue({
      currentVersion: '0.0.0',
      latestVersion: null,
      isUpToDate: true,
      updateAvailable: false,
      channel: 'stable',
    });
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('PROCESS_EXIT');
    });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.AUTOHAND_API_KEY;
    } else {
      process.env.AUTOHAND_API_KEY = originalApiKey;
    }
    if (originalStartupAuthMenu === undefined) {
      delete process.env.AUTOHAND_STARTUP_AUTH_MENU;
    } else {
      process.env.AUTOHAND_STARTUP_AUTH_MENU = originalStartupAuthMenu;
    }
    exitSpy.mockRestore();
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true });
    Object.defineProperty(process.stdout, 'columns', { value: originalColumns, writable: true, configurable: true });
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

  it('bare mode authenticates from AUTOHAND_API_KEY without OAuth login', async () => {
    process.env.AUTOHAND_API_KEY = 'bare-env-token';
    const mockConfig: LoadedConfig = {
      configPath: '/tmp/config.json',
    };

    const result = await ensureAuthenticated(mockConfig, { bare: true });

    expect(result.auth?.token).toBe('bare-env-token');
    expect(showModal).not.toHaveBeenCalled();
    expect(AuthClient).not.toHaveBeenCalled();
  });

  it('bare mode fails closed instead of launching OAuth when no API key source exists', async () => {
    delete process.env.AUTOHAND_API_KEY;
    const mockConfig: LoadedConfig = {
      configPath: '/tmp/config.json',
    };

    await expect(ensureAuthenticated(mockConfig, { bare: true })).rejects.toThrow('PROCESS_EXIT');

    expect(showModal).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
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

  it('forces device login when token is locally expired', async () => {
    const mockConfig: LoadedConfig = {
      configPath: '/tmp/config.json',
      auth: {
        token: 'expired-token',
        user: { id: 'u1', email: 'test@example.com', name: 'Test' },
        expiresAt: new Date(Date.now() - 86400000).toISOString(),
      },
    };

    const refreshedConfig: LoadedConfig = {
      ...mockConfig,
      auth: {
        token: 'new-token',
        user: { id: 'u1', email: 'test@example.com', name: 'Test' },
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    };
    mockLogin.mockResolvedValue(null);
    mockLoadConfig.mockResolvedValue(refreshedConfig);

    const result = await ensureAuthenticated(mockConfig);

    expect(showModal).toHaveBeenCalledWith(expect.objectContaining({
      options: [
        { label: 'Login', value: 'login' },
        { label: 'Exit', value: 'exit' },
      ],
    }));
    expect(mockLogin).toHaveBeenCalledWith({
      config: mockConfig,
      restoreSync: false,
    });
    expect(result.auth?.token).toBe('new-token');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('starts device login when no token exists', async () => {
    const mockConfig: LoadedConfig = {
      configPath: '/tmp/config.json',
    };

    const refreshedConfig: LoadedConfig = {
      ...mockConfig,
      auth: {
        token: 'new-token',
        user: { id: 'u1', email: 'test@example.com', name: 'Test' },
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    };
    mockLogin.mockResolvedValue(null);
    mockLoadConfig.mockResolvedValue(refreshedConfig);

    const result = await ensureAuthenticated(mockConfig);

    expect(showModal).toHaveBeenCalledWith(expect.objectContaining({
      options: [
        { label: 'Login', value: 'login' },
        { label: 'Exit', value: 'exit' },
      ],
    }));
    expect(mockLogin).toHaveBeenCalledWith({
      config: mockConfig,
      restoreSync: false,
    });
    expect(result.auth?.token).toBe('new-token');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('passes terminal-width-aware logo art to the login modal', async () => {
    const mockConfig: LoadedConfig = {
      configPath: '/tmp/config.json',
    };

    Object.defineProperty(process.stdout, 'columns', { value: 40, writable: true, configurable: true });
    mockLoadConfig.mockResolvedValue({ ...mockConfig });
    mockShowModal.mockResolvedValue({ value: 'exit' });

    await expect(ensureAuthenticated(mockConfig)).rejects.toThrow('PROCESS_EXIT');

    const [{ logo }] = mockShowModal.mock.calls[0];
    const logoLines = String(logo).split('\n').filter((line) => line.trim().length > 0);
    expect(logoLines.some((line) => line.includes('()'))).toBe(true);
    expect(logoLines.every((line) => stringWidth(line) <= 40)).toBe(true);
  });

  it('shows upgrade only when the latest release is newer', async () => {
    const mockConfig: LoadedConfig = {
      configPath: '/tmp/config.json',
    };

    mockCheckForUpdates.mockResolvedValue({
      currentVersion: '0.8.2',
      latestVersion: '0.9.0',
      isUpToDate: false,
      updateAvailable: true,
      channel: 'stable',
    });
    mockShowModal.mockResolvedValue({ value: 'exit' });

    await expect(ensureAuthenticated(mockConfig)).rejects.toThrow('PROCESS_EXIT');

    expect(mockShowModal).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('New version available'),
      options: [
        { label: 'Login', value: 'login' },
        { label: 'Upgrade (v0.9.0 available)', value: 'upgrade' },
        { label: 'Exit', value: 'exit' },
      ],
    }));
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
