/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { GitIgnoreParser } from '../src/utils/gitIgnore.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-ignore-test-'));
});

afterEach(async () => {
  await fs.remove(tempDir);
});

describe('GitIgnoreParser', () => {
  it('ignores files listed in project .gitignore', async () => {
    await fs.writeFile(path.join(tempDir, '.gitignore'), 'dist\n');
    const parser = new GitIgnoreParser(tempDir);

    expect(parser.isIgnored('dist/output.js')).toBe(true);
    expect(parser.isIgnored('src/index.ts')).toBe(false);
  });

  it('respects nested .gitignore files', async () => {
    const nested = path.join(tempDir, 'packages/app');
    await fs.ensureDir(nested);
    await fs.writeFile(path.join(nested, '.gitignore'), 'generated\n');
    const parser = new GitIgnoreParser(tempDir);

    expect(parser.isIgnored('packages/app/generated/file.txt')).toBe(true);
    expect(parser.isIgnored('packages/app/src/file.txt')).toBe(false);
  });

  it('supports extra patterns (e.g., custom ignore files)', async () => {
    const parser = new GitIgnoreParser(tempDir, ['secret.txt']);

    expect(parser.isIgnored('secret.txt')).toBe(true);
    expect(parser.isIgnored('public.txt')).toBe(false);
  });
});
