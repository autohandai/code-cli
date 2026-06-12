/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { LoadedConfig } from '../../src/types.js';

vi.mock('../../src/auth/index.js', () => ({
  getAuthClient: vi.fn(),
}));

vi.mock('../../src/config.js', () => ({
  saveConfig: vi.fn(),
}));

import { getAuthClient } from '../../src/auth/index.js';
import { saveConfig } from '../../src/config.js';
import { validateAuthOnStartup } from '../../src/auth/startupAuth.js';

describe('validateAuthOnStartup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not treat a server-rejected cached token as logged in', async () => {
    const config: LoadedConfig = {
      configPath: '/tmp/config.json',
      auth: {
        token: 'invalid-token',
        user: { id: 'user-1', email: 'user@example.com' },
      },
    };
    (getAuthClient as ReturnType<typeof vi.fn>).mockReturnValue({
      validateSession: vi.fn().mockResolvedValue({ authenticated: false }),
    });

    await expect(validateAuthOnStartup(config)).resolves.toBeUndefined();
    expect(config.auth).toBeUndefined();
    expect(saveConfig).toHaveBeenCalledWith(config);
  });

  it('keeps locally cached auth on network validation errors', async () => {
    const user = { id: 'user-1', email: 'user@example.com' };
    const config: LoadedConfig = {
      configPath: '/tmp/config.json',
      auth: {
        token: 'valid-local-token',
        user,
      },
    };
    (getAuthClient as ReturnType<typeof vi.fn>).mockReturnValue({
      validateSession: vi.fn().mockRejectedValue(new Error('fetch failed')),
    });

    await expect(validateAuthOnStartup(config)).resolves.toBe(user);
    expect(config.auth?.token).toBe('valid-local-token');
    expect(saveConfig).not.toHaveBeenCalled();
  });
});
