/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { pushBounded, setBounded } from '../../src/utils/bounded.js';

describe('pushBounded', () => {
  it('appends and drops the oldest entries beyond the limit', () => {
    const values: number[] = [];
    for (let index = 0; index < 7; index += 1) {
      pushBounded(values, index, 5);
    }
    expect(values).toEqual([2, 3, 4, 5, 6]);
  });
});

describe('setBounded', () => {
  it('evicts the least recently set key beyond the limit', () => {
    const map = new Map<string, number>();
    setBounded(map, 'a', 1, 2);
    setBounded(map, 'b', 2, 2);
    setBounded(map, 'c', 3, 2);
    expect([...map.keys()]).toEqual(['b', 'c']);
  });

  it('treats re-setting an existing key as most recent', () => {
    const map = new Map<string, number>();
    setBounded(map, 'a', 1, 2);
    setBounded(map, 'b', 2, 2);
    setBounded(map, 'a', 3, 2);
    setBounded(map, 'c', 4, 2);
    expect([...map.entries()]).toEqual([['a', 3], ['c', 4]]);
  });
});
