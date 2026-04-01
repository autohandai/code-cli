import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    maxConcurrency: 4,
    // Parallel workers have been unstable on this suite; keep a single thread
    // and suppress noisy test output so proof completes reliably.
    pool: 'threads',
    minWorkers: 1,
    maxWorkers: 1,
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
