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

async function loadVitestConfig(ci: boolean, workers?: number): Promise<VitestUserConfig> {
  const previousCi = process.env.CI;
  const previousWorkers = process.env.AUTOHAND_TEST_WORKERS;
  process.env.CI = ci ? 'true' : '';
  if (workers === undefined) delete process.env.AUTOHAND_TEST_WORKERS;
  else process.env.AUTOHAND_TEST_WORKERS = String(workers);

  try {
    const module = workers === 1
      ? await import('../vitest.config.ts?workers=1')
      : ci
      ? await import('../vitest.config.ts?ci=true')
      : await import('../vitest.config.ts?ci=false');
    return module.default as VitestUserConfig;
  } finally {
    if (previousWorkers === undefined) delete process.env.AUTOHAND_TEST_WORKERS;
    else process.env.AUTOHAND_TEST_WORKERS = previousWorkers;
    if (previousCi === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = previousCi;
    }
  }
}

describe('vitest config', () => {
  it('allows a single local forked worker without changing the test scope', async () => {
    const config = await loadVitestConfig(false, 1);
    expect(config.test?.pool).toBe('forks');
    expect(config.test?.maxConcurrency).toBe(1);
    expect(config.test?.maxWorkers).toBe(1);
    expect(config.test?.minWorkers).toBe(1);
  });
  it('keeps local test runs parallel', async () => {
    const config = await loadVitestConfig(false);

    expect(config.test?.pool).toBe('forks');
    expect(config.test?.maxConcurrency).toBe(2);
    expect(config.test?.minWorkers).toBe(2);
    expect(config.test?.maxWorkers).toBe(2);
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
  it('excludes local diagnostic artifacts that may import other checkouts', async () => {
    const config = await loadVitestConfig(false);
    expect(config.test?.exclude).toContain('**/.artifacts/**');
  });
});
