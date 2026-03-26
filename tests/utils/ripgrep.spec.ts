/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('ripgrep resolver', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers a bundled rg next to the current executable', async () => {
    const originalExecPath = process.execPath;
    const bundledPath = path.join('/tmp/autohand/bin', 'rg');

    Object.defineProperty(process, 'execPath', {
      value: '/tmp/autohand/bin/autohand',
      configurable: true,
    });
    vi.spyOn(fs, 'existsSync').mockImplementation((target) => String(target) === bundledPath);

    const { getBundledRipgrepPath, resolveRipgrepCommand } = await import('../../src/utils/ripgrep.js');

    expect(getBundledRipgrepPath()).toBe(bundledPath);
    expect(resolveRipgrepCommand()).toBe(bundledPath);

    Object.defineProperty(process, 'execPath', {
      value: originalExecPath,
      configurable: true,
    });
  });

  it('falls back to rg when no bundled binary is present', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const { getBundledRipgrepPath, resolveRipgrepCommand } = await import('../../src/utils/ripgrep.js');

    expect(getBundledRipgrepPath()).toBeNull();
    expect(resolveRipgrepCommand()).toBe('rg');
  });
});
