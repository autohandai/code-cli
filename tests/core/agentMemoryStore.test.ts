/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const showModal = vi.fn();
const showConfirm = vi.fn();
vi.mock('../../src/ui/ink/components/Modal.js', () => ({ showModal, showConfirm }));

const { handleAgentMemoryStore, reportAgentMemoryStore } = await import('../../src/core/agent/AgentProjectOperations.js');

const memoryManager = {
  findSimilar: vi.fn(),
  store: vi.fn(),
  updateMemory: vi.fn(),
};
const host = { memoryManager } as never;

// Regression: the `#` shortcut printed its outcome with console.log while the Ink frame was
// unmounted for the level picker. A full-screen frame repaints every row on resume, so the
// confirmation (and any failure) was never readable.
describe('storing a memory with the # shortcut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    showModal.mockResolvedValue({ label: 'Project', value: 'project' });
    showConfirm.mockResolvedValue(false);
    memoryManager.findSimilar.mockResolvedValue(null);
    memoryManager.store.mockResolvedValue({ id: 'new-1' });
    memoryManager.updateMemory.mockResolvedValue({ id: 'old-1' });
  });

  afterEach(() => {
    expect(console.log).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('returns usage when there is nothing to remember', async () => {
    const message = await handleAgentMemoryStore(host, '');

    expect(message).toContain('Usage: # <text to remember>');
    expect(message).toContain('Example: # Always use TypeScript strict mode');
    expect(showModal).not.toHaveBeenCalled();
  });

  it('returns the confirmation naming the level the memory was saved to', async () => {
    showModal.mockResolvedValue({ label: 'User', value: 'user' });

    await expect(handleAgentMemoryStore(host, 'Prefer pnpm')).resolves.toBe('Memory saved to user level.');
    expect(memoryManager.store).toHaveBeenCalledWith('Prefer pnpm', 'user');
  });

  it('returns nothing when the level picker is dismissed', async () => {
    showModal.mockResolvedValue(null);

    await expect(handleAgentMemoryStore(host, 'Prefer pnpm')).resolves.toBeNull();
    expect(memoryManager.store).not.toHaveBeenCalled();
  });

  it('shows the similar memory inside the question and confirms the update', async () => {
    memoryManager.findSimilar.mockResolvedValue({ score: 0.8, entry: { id: 'old-1', content: 'Prefer pnpm over npm' } });
    showConfirm.mockResolvedValue(true);

    await expect(handleAgentMemoryStore(host, 'Prefer pnpm')).resolves.toBe('Memory updated.');
    expect(showConfirm.mock.calls[0][0].title).toContain('"Prefer pnpm over npm"');
    expect(memoryManager.updateMemory).toHaveBeenCalledWith('old-1', 'Prefer pnpm', 'project');
    expect(memoryManager.store).not.toHaveBeenCalled();
  });

  it('saves a new memory when the similar one is kept as it is', async () => {
    memoryManager.findSimilar.mockResolvedValue({ score: 0.8, entry: { id: 'old-1', content: 'Prefer pnpm over npm' } });

    await expect(handleAgentMemoryStore(host, 'Prefer pnpm')).resolves.toBe('Memory saved to project level.');
    expect(memoryManager.updateMemory).not.toHaveBeenCalled();
  });

  it('returns the failure and stays quiet for a cancelled prompt', async () => {
    memoryManager.store.mockRejectedValue(new Error('The project memory account or workspace changed.'));
    await expect(handleAgentMemoryStore(host, 'Prefer pnpm')).resolves.toBe(
      'Failed to store memory: The project memory account or workspace changed.',
    );

    showModal.mockRejectedValue(Object.assign(new Error('cancelled'), { isCanceled: true }));
    await expect(handleAgentMemoryStore(host, 'Prefer pnpm')).resolves.toBeNull();
  });

  describe('reporting the outcome', () => {
    it('adds it to the transcript verbatim when an Ink renderer owns the screen', () => {
      const addAssistantMessage = vi.fn();

      reportAgentMemoryStore({ addAssistantMessage }, 'Memory saved to user level.');

      expect(addAssistantMessage).toHaveBeenCalledWith('Memory saved to user level.', false);
    });

    it('reports nothing when the user backed out', () => {
      const addAssistantMessage = vi.fn();

      reportAgentMemoryStore({ addAssistantMessage }, null);
      reportAgentMemoryStore(null, null);

      expect(addAssistantMessage).not.toHaveBeenCalled();
    });
  });
});

describe('reporting a # memory without an Ink renderer', () => {
  it('prints to the console of the classic prompt', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    reportAgentMemoryStore(null, 'Memory updated.');

    expect(log).toHaveBeenCalledWith('Memory updated.');
    log.mockRestore();
  });
});
