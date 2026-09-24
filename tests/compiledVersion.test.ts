/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('standalone binary version metadata', () => {
  it('embeds the alpha version and commit through one Bun environment prefix', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'autohand-compiled-version-'));
    const binary = path.join(root, process.platform === 'win32' ? 'autohand.exe' : 'autohand');
    try {
      execFileSync('bun', [
        'build',
        './src/index.ts',
        '--compile',
        '--external',
        'node-llama-cpp',
        '--env=AUTOHAND_BUILD_*',
        '--outfile',
        binary,
      ], {
        env: {
          ...process.env,
          AUTOHAND_BUILD_VERSION: '0.9.9-alpha.1234abc',
          AUTOHAND_BUILD_GIT_COMMIT: '7654321',
        },
        stdio: 'pipe',
      });

      expect(execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim())
        .toBe('0.9.9-alpha.1234abc (7654321)');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
