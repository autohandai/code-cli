/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memory } from '../../src/commands/memory.js';
import { renderAgentSlashCommandResult } from '../../src/core/agent/AgentCommandRuntime.js';
import { SlashCommandHandler } from '../../src/core/slashCommandHandler.js';
import { SLASH_COMMANDS } from '../../src/core/slashCommands.js';
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
    const output = await memory(
      { memoryManager: memoryManager as unknown as MemoryManager },
      ['outline', 'project'],
    );

    expect(memoryManager.getMemoryOutline).toHaveBeenCalledWith('project');
    expect(output).toContain('Memory outline (project)');
    expect(output).toContain('snapshot=snapshot-1 events=10 memories=6');
    expect(output).toContain('- summary node-1: conventions');
    expect(output).toContain('Zoom: /memory zoom project snapshot-1 <node>');
    expect(console.log).not.toHaveBeenCalled();
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

  // Regression: every path printed with console.log and returned null. A full-screen frame holds
  // the console while it is mounted, so `/memory` showed nothing at all.
  describe('output is returned, never printed', () => {
    const ctx = { memoryManager: memoryManager as unknown as MemoryManager };
    const entry = (id: string, content: string, tags?: string[]) => ({
      id, content, tags, createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z',
    });

    it('returns the empty state with the hint for storing a first memory', async () => {
      const output = await memory(ctx);

      expect(output).toContain('Memory Management');
      expect(output).toContain('No memories stored.');
      expect(output).toContain('Tip: Type # followed by text to store a memory.');
      expect(console.log).not.toHaveBeenCalled();
    });

    it('returns project and user memories with their ids, tags and totals', async () => {
      memoryManager.listAll.mockResolvedValue({
        project: [entry('p-1', 'Use strict TypeScript', ['style'])],
        user: [entry('u-1', 'Prefers concise answers'), entry('u-2', 'Works in Sydney time')],
      });

      const output = await memory(ctx);

      expect(output).toContain('Project Memory (.autohand/memory/)');
      expect(output).toContain('  Use strict TypeScript');
      expect(output).toMatch(/ {4}ID: p-1 \| Updated: .+ \[style\]/u);
      expect(output).toContain('User Memory (~/.autohand/memory/)');
      expect(output).toContain('  Prefers concise answers');
      expect(output).toContain('    ID: u-2 | Updated: ');
      expect(output).toContain('Total: 1 project, 2 user memories');
      expect(output.startsWith('\n')).toBe(false);
      expect(output.endsWith('\n')).toBe(false);
      expect(console.log).not.toHaveBeenCalled();
    });

    it('returns a section only for the level that has memories', async () => {
      memoryManager.listAll.mockResolvedValue({ project: [], user: [entry('u-1', 'Only user')] });

      const output = await memory(ctx);

      expect(output).not.toContain('Project Memory');
      expect(output).toContain('User Memory');
      expect(output).toContain('Total: 0 project, 1 user memories');
    });

    it('returns the zoom detail and falls back when a node has no text', async () => {
      await expect(memory(ctx, ['zoom', 'user', 'snapshot-1', 'node-1'])).resolves.toContain(
        '- memory memory-1: strict TypeScript',
      );
      memoryManager.zoomMemory.mockResolvedValue({ snapshotId: 'snapshot-1', totalEntries: 0, nodes: [], text: '' });
      memoryManager.getMemoryOutline.mockResolvedValue({ snapshotId: 'snapshot-2', totalEntries: 0, nodes: [], text: '' });

      await expect(memory(ctx, ['zoom', 'user', 'snapshot-1', 'node-1'])).resolves.toContain('No detail available.');
      const outline = await memory(ctx, ['outline', 'user']);
      expect(outline).toContain('snapshot=snapshot-2 events=0 memories=0');
      expect(outline).toContain('No memories stored yet.');
      expect(console.log).not.toHaveBeenCalled();
    });

    it('returns the confirmation for forget, rebuild and delete', async () => {
      await expect(memory(ctx, ['forget', 'project'])).resolves.toBe(
        'Invalidated 4 derived memory summaries. Canonical events were preserved.',
      );
      memoryManager.forgetMemorySummaries.mockResolvedValue(1);
      await expect(memory(ctx, ['forget', 'user', 'snapshot-1'])).resolves.toBe(
        'Invalidated 1 derived memory summary. Canonical events were preserved.',
      );
      await expect(memory(ctx, ['rebuild', 'user'])).resolves.toBe(
        'Rebuilt user memory from canonical events: restored 1, removed 0.',
      );
      await expect(memory(ctx, ['delete', 'user', 'memory-9'])).resolves.toBe(
        'Deleted user memory memory-9. The canonical deletion event was retained.',
      );
      expect(console.log).not.toHaveBeenCalled();
    });

    it('returns the failure instead of leaving it to a console the frame is holding', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      memoryManager.listAll.mockRejectedValue(new Error('index.json is not valid JSON'));
      memoryManager.delete.mockRejectedValue(new Error('Memory missing-1 not found'));

      await expect(memory(ctx)).resolves.toBe('Memory command failed: index.json is not valid JSON');
      await expect(memory(ctx, ['delete', 'project', 'missing-1'])).resolves.toBe(
        'Memory command failed: Memory missing-1 not found',
      );
      expect(console.log).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });
  });

  describe('interactive session', () => {
    function createHandler() {
      const onBeforeModal = vi.fn();
      const onAfterModal = vi.fn();
      const handler = new SlashCommandHandler(
        { memoryManager: { ...memoryManager, recordCapabilityUse: vi.fn() }, onBeforeModal, onAfterModal } as never,
        SLASH_COMMANDS,
      );
      return { handler, onBeforeModal, onAfterModal };
    }

    it('returns the list as the command result without unmounting the Ink frame', async () => {
      memoryManager.listAll.mockResolvedValue({
        project: [],
        user: [{ id: 'u-1', content: 'Prefers concise answers', createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z' }],
      });
      const { handler, onBeforeModal, onAfterModal } = createHandler();

      const result = await handler.handle('/memory');

      expect(result).toContain('Memory Management');
      expect(result).toContain('Prefers concise answers');
      expect(console.log).not.toHaveBeenCalled();
      expect(onBeforeModal).not.toHaveBeenCalled();
      expect(onAfterModal).not.toHaveBeenCalled();
    });

    it.each([
      { input: '/memory', expected: 'No memories stored.' },
      { input: '/memory outline project', expected: 'snapshot=snapshot-1' },
      { input: '/memory delete project memory-1', expected: 'Deleted project memory memory-1.' },
      { input: '/memory nonsense', expected: '/memory outline <user|project>' },
    ])('lands "$input" in the transcript of a running Ink renderer with its layout intact', async ({ input, expected }) => {
      const { handler } = createHandler();
      const addAssistantMessage = vi.fn();
      const setCommandResult = vi.fn();
      const host = { inkRenderer: { isRunning: () => true, addAssistantMessage, setCommandResult } };

      const [command, ...args] = input.split(' ');
      const result = await handler.handle(command, args);
      const rendered = renderAgentSlashCommandResult(host as never, '/memory', result ?? '');

      expect(rendered).toBe(true);
      expect(setCommandResult).not.toHaveBeenCalled();
      expect(addAssistantMessage).toHaveBeenCalledTimes(1);
      const [message, renderMarkdown] = addAssistantMessage.mock.calls[0];
      expect(renderMarkdown).toBe(false);
      expect(message).toContain(expected);
      expect(console.log).not.toHaveBeenCalled();
    });
  });
});
