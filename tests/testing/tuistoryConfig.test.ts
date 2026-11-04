/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(),
  existsSync: vi.fn(() => true),
}));

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

async function loadWorkers(value?: string) {
  vi.stubEnv('AUTOHAND_TUISTORY_WORKERS', value);
  return (await import('../../vitest.tuistory.config.js')).default.test;
}

describe('terminal test worker configuration', () => {
  it.each([undefined, '', '0', '-1', '3', '200', '2junk', '1.5'])('keeps ordinary or invalid worker requests serial (%s)', async value => {
    expect(await loadWorkers(value)).toMatchObject({ minWorkers: 1, maxWorkers: 1, fileParallelism: false, sequence: { concurrent: false } });
  });

  it('allows an explicit two-worker proof without concurrent cases inside a file', async () => {
    expect(await loadWorkers('2')).toMatchObject({ minWorkers: 2, maxWorkers: 2, fileParallelism: true, sequence: { concurrent: false } });
  });
});
