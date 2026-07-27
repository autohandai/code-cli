/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemorySummaryTree } from '../../src/memory/MemorySummaryTree.js';
import type { MemoryEntry } from '../../src/memory/types.js';

const temporaryRoots: string[] = [];

async function createTree(): Promise<MemorySummaryTree> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-memory-tree-'));
  temporaryRoots.push(root);
  return new MemorySummaryTree(root);
}

function entries(count: number): MemoryEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `memory-${index}`,
    content: `Memory ${index} records project convention number ${index}.`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    tags: [`tag-${index}`],
  }));
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.remove(root)));
});

describe('MemorySummaryTree', () => {
  it('builds a complete bounded cover with increasing detail toward recent memories', async () => {
    const tree = await createTree();
    const outline = await tree.wake('project', entries(32), 'snapshot-a', {
      maxLines: 10,
      maxChars: 1_200,
      recentRawCount: 4,
    });

    expect(outline.nodes.length).toBeLessThanOrEqual(10);
    expect(outline.text.split('\n')).toHaveLength(outline.nodes.length);
    expect(outline.text.length).toBeLessThanOrEqual(1_200);
    expect(outline.nodes[0]?.start).toBe(0);
    expect(outline.nodes.at(-1)?.end).toBe(32);

    for (let index = 1; index < outline.nodes.length; index += 1) {
      expect(outline.nodes[index - 1]?.end).toBe(outline.nodes[index]?.start);
    }

    const spans = outline.nodes.map((node) => node.end - node.start);
    expect(spans.slice(-4)).toEqual([1, 1, 1, 1]);
    expect(spans[0]).toBeGreaterThan(spans.at(-1) ?? 0);
  });

  it('zooms a summary into stable child ranges without changing the snapshot', async () => {
    const tree = await createTree();
    const outline = await tree.wake('project', entries(16), 'snapshot-b', {
      maxLines: 6,
      maxChars: 1_200,
      recentRawCount: 2,
    });
    const summary = outline.nodes.find((node) => node.kind === 'summary');
    expect(summary).toBeDefined();

    const zoomed = await tree.zoom('project', 'snapshot-b', summary!.id, {
      maxLines: 6,
      maxChars: 1_200,
    });

    expect(zoomed.snapshotId).toBe('snapshot-b');
    expect(zoomed.nodes).toHaveLength(2);
    expect(zoomed.nodes[0]?.start).toBe(summary?.start);
    expect(zoomed.nodes[0]?.end).toBe(zoomed.nodes[1]?.start);
    expect(zoomed.nodes[1]?.end).toBe(summary?.end);
  });

  it('invalidates derived summaries without deleting canonical inputs', async () => {
    const tree = await createTree();
    const canonical = entries(8);
    await tree.wake('project', canonical, 'snapshot-c');

    const invalidated = await tree.forget('project', 'snapshot-c');

    expect(invalidated).toBeGreaterThan(0);
    await expect(tree.zoom('project', 'snapshot-c', 'missing')).rejects.toThrow(
      /summary snapshot is unavailable/i,
    );
    expect(canonical).toHaveLength(8);
  });

  it('falls back to a single root summary when the output budget is tight', async () => {
    const tree = await createTree();
    const outline = await tree.wake('project', entries(64), 'snapshot-d', {
      maxLines: 1,
      maxChars: 120,
      recentRawCount: 8,
    });

    expect(outline.nodes).toHaveLength(1);
    expect(outline.nodes[0]).toMatchObject({ start: 0, end: 64, kind: 'summary' });
    expect(outline.text.length).toBeLessThanOrEqual(120);
  });
});
