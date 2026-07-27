/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionExecutor } from '../../src/core/actionExecutor.js';
import { DEFAULT_TOOL_DEFINITIONS } from '../../src/core/toolManager.js';
import type { MemoryManager } from '../../src/memory/MemoryManager.js';
import type { AgentRuntime } from '../../src/types.js';

const memoryManager = {
  delete: vi.fn(),
  forgetMemorySummaries: vi.fn(),
  getMemoryOutline: vi.fn(),
  rebuildFromEventLog: vi.fn(),
  zoomMemory: vi.fn(),
};

function createExecutor(): ActionExecutor {
  return new ActionExecutor({
    runtime: {
      workspaceRoot: '/workspace',
      config: {},
      options: {},
    } as AgentRuntime,
    files: {} as never,
    memoryManager: memoryManager as unknown as MemoryManager,
    resolveWorkspacePath: (relativePath) => `/workspace/${relativePath}`,
    confirmDangerousAction: async () => true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  memoryManager.getMemoryOutline.mockResolvedValue({
    snapshotId: 'snapshot-1',
    eventCount: 12,
    totalEntries: 8,
    nodes: [{ id: 'node-1' }],
    text: '- summary node-1: project conventions',
  });
  memoryManager.zoomMemory.mockResolvedValue({
    snapshotId: 'snapshot-1',
    totalEntries: 8,
    nodes: [{ id: 'child-1' }, { id: 'child-2' }],
    text: '- memory one\n- memory two',
  });
  memoryManager.forgetMemorySummaries.mockResolvedValue(7);
  memoryManager.rebuildFromEventLog.mockResolvedValue({ restored: 2, removed: 1 });
  memoryManager.delete.mockResolvedValue(undefined);
});

describe('memory management tools', () => {
  it('publishes inspect and delete definitions with explicit contracts', () => {
    const inspect = DEFAULT_TOOL_DEFINITIONS.find((tool) => tool.name === 'inspect_memory');
    const remove = DEFAULT_TOOL_DEFINITIONS.find((tool) => tool.name === 'delete_memory');

    expect(inspect?.parameters.properties?.operation).toMatchObject({
      enum: ['outline', 'zoom', 'forget', 'rebuild'],
    });
    expect(remove?.parameters.required).toEqual(['id']);
  });

  it('returns a bounded outline with stable snapshot and zoom identifiers', async () => {
    const output = await createExecutor().execute({
      type: 'inspect_memory',
      operation: 'outline',
      level: 'project',
      max_lines: 8,
      max_chars: 1_000,
    });

    expect(memoryManager.getMemoryOutline).toHaveBeenCalledWith('project', {
      maxLines: 8,
      maxChars: 1_000,
    });
    expect(output).toContain('snapshot=snapshot-1');
    expect(output).toContain('node-1');
  });

  it('zooms, invalidates derived summaries, and rebuilds projections explicitly', async () => {
    const executor = createExecutor();

    await expect(executor.execute({
      type: 'inspect_memory',
      operation: 'zoom',
      level: 'project',
      snapshot_id: 'snapshot-1',
      node_id: 'node-1',
    })).resolves.toContain('child-1');
    await expect(executor.execute({
      type: 'inspect_memory',
      operation: 'forget',
      level: 'project',
      snapshot_id: 'snapshot-1',
    })).resolves.toContain('Invalidated 7');
    await expect(executor.execute({
      type: 'inspect_memory',
      operation: 'rebuild',
      level: 'project',
    })).resolves.toContain('restored 2');
  });

  it('requires snapshot and node identifiers for zoom', async () => {
    await expect(createExecutor().execute({
      type: 'inspect_memory',
      operation: 'zoom',
      level: 'project',
    })).rejects.toThrow(/snapshot_id and node_id/i);
  });

  it('records canonical deletion through the memory manager', async () => {
    await expect(createExecutor().execute({
      type: 'delete_memory',
      id: 'memory-1',
      level: 'user',
    })).resolves.toContain('Deleted user memory memory-1');
    expect(memoryManager.delete).toHaveBeenCalledWith('memory-1', 'user');
  });
});
