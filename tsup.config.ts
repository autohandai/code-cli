import { defineConfig } from 'tsup';
import { execSync } from 'node:child_process';

// Get git commit at build time
function getGitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}

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
  // Embed git commit at build time
  define: {
    'process.env.BUILD_GIT_COMMIT': JSON.stringify(getGitCommit()),
  },
});
