import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const distEntry = path.resolve(import.meta.dirname, 'dist/index.js');

if (!existsSync(distEntry)) {
  throw new Error(
    'Tuistory tests require the built CLI at dist/index.js. Run `bun run build` before `bun run test:tuistory`.'
  );
}

export default defineConfig({
  cacheDir: '.vitest-tuistory',
  test: {
    include: ['tests/tuistory/**/*.tuistory.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    maxConcurrency: 1,
    pool: 'forks',
    minWorkers: 1,
    maxWorkers: 1,
    sequence: {
      concurrent: false,
    },
  },
  poolOptions: {
    forks: {
      singleFork: true,
      execArgv: ['--max-old-space-size=4096'],
    },
  },
});
