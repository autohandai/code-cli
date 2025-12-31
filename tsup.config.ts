import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true,
  clean: true,
  target: 'node18',
  // Keep these external to avoid bundling issues
  external: [
    'react-devtools-core',
  ],
  // Ensure ink-spinner uses the same React as ink
  noExternal: [
    'ink-spinner',
  ],
});
