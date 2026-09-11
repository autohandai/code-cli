/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('openBrowser', () => {
  afterEach(() => {
    delete process.env.AUTOHAND_NO_BROWSER;
    vi.restoreAllMocks();
  });

  it('prints the URL instead of launching anything when AUTOHAND_NO_BROWSER is set', async () => {
    process.env.AUTOHAND_NO_BROWSER = '1';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { openBrowser } = await import('../../src/commands/login.js');

    await expect(openBrowser('https://console.autohand.ai/?upgrade=pro&source=cli')).resolves.toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('https://console.autohand.ai/?upgrade=pro&source=cli'));
  });
});
