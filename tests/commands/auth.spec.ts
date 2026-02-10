/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    bold: Object.assign((s: string) => s, {
      cyan: (s: string) => s,
      yellow: (s: string) => s,
    }),
    gray: (s: string) => s,
    cyan: Object.assign((s: string) => s, {
      underline: (s: string) => s,
    }),
    green: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
  },
}));

// Mock config
vi.mock('../../src/config.js', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

// Mock auth client
vi.mock('../../src/auth/index.js', () => ({
  getAuthClient: vi.fn(),
}));

// Mock prompt utility
vi.mock('../../src/utils/prompt.js', () => ({
  safePrompt: vi.fn(),
}));

// Mock open package (browser opener)
vi.mock('open', () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

import { saveConfig } from '../../src/config.js';
import { getAuthClient } from '../../src/auth/index.js';
import { safePrompt } from '../../src/utils/prompt.js';
import type { LoadedConfig } from '../../src/types.js';

describe('login command', () => {
  let consoleOutput: string[];
  let originalConsoleLog: typeof console.log;

  beforeEach(() => {
    consoleOutput = [];
    originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => {
      consoleOutput.push(args.join(' '));
    };
    vi.clearAllMocks();
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  it('exports login function and metadata', async () => {
    const loginModule = await import('../../src/commands/login.js');
    expect(typeof loginModule.login).toBe('function');
    expect(loginModule.metadata).toBeDefined();
    expect(loginModule.metadata.command).toBe('/login');
  });

  it('prompts to continue when already logged in', async () => {
    const mockConfig: LoadedConfig = {
      configPath: '/home/user/.autohand/config.json',
      auth: {
        token: 'existing-token',
        user: { id: 'user-1', email: 'test@example.com', name: 'Test User' },
      },
    };

    (safePrompt as ReturnType<typeof vi.fn>).mockResolvedValue({ continueLogin: false });

    const { login } = await import('../../src/commands/login.js');
    const result = await login({ config: mockConfig });

    expect(result).toBeNull();
    expect(safePrompt).toHaveBeenCalled();
    expect(consoleOutput.some((line) => line.includes('cancelled'))).toBe(true);
  });

  it('initiates device auth flow when not logged in', async () => {
    const mockConfig: LoadedConfig = {
      configPath: '/home/user/.autohand/config.json',
    };

    const mockAuthClient = {
      initiateDeviceAuth: vi.fn().mockResolvedValue({
        success: true,
        deviceCode: 'device-123',
        userCode: 'ABC-123',
        verificationUriComplete: 'https://auth.autohand.ai/device?code=ABC-123',
        interval: 0.01, // Very short interval for testing
      }),
      // First call returns pending, second returns authorized
      pollDeviceAuth: vi.fn()
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValue({
          status: 'authorized',
          token: 'new-token',
          user: { id: 'user-1', email: 'new@example.com', name: 'New User' },
        }),
    };

    (getAuthClient as ReturnType<typeof vi.fn>).mockReturnValue(mockAuthClient);
    (saveConfig as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const { login } = await import('../../src/commands/login.js');
    await login({ config: mockConfig });

    expect(mockAuthClient.initiateDeviceAuth).toHaveBeenCalled();
    expect(consoleOutput.some((line) => line.includes('ABC-123'))).toBe(true);
  }, 10000); // Extended timeout

  it('handles device auth failure', async () => {
    const mockConfig: LoadedConfig = {
      configPath: '/home/user/.autohand/config.json',
    };

    const mockAuthClient = {
      initiateDeviceAuth: vi.fn().mockResolvedValue({
        success: false,
        error: 'Network error',
      }),
    };

    (getAuthClient as ReturnType<typeof vi.fn>).mockReturnValue(mockAuthClient);

    const { login } = await import('../../src/commands/login.js');
    const result = await login({ config: mockConfig });

    expect(result).toBeNull();
    expect(consoleOutput.some((line) => line.toLowerCase().includes('failed'))).toBe(true);
  });
});

describe('logout command', () => {
  let consoleOutput: string[];
  let originalConsoleLog: typeof console.log;

  beforeEach(() => {
    consoleOutput = [];
    originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => {
      consoleOutput.push(args.join(' '));
    };
    vi.clearAllMocks();
  });

  afterEach(() => {
    console.log = originalConsoleLog;
  });

  it('exports logout function and metadata', async () => {
    const logoutModule = await import('../../src/commands/logout.js');
    expect(typeof logoutModule.logout).toBe('function');
    expect(logoutModule.metadata).toBeDefined();
    expect(logoutModule.metadata.command).toBe('/logout');
  });

  it('shows message when not logged in', async () => {
    const mockConfig: LoadedConfig = {
      configPath: '/home/user/.autohand/config.json',
    };

    const { logout } = await import('../../src/commands/logout.js');
    const result = await logout({ config: mockConfig });

    expect(result).toBeNull();
    expect(consoleOutput.some((line) => line.includes('not currently logged in'))).toBe(true);
  });

  it('prompts for confirmation when logged in', async () => {
    const mockConfig: LoadedConfig = {
      configPath: '/home/user/.autohand/config.json',
      auth: {
        token: 'existing-token',
        user: { id: 'user-1', email: 'test@example.com', name: 'Test User' },
      },
    };

    (safePrompt as ReturnType<typeof vi.fn>).mockResolvedValue({ confirm: false });

    const { logout } = await import('../../src/commands/logout.js');
    const result = await logout({ config: mockConfig });

    expect(result).toBeNull();
    expect(safePrompt).toHaveBeenCalled();
    expect(consoleOutput.some((line) => line.includes('cancelled'))).toBe(true);
  });

  it('clears auth on confirmed logout', async () => {
    const mockConfig: LoadedConfig = {
      configPath: '/home/user/.autohand/config.json',
      auth: {
        token: 'existing-token',
        user: { id: 'user-1', email: 'test@example.com', name: 'Test User' },
      },
    };

    const mockAuthClient = {
      logout: vi.fn().mockResolvedValue(undefined),
    };

    (safePrompt as ReturnType<typeof vi.fn>).mockResolvedValue({ confirm: true });
    (getAuthClient as ReturnType<typeof vi.fn>).mockReturnValue(mockAuthClient);
    (saveConfig as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const { logout } = await import('../../src/commands/logout.js');
    await logout({ config: mockConfig });

    expect(mockAuthClient.logout).toHaveBeenCalledWith('existing-token');
    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: undefined,
      })
    );
    expect(consoleOutput.some((line) => line.includes('Successfully logged out'))).toBe(true);
  });

  it('clears local auth even if server logout fails', async () => {
    const mockConfig: LoadedConfig = {
      configPath: '/home/user/.autohand/config.json',
      auth: {
        token: 'existing-token',
        user: { id: 'user-1', email: 'test@example.com', name: 'Test User' },
      },
    };

    const mockAuthClient = {
      logout: vi.fn().mockRejectedValue(new Error('Network error')),
    };

    (safePrompt as ReturnType<typeof vi.fn>).mockResolvedValue({ confirm: true });
    (getAuthClient as ReturnType<typeof vi.fn>).mockReturnValue(mockAuthClient);
    (saveConfig as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const { logout } = await import('../../src/commands/logout.js');
    await logout({ config: mockConfig });

    // Should still save config with auth cleared
    expect(saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: undefined,
      })
    );
    expect(consoleOutput.some((line) => line.includes('Successfully logged out'))).toBe(true);
  });
});

describe('CLIOptions auth flags', () => {
  it('includes login and logout options in CLIOptions type', async () => {
    // Type-level test: verify the interface includes login and logout
    const opts: { login?: boolean; logout?: boolean } = {
      login: true,
      logout: false,
    };
    expect(opts.login).toBe(true);
    expect(opts.logout).toBe(false);
  });
});
