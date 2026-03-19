/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression test: resetScrollRegion() must write ESC[r to stdout
 * before Ink renders so arrow-key navigation doesn't cause duplicated
 * output. (GH modal-duplication bug)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resetScrollRegion } from '../../src/ui/resetScrollRegion.js';

describe('resetScrollRegion()', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes \\x1B[r to stdout when TTY', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const isTTY = process.stdout.isTTY;

    try {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });

      resetScrollRegion();

      expect(writeSpy).toHaveBeenCalledWith('\x1B[r');
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: isTTY, writable: true });
    }
  });

  it('does NOT write when stdout is not a TTY', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const isTTY = process.stdout.isTTY;

    try {
      Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true });

      resetScrollRegion();

      expect(writeSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: isTTY, writable: true });
    }
  });

  it('ESC[r is the correct ANSI code to reset scroll region', () => {
    // Documentation test — ANSI standard: CSI r (no params) = reset scroll region
    const ESC = '\x1B';
    const CSI = `${ESC}[`;
    const resetCode = `${CSI}r`;

    expect(resetCode).toBe('\x1B[r');
  });
});
