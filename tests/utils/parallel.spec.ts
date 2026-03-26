/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { runWithConcurrency } from '../../src/utils/parallel.js';

describe('runWithConcurrency', () => {
  it('preserves input order in the returned results', async () => {
    const results = await runWithConcurrency([
      { label: 'first', run: async () => 'a' },
      { label: 'second', run: async () => 'b' },
      { label: 'third', run: async () => 'c' },
    ]);

    expect(results).toEqual(['a', 'b', 'c']);
  });

  it('respects the concurrency limit', async () => {
    let running = 0;
    let maxRunning = 0;

    const results = await runWithConcurrency(
      Array.from({ length: 6 }, (_, index) => ({
        label: `task-${index}`,
        run: async () => {
          running += 1;
          maxRunning = Math.max(maxRunning, running);
          await new Promise((resolve) => setTimeout(resolve, 10));
          running -= 1;
          return index;
        },
      })),
      2,
    );

    expect(results).toEqual([0, 1, 2, 3, 4, 5]);
    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it('defaults to concurrency 5 when given an invalid limit', async () => {
    let running = 0;
    let maxRunning = 0;

    await runWithConcurrency(
      Array.from({ length: 6 }, (_, index) => ({
        label: `task-${index}`,
        run: async () => {
          running += 1;
          maxRunning = Math.max(maxRunning, running);
          await new Promise((resolve) => setTimeout(resolve, 10));
          running -= 1;
          return index;
        },
      })),
      0,
    );

    expect(maxRunning).toBeLessThanOrEqual(5);
  });
});
