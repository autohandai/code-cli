/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memory } from '../../src/commands/memory.js';
import type { MemoryManager } from '../../src/memory/MemoryManager.js';

const memoryManager = {
  delete: vi.fn(),
  forgetMemorySummaries: vi.fn(),
  getMemoryOutline: vi.fn(),
  listAll: vi.fn(),
  rebuildFromEventLog: vi.fn(),
  zoomMemory: vi.fn(),
};

describe('/memory command', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.clearAllMocks();
    memoryManager.listAll.mockResolvedValue({ project: [], user: [] });
    memoryManager.getMemoryOutline.mockResolvedValue({
      snapshotId: 'snapshot-1',
      eventCount: 10,
      totalEntries: 6,
      nodes: [],
      text: '- summary node-1: conventions',
    });
    memoryManager.zoomMemory.mockResolvedValue({
      snapshotId: 'snapshot-1',
      totalEntries: 6,
      nodes: [],
      text: '- memory memory-1: strict TypeScript',
    });
    memoryManager.forgetMemorySummaries.mockResolvedValue(4);
    memoryManager.rebuildFromEventLog.mockResolvedValue({ restored: 1, removed: 0 });
    memoryManager.delete.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a bounded outline and its stable snapshot ID', async () => {
    await memory(
      { memoryManager: memoryManager as unknown as MemoryManager },
      ['outline', 'project'],
    );

    expect(memoryManager.getMemoryOutline).toHaveBeenCalledWith('project');
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(
      'snapshot=snapshot-1',
    );
  });

  it('routes zoom, derived invalidation, projection rebuild, and canonical deletion', async () => {
    const ctx = { memoryManager: memoryManager as unknown as MemoryManager };

    await memory(ctx, ['zoom', 'project', 'snapshot-1', 'node-1']);
    await memory(ctx, ['forget', 'project', 'snapshot-1']);
    await memory(ctx, ['rebuild', 'project']);
    await memory(ctx, ['delete', 'project', 'memory-1']);

    expect(memoryManager.zoomMemory).toHaveBeenCalledWith(
      'project',
      'snapshot-1',
      'node-1',
    );
    expect(memoryManager.forgetMemorySummaries).toHaveBeenCalledWith(
      'project',
      'snapshot-1',
    );
    expect(memoryManager.rebuildFromEventLog).toHaveBeenCalledWith('project');
    expect(memoryManager.delete).toHaveBeenCalledWith('memory-1', 'project');
  });

  it('returns actionable usage for incomplete or unknown subcommands', async () => {
    const ctx = { memoryManager: memoryManager as unknown as MemoryManager };

    await expect(memory(ctx, ['zoom', 'project'])).resolves.toContain(
      '/memory zoom <user|project> <snapshot> <node>',
    );
    await expect(memory(ctx, ['unknown'])).resolves.toContain('/memory outline');
  });
});
