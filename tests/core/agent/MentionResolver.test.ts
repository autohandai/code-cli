/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MentionResolver } from '../../../src/core/agent/MentionResolver.js';

describe('MentionResolver', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-mentions-'));
  });

  afterEach(async () => {
    await fs.remove(workspaceRoot);
  });

  it('keeps direct file mentions in the prompt and captures trimmed context', async () => {
    await fs.ensureDir(path.join(workspaceRoot, 'src'));
    await fs.writeFile(path.join(workspaceRoot, 'src/index.ts'), 'export const value = 1;\n');

    const resolver = new MentionResolver({
      getWorkspaceRoot: () => workspaceRoot,
      files: {
        readFile: vi.fn(async (file) => fs.readFile(path.join(workspaceRoot, file), 'utf8')),
      },
      collectWorkspaceFiles: vi.fn(async () => []),
      selectFile: vi.fn(),
      getStatusLine: () => '',
    });

    await expect(resolver.resolve('please inspect @src/index.ts')).resolves.toBe(
      'please inspect src/index.ts',
    );
    expect(resolver.flush()).toEqual({
      files: ['src/index.ts'],
      block: 'File: src/index.ts\nexport const value = 1;\n',
    });
  });

  it('does not treat inline at-signs as file mentions', async () => {
    const collectWorkspaceFiles = vi.fn(async () => ['src/index.ts']);
    const resolver = new MentionResolver({
      getWorkspaceRoot: () => workspaceRoot,
      files: {
        readFile: vi.fn(),
      },
      collectWorkspaceFiles,
      selectFile: vi.fn(),
      getStatusLine: () => '',
    });

    await expect(resolver.resolve('email dev@example.com and use pkg@latest')).resolves.toBe(
      'email dev@example.com and use pkg@latest',
    );
    expect(collectWorkspaceFiles).not.toHaveBeenCalled();
    expect(resolver.flush()).toBeNull();
  });
});
