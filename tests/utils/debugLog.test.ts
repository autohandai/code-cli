/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAutohandDebugEnabled, writeAutohandDebugLine } from '../../src/utils/debugLog.js';

const originalDebug = process.env.AUTOHAND_DEBUG;

afterEach(() => {
  if (originalDebug === undefined) {
    delete process.env.AUTOHAND_DEBUG;
  } else {
    process.env.AUTOHAND_DEBUG = originalDebug;
  }
  vi.restoreAllMocks();
});

describe('debugLog', () => {
  it('treats AUTOHAND_DEBUG=1 as enabled', () => {
    expect(isAutohandDebugEnabled({ AUTOHAND_DEBUG: '1' })).toBe(true);
  });

  it('treats AUTOHAND_DEBUG=true as enabled', () => {
    expect(isAutohandDebugEnabled({ AUTOHAND_DEBUG: 'true' })).toBe(true);
  });

  it('writes enabled debug lines to stderr by default', () => {
    process.env.AUTOHAND_DEBUG = '1';
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    writeAutohandDebugLine('[DEBUG] visible');

    expect(stderrSpy).toHaveBeenCalledWith('[DEBUG] visible\n');
  });

  it('routes enabled debug lines through the supplied writer', () => {
    process.env.AUTOHAND_DEBUG = '1';
    const writer = vi.fn();

    writeAutohandDebugLine('[DEBUG] via composer bridge', writer);

    expect(writer).toHaveBeenCalledWith('[DEBUG] via composer bridge');
  });

  it('stays silent when AUTOHAND_DEBUG is disabled', () => {
    delete process.env.AUTOHAND_DEBUG;
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    writeAutohandDebugLine('[DEBUG] hidden');

    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
