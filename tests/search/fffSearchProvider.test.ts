/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const createFileFinder = vi.fn();
const waitForScan = vi.fn();
const grep = vi.fn();
const fileSearch = vi.fn();
const destroy = vi.fn();

vi.mock('@ff-labs/fff-bun', () => ({
  FileFinder: {
    create: createFileFinder,
  },
}));

const createFinder = () => ({
  waitForScan,
  grep,
  fileSearch,
  destroy,
});

describe('FFFSearchProvider', () => {
  beforeEach(() => {
    vi.resetModules();
    createFileFinder.mockReset();
    waitForScan.mockReset();
    grep.mockReset();
    fileSearch.mockReset();
    destroy.mockReset();
  });

  it('unwraps fff grep Result objects and formats matched lines', async () => {
    const finder = createFinder();
    createFileFinder.mockReturnValue({ ok: true, value: finder });
    waitForScan.mockReturnValue({ ok: true, value: true });
    grep.mockReturnValue({
      ok: true,
      value: {
        items: [
          {
            relativePath: 'src/index.ts',
            lineNumber: 12,
            lineContent: 'const answer = 42;',
            contextBefore: ['function main() {'],
            contextAfter: ['}'],
          },
        ],
        totalMatched: 1,
        totalFilesSearched: 1,
        totalFiles: 1,
        filteredFileCount: 1,
        nextCursor: null,
      },
    });

    const { FFFSearchProvider } = await import('../../src/search/fffSearchProvider.js');
    const provider = await FFFSearchProvider.create('/workspace');

    await expect(provider.grep({ query: 'answer' })).resolves.toBe(
      'Found 1 match:\n\nfunction main() {\nsrc/index.ts:12: const answer = 42;\n}'
    );
    expect(grep).toHaveBeenCalledWith('answer', expect.objectContaining({ mode: 'plain' }));
  });

  it('unwraps fff fileSearch Result objects and formats git-aware paths', async () => {
    const finder = createFinder();
    createFileFinder.mockReturnValue({ ok: true, value: finder });
    waitForScan.mockReturnValue({ ok: true, value: true });
    fileSearch.mockReturnValue({
      ok: true,
      value: {
        items: [
          { relativePath: 'src/search/fffSearchProvider.ts', gitStatus: 'modified' },
          { relativePath: 'tests/search/fffSearchProvider.test.ts', gitStatus: 'clean' },
        ],
        scores: [],
        totalMatched: 2,
        totalFiles: 10,
      },
    });

    const { FFFSearchProvider } = await import('../../src/search/fffSearchProvider.js');
    const provider = await FFFSearchProvider.create('/workspace');

    await expect(provider.fileSearch({ query: 'fff', limit: 2 })).resolves.toBe(
      '[modified] src/search/fffSearchProvider.ts\ntests/search/fffSearchProvider.test.ts'
    );
  });

  it('surfaces fff search errors instead of reporting empty results', async () => {
    const finder = createFinder();
    createFileFinder.mockReturnValue({ ok: true, value: finder });
    waitForScan.mockReturnValue({ ok: true, value: true });
    grep.mockReturnValue({ ok: false, error: 'native grep failed' });

    const { FFFSearchProvider } = await import('../../src/search/fffSearchProvider.js');
    const provider = await FFFSearchProvider.create('/workspace');

    await expect(provider.grep({ query: 'boom' })).rejects.toThrow('native grep failed');
  });

  it('falls back instead of requiring FileFinder.create at runtime', async () => {
    const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const workspace = await mkdtemp(join(tmpdir(), 'autohand-fff-fallback-'));
    await writeFile(join(workspace, 'needle.ts'), 'export const needle = true;\n', 'utf8');

    vi.doMock('@ff-labs/fff-bun', () => ({
      FileFinder: class FileFinder {},
    }));

    try {
      const { FFFSearchProvider } = await import('../../src/search/fffSearchProvider.js');
      const provider = await FFFSearchProvider.create(workspace);

      await expect(provider.fileSearch({ query: 'needle', limit: 2 })).resolves.toContain('needle.ts');

      provider.destroy();
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
