import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '.vitest',
  test: {
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    maxConcurrency: 4,
    // Parallel workers have been unstable on this suite; keep a single forked
    // worker so the full suite can reuse the larger Node heap from `npm test`.
    pool: 'forks',
    minWorkers: 1,
    maxWorkers: 1,
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
