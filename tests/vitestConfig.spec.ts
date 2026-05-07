/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';

interface VitestUserConfig {
  test?: {
    exclude?: string[];
    fileParallelism?: boolean;
    maxConcurrency?: number;
    minWorkers?: number;
    maxWorkers?: number;
    pool?: string;
  };
  poolOptions?: {
    forks?: {
      singleFork?: boolean;
      execArgv?: string[];
    };
    threads?: {
      singleThread?: boolean;
    };
  };
}

async function loadVitestConfig(ci: boolean): Promise<VitestUserConfig> {
  const previousCi = process.env.CI;
  process.env.CI = ci ? 'true' : '';

  try {
    const module = ci
      ? await import('../vitest.config.ts?ci=true')
      : await import('../vitest.config.ts?ci=false');
    return module.default as VitestUserConfig;
  } finally {
    if (previousCi === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = previousCi;
    }
  }
}

describe('vitest config', () => {
  it('keeps local test runs parallel', async () => {
    const config = await loadVitestConfig(false);

    expect(config.test?.pool).toBe('forks');
    expect(config.test?.maxConcurrency).toBe(4);
    expect(config.test?.minWorkers).toBe(2);
    expect(config.test?.maxWorkers).toBe(4);
    expect(config.poolOptions?.forks?.singleFork).toBeUndefined();
  });

  it('uses a single thread in CI to avoid forked worker exits', async () => {
    const config = await loadVitestConfig(true);

    expect(config.test?.pool).toBe('threads');
    expect(config.test?.maxConcurrency).toBe(1);
    expect(config.test?.minWorkers).toBe(1);
    expect(config.test?.maxWorkers).toBe(1);
    expect(config.test?.fileParallelism).toBe(false);
    expect(config.poolOptions?.forks?.singleFork).toBeUndefined();
    expect(config.poolOptions?.forks?.execArgv).toContain('--max-old-space-size=8192');
    expect(config.poolOptions?.threads?.singleThread).toBe(true);
  });

  it('keeps Tuistory tests on their dedicated built-CLI config', async () => {
    const config = await loadVitestConfig(true);

    expect(config.test?.exclude).toContain('tests/tuistory/**');
  });
});
