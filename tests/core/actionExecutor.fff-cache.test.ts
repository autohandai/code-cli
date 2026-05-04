/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionExecutor } from '../../src/core/actionExecutor.js';
import type { AgentRuntime } from '../../src/types.js';

const createProvider = vi.fn();
const grep = vi.fn();
const fileSearch = vi.fn();
const destroy = vi.fn();

vi.mock('../../src/search/fffSearchProvider.js', () => ({
  FFFSearchProvider: {
    create: createProvider,
  },
}));

beforeEach(() => {
  (vi as unknown as { useRealTimers?: () => void }).useRealTimers?.();
  createProvider.mockReset();
  grep.mockReset();
  fileSearch.mockReset();
  destroy.mockReset();
});

function makeExecutor(): ActionExecutor {
  const runtime = {
    workspaceRoot: '/workspace',
    config: {},
    options: {},
  } as AgentRuntime;

  return new ActionExecutor({
    runtime,
    files: {} as never,
    resolveWorkspacePath: (relativePath) => `/workspace/${relativePath}`,
    confirmDangerousAction: async () => true,
  });
}

describe('ActionExecutor FFF search reuse', () => {
  it('reuses a scanned FFF provider across sequential fff searches', async () => {
    createProvider.mockResolvedValue({ grep, fileSearch, destroy });
    grep.mockResolvedValue('grep result');
    fileSearch.mockResolvedValue('find result');

    const executor = makeExecutor();

    await expect(executor.execute({ type: 'fff_grep', query: 'needle' })).resolves.toBe('grep result');
    await expect(executor.execute({ type: 'fff_find', query: 'file' })).resolves.toBe('find result');

    expect(createProvider).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
  });
});
