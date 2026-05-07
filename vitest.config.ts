import { defineConfig } from 'vitest/config';

const isCi = process.env.CI === 'true';
const workerCount = isCi ? 1 : 4;
const minWorkerCount = isCi ? 1 : 2;

export default defineConfig({
  cacheDir: '.vitest',
  test: {
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    maxConcurrency: workerCount,
    // Keep local runs parallel while avoiding CI fork worker exits after test completion.
    pool: isCi ? 'threads' : 'forks',
    minWorkers: minWorkerCount,
    maxWorkers: workerCount,
    fileParallelism: !isCi,
    silent: true,
    // Many tests intentionally print status updates; Vitest buffers that
    // output and can exhaust heap on large runs.
    onConsoleLog: () => false,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.worktrees/**',
      '**/.claude/worktrees/**',
      '**/.{idea,git,cache,output,temp}/**',
      'tests/tuistory/**',
    ],
  },
  poolOptions: {
    forks: {
      execArgv: ['--max-old-space-size=8192'],
    },
    threads: {
      singleThread: true,
    },
  },
});
