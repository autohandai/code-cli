/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';

describe('TTY error detection in interactive loop', () => {
  it('identifies setRawMode errno errors as TTY failures', () => {
    // Simulate the error classification logic from the interactive loop
    const ttyErrors = [
      'setRawMode failed with errno: 5',
      'setRawMode failed with errno: 25',
      'Cannot read properties of null (reading \'setRawMode\')',
    ];

    const nonTtyErrors = [
      'API rate limit exceeded',
      'Model not found',
      'Unknown error occurred',
    ];

    const isTTYError = (msg: string): boolean =>
      /setRawMode|errno:\s*\d+|EIO|EPERM/.test(msg);

    for (const err of ttyErrors) {
      expect(isTTYError(err), `"${err}" should be detected as TTY error`).toBe(true);
    }

    for (const err of nonTtyErrors) {
      expect(isTTYError(err), `"${err}" should NOT be detected as TTY error`).toBe(false);
    }
  });

  it('identifies readline creation errors as TTY failures', () => {
    const isTTYError = (msg: string): boolean =>
      /setRawMode|errno:\s*\d+|EIO|EPERM/.test(msg);

    // Node internal error when readline.createInterface fails
    expect(isTTYError('Error: setRawMode failed with errno: 5')).toBe(true);
    // Process exit scenario
    expect(isTTYError('read EIO')).toBe(true);
  });
});
