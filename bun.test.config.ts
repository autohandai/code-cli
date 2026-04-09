/**
 * Bun-specific test configuration for optimal performance
 */
import type { BunTestConfig } from 'bun:test';

export default {
  // Use Bun's built-in test runner with optimized settings
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/tests/**/*.spec.ts'
  ],
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/.worktrees/**',
    '**/.claude/worktrees/**',
    '**/.{idea,git,cache,output,temp}/**'
  ],
  // Enable parallel execution
  concurrency: 4,
  // Set reasonable timeout
  timeout: 10000,
  // Preload test setup
  preload: ['./vitest.setup.ts'],
  // Enable coverage for CI environments
  coverage: process.env.CI === 'true' ? {
    include: ['src/**/*.ts'],
    exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts']
  } : false
} satisfies BunTestConfig;
