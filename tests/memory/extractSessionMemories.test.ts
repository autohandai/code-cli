/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractAndSaveSessionMemories,
  type ExtractedMemory,
  type ExtractionDeps,
} from '../../src/memory/extractSessionMemories.js';
import type { LLMProvider } from '../../src/providers/LLMProvider.js';
import type { MemoryManager } from '../../src/memory/MemoryManager.js';
import type { LLMMessage, LLMResponse } from '../../src/types.js';
import type { MemoryEntry } from '../../src/memory/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLLMResponse(content: string): LLMResponse {
  return {
    id: 'resp-1',
    created: Date.now(),
    content,
    raw: {},
  };
}

function createMockProvider(responseContent: string): LLMProvider {
  return {
    getName: () => 'mock',
    complete: vi.fn().mockResolvedValue(makeLLMResponse(responseContent)),
    listModels: vi.fn().mockResolvedValue([]),
    isAvailable: vi.fn().mockResolvedValue(true),
    setModel: vi.fn(),
  } as unknown as LLMProvider;
}

function createMockMemoryManager(): MemoryManager {
  let callIndex = 0;
  return {
    store: vi.fn().mockImplementation(
      (content: string, level: string, tags?: string[]) => {
        const entry: MemoryEntry = {
          id: `mem-${++callIndex}`,
          content,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          tags,
        };
        return Promise.resolve(entry);
      },
    ),
  } as unknown as MemoryManager;
}

function buildHistory(userCount: number): LLMMessage[] {
  const msgs: LLMMessage[] = [];
  for (let i = 0; i < userCount; i++) {
    msgs.push({ role: 'user', content: `user message ${i}` });
    msgs.push({ role: 'assistant', content: `assistant reply ${i}` });
  }
  return msgs;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extractAndSaveSessionMemories', () => {
  let memoryManager: MemoryManager;

  beforeEach(() => {
    memoryManager = createMockMemoryManager();
  });

  // 1. Extracts memories from LLM response and stores them
  it('extracts memories from LLM response and stores them', async () => {
    const llmPayload: ExtractedMemory[] = [
      { content: 'Prefers tabs over spaces', level: 'user', tags: ['style'] },
      { content: 'Uses vitest for testing', level: 'project', tags: ['testing'] },
    ];
    const provider = createMockProvider(JSON.stringify(llmPayload));

    const deps: ExtractionDeps = {
      llm: provider,
      memoryManager,
      conversationHistory: buildHistory(3),
      workspaceRoot: '/workspace',
    };

    const result = await extractAndSaveSessionMemories(deps);

    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('Prefers tabs over spaces');
    expect(result[0].level).toBe('user');
    expect(result[1].content).toBe('Uses vitest for testing');
    expect(result[1].level).toBe('project');

    expect(memoryManager.store).toHaveBeenCalledTimes(2);
    expect(memoryManager.store).toHaveBeenCalledWith(
      'Prefers tabs over spaces',
      'user',
      ['style'],
      'session-extraction',
    );
    expect(memoryManager.store).toHaveBeenCalledWith(
      'Uses vitest for testing',
      'project',
      ['testing'],
      'session-extraction',
    );
  });

  // 2. Returns empty array when conversation is too short (< 2 user messages)
  it('returns empty array when conversation has fewer than 2 user messages', async () => {
    const provider = createMockProvider('[]');
    const deps: ExtractionDeps = {
      llm: provider,
      memoryManager,
      conversationHistory: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ],
      workspaceRoot: '/workspace',
    };

    const result = await extractAndSaveSessionMemories(deps);

    expect(result).toEqual([]);
    expect(provider.complete).not.toHaveBeenCalled();
  });

  // 3. Returns empty array when LLM returns empty array
  it('returns empty array when LLM returns empty array', async () => {
    const provider = createMockProvider('[]');
    const deps: ExtractionDeps = {
      llm: provider,
      memoryManager,
      conversationHistory: buildHistory(3),
      workspaceRoot: '/workspace',
    };

    const result = await extractAndSaveSessionMemories(deps);

    expect(result).toEqual([]);
    expect(memoryManager.store).not.toHaveBeenCalled();
  });

  // 4. Handles LLM returning invalid JSON gracefully
  it('handles LLM returning invalid JSON gracefully', async () => {
    const provider = createMockProvider('this is not valid json at all');
    const deps: ExtractionDeps = {
      llm: provider,
      memoryManager,
      conversationHistory: buildHistory(3),
      workspaceRoot: '/workspace',
    };

    const result = await extractAndSaveSessionMemories(deps);

    expect(result).toEqual([]);
    expect(memoryManager.store).not.toHaveBeenCalled();
  });

  // 5. Handles LLM network error gracefully
  it('handles LLM network error gracefully', async () => {
    const provider = createMockProvider('');
    (provider.complete as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network timeout'),
    );
    const deps: ExtractionDeps = {
      llm: provider,
      memoryManager,
      conversationHistory: buildHistory(3),
      workspaceRoot: '/workspace',
    };

    const result = await extractAndSaveSessionMemories(deps);

    expect(result).toEqual([]);
    expect(memoryManager.store).not.toHaveBeenCalled();
  });

  // 6. Continues saving other memories when one store fails
  it('continues saving other memories when one store fails', async () => {
    const llmPayload: ExtractedMemory[] = [
      { content: 'First memory', level: 'user', tags: ['a'] },
      { content: 'Second memory (will fail)', level: 'project', tags: ['b'] },
      { content: 'Third memory', level: 'user', tags: ['c'] },
    ];
    const provider = createMockProvider(JSON.stringify(llmPayload));

    // Make the second store call reject
    let storeCallCount = 0;
    (memoryManager.store as ReturnType<typeof vi.fn>).mockImplementation(
      (content: string, level: string, tags?: string[]) => {
        storeCallCount++;
        if (storeCallCount === 2) {
          return Promise.reject(new Error('Disk full'));
        }
        return Promise.resolve({
          id: `mem-${storeCallCount}`,
          content,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          tags,
        });
      },
    );

    const deps: ExtractionDeps = {
      llm: provider,
      memoryManager,
      conversationHistory: buildHistory(3),
      workspaceRoot: '/workspace',
    };

    const result = await extractAndSaveSessionMemories(deps);

    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('First memory');
    expect(result[1].content).toBe('Third memory');
    expect(memoryManager.store).toHaveBeenCalledTimes(3);
  });

  // 7. Strips markdown code fences from LLM response
  it('strips markdown code fences from LLM response', async () => {
    const llmPayload: ExtractedMemory[] = [
      { content: 'Uses ESLint for linting', level: 'project', tags: ['tools'] },
    ];
    const wrappedResponse = '```json\n' + JSON.stringify(llmPayload) + '\n```';
    const provider = createMockProvider(wrappedResponse);

    const deps: ExtractionDeps = {
      llm: provider,
      memoryManager,
      conversationHistory: buildHistory(3),
      workspaceRoot: '/workspace',
    };

    const result = await extractAndSaveSessionMemories(deps);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Uses ESLint for linting');
    expect(result[0].level).toBe('project');
  });

  // 8. Filters out entries with invalid level values
  it('filters out entries with invalid level values', async () => {
    const llmPayload = [
      { content: 'Valid user memory', level: 'user', tags: ['ok'] },
      { content: 'Invalid level', level: 'global', tags: ['bad'] },
      { content: 'Valid project memory', level: 'project', tags: ['ok'] },
      { content: 'Missing level', tags: ['bad'] },
      { content: 'Empty level', level: '', tags: ['bad'] },
    ];
    const provider = createMockProvider(JSON.stringify(llmPayload));

    const deps: ExtractionDeps = {
      llm: provider,
      memoryManager,
      conversationHistory: buildHistory(3),
      workspaceRoot: '/workspace',
    };

    const result = await extractAndSaveSessionMemories(deps);

    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('Valid user memory');
    expect(result[0].level).toBe('user');
    expect(result[1].content).toBe('Valid project memory');
    expect(result[1].level).toBe('project');
    expect(memoryManager.store).toHaveBeenCalledTimes(2);
  });
});
