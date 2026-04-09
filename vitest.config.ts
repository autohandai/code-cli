import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '.vitest',
  test: {
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    maxConcurrency: 4,
    // Enable parallel workers for faster test execution
    pool: 'forks',
    minWorkers: 2,
    maxWorkers: 4,
    poolOptions: {
      forks: {
        execArgv: ['--max-old-space-size=8192'],
      },
    },
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
    ],
  },
});
