/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { safeSetRawMode } from '../../src/ui/rawMode.js';

describe('safeSetRawMode', () => {
  it('returns false when stream is not a TTY', () => {
    const stream = {
      isTTY: false,
      setRawMode: vi.fn(),
    } as unknown as NodeJS.ReadStream & { setRawMode: (mode: boolean) => void };

    expect(safeSetRawMode(stream, true)).toBe(false);
    expect(stream.setRawMode).not.toHaveBeenCalled();
  });

  it('returns false when setRawMode is unavailable', () => {
    const stream = {
      isTTY: true,
    } as unknown as NodeJS.ReadStream;

    expect(safeSetRawMode(stream, true)).toBe(false);
  });

  it('calls setRawMode and returns true on success', () => {
    const stream = {
      isTTY: true,
      setRawMode: vi.fn(),
    } as unknown as NodeJS.ReadStream & { setRawMode: (mode: boolean) => void };

    expect(safeSetRawMode(stream, true)).toBe(true);
    expect(stream.setRawMode).toHaveBeenCalledWith(true);
  });

  it('swallows setRawMode errors and returns false', () => {
    const stream = {
      isTTY: true,
      setRawMode: vi.fn(() => {
        throw new Error('setRawMode failed with errno: 5');
      }),
    } as unknown as NodeJS.ReadStream & { setRawMode: (mode: boolean) => void };

    expect(safeSetRawMode(stream, false)).toBe(false);
    expect(stream.setRawMode).toHaveBeenCalledWith(false);
  });
});

