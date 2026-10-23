import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('npm package licensing documents', () => {
  it('ships the Apache licence, commercial terms and README', () => {
    const output = execFileSync('bun', ['pm', 'pack', '--dry-run', '--ignore-scripts'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    for (const name of ['LICENSE', 'COMMERCIAL.md', 'README.md']) {
      expect(output.split('\n').some(line => line.startsWith('packed ') && line.endsWith(` ${name}`)), name).toBe(true);
    }
  });
});
