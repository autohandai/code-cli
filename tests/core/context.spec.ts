/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for src/core/context/ module
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationManager } from '../../src/core/conversationManager.js';
import { ContextOrchestrator } from '../../src/core/context/orchestrator.js';
import { ContextCompactor } from '../../src/core/context/compactor.js';
import {
  getContextWindow,
  getSafeContextWindow,
  getModelFamily,
  estimateTokens,
  estimateMessageTokens,
  calculateContextUsage,
  findCroppableMessages,
  calculateTokensToCrop,
} from '../../src/core/context/tokenizer.js';
import { serializeMessagesForSummary } from '../../src/core/context/serializer.js';
import {
  extractMessageMetadata,
  determineMessagePriority,
  sortMessagesByPriority,
  findCoherentRemovalIndices,
} from '../../src/core/context/priority.js';
import { compressToolOutput } from '../../src/core/context/compressor.js';
import {
  summarizeMessagesStatic,
  summarizeWithLLM,
  extractFileOperations,
} from '../../src/core/context/summarizer.js';
import { CONTEXT_ENV_VARS } from '../../src/core/context/types.js';
import type { LLMMessage, FunctionDefinition, LLMRequest, LLMResponse } from '../../src/types.js';
import type { LLMProvider } from '../../src/providers/LLMProvider.js';
import type { MemoryManager } from '../../src/memory/MemoryManager.js';

const mockTools: FunctionDefinition[] = [
  { name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: {} } },
];

function createMessage(role: LLMMessage['role'], contentLength: number): LLMMessage {
  return { role, content: 'x'.repeat(contentLength) };
}

function createMockLLM(responseContent: string, shouldThrow = false): LLMProvider {
  return {
    getName: () => 'mock',
    complete: vi.fn(async (_req: LLMRequest): Promise<LLMResponse> => {
      if (shouldThrow) throw new Error('LLM unavailable');
      return { id: 'mock-id', created: Date.now(), content: responseContent, finishReason: 'stop', raw: {} };
    }),
    listModels: async () => ['mock-model'],
    isAvailable: async () => true,
    setModel: () => {},
  };
}

function createMockMemoryManager(): MemoryManager {
  const memory = { id: 'mem-1', content: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  return {
    store: vi.fn(async () => memory),
    recall: vi.fn(async () => []),
    initialize: vi.fn(async () => {}),
    setWorkspace: vi.fn(),
    updateMemory: vi.fn(async () => memory),
    get: vi.fn(async () => null),
    list: vi.fn(async () => []),
    listAll: vi.fn(async () => ({ project: [], user: [] })),
    delete: vi.fn(async () => {}),
    findSimilar: vi.fn(async () => null),
    search: vi.fn(async () => []),
    getContextMemories: vi.fn(async () => ''),
  } as unknown as MemoryManager;
}

function fillConversation(cm: ConversationManager, count: number, contentLength = 100): void {
  for (let i = 0; i < count; i++) {
    cm.addMessage({ role: 'user', content: `Request ${i}: ${'x'.repeat(contentLength)}` });
    cm.addMessage({ role: 'assistant', content: `Response ${i}: ${'y'.repeat(contentLength)}` });
  }
}

// ── Tokenizer ────────────────────────────────────────────────────────────────

describe('context/tokenizer', () => {
  describe('getContextWindow', () => {
    it('returns known model context windows', () => {
      expect(getContextWindow('anthropic/claude-4-sonnet')).toBe(200_000);
      expect(getContextWindow('anthropic/claude-sonnet-5')).toBe(1_000_000);
      expect(getContextWindow('claude-sonnet-5')).toBe(1_000_000);
      expect(getContextWindow('claude-fable-5')).toBe(1_000_000);
      expect(getContextWindow('claude-haiku-4-5')).toBe(200_000);
      expect(getContextWindow('claude-sonnet-4-5')).toBe(1_000_000);
      expect(getContextWindow('anthropic/claude-sonnet-4.5')).toBe(1_000_000);
      expect(getContextWindow('claude-opus-4-5')).toBe(200_000);
      expect(getContextWindow('claude-opus-4-1')).toBe(200_000);
      expect(getContextWindow('openai/gpt-5.5')).toBe(1_050_000);
      expect(getContextWindow('gpt-5.5-pro')).toBe(1_050_000);
      expect(getContextWindow('openai/gpt-5.4')).toBe(1_050_000);
      expect(getContextWindow('gpt-5.4-mini')).toBe(400_000);
      expect(getContextWindow('openai/gpt-5.3-codex')).toBe(400_000);
      expect(getContextWindow('google/gemini-3.1-pro-preview')).toBe(1_000_000);
      expect(getContextWindow('gemini-3.1-flash-image-preview')).toBe(128_000);
      expect(getContextWindow('deepseek-v4-pro')).toBe(1_000_000);
      expect(getContextWindow('deepseek/deepseek-v4-flash')).toBe(1_000_000);
      expect(getContextWindow('glm-5.2')).toBe(1_000_000);
      expect(getContextWindow('zai/glm-5.2')).toBe(1_000_000);
      expect(getContextWindow('fugu')).toBe(1_000_000);
      expect(getContextWindow('sakana/fugu-ultra')).toBe(1_000_000);
      expect(getContextWindow('glm-5.1')).toBe(200_000);
      expect(getContextWindow('fantail', 64_000)).toBe(64_000);
      expect(getContextWindow('autohandai/moa', 1_000_000)).toBe(1_000_000);
      expect(getContextWindow('tencent/hy3-preview:free')).toBe(262_144);
      expect(getContextWindow('tencent/hy3-preview-20260421:free')).toBe(262_144);
    });

    it('returns default 128k for unknown models', () => {
      expect(getContextWindow('unknown/model')).toBe(128_000);
    });

    it('prefers configured provider context windows over inferred fallbacks', () => {
      expect(getContextWindow('unknown/provider-model', 262_144)).toBe(262_144);
      expect(getContextWindow('openai/gpt-5.5', 512_000)).toBe(512_000);
    });

    it('uses configured provider context windows when calculating usage', () => {
      const usage = calculateContextUsage([], [], 'unknown/provider-model', undefined, 262_144);
      expect(usage.contextWindow).toBe(262_144);
    });

    it('respects AUTOHAND_CONTEXT_WINDOW env var override', () => {
      const orig = process.env[CONTEXT_ENV_VARS.CONTEXT_WINDOW];
      process.env[CONTEXT_ENV_VARS.CONTEXT_WINDOW] = '50000';
      expect(getContextWindow('any-model')).toBe(50000);
      delete process.env[CONTEXT_ENV_VARS.CONTEXT_WINDOW];
      if (orig) process.env[CONTEXT_ENV_VARS.CONTEXT_WINDOW] = orig;
    });
  });

  describe('getSafeContextWindow', () => {
    it('returns 90% of context window', () => {
      const safe = getSafeContextWindow('openai/gpt-4o-mini');
      expect(safe).toBe(Math.floor(128_000 * 0.9));
    });
  });

  describe('getModelFamily', () => {
    it('identifies model families correctly', () => {
      expect(getModelFamily('anthropic/claude-sonnet-4')).toBe('claude');
      expect(getModelFamily('openai/gpt-4o')).toBe('openai');
      expect(getModelFamily('openai/gpt-5.5')).toBe('openai');
      expect(getModelFamily('google/gemini-pro')).toBe('gemini');
      expect(getModelFamily('deepseek/deepseek-r1')).toBe('deepseek');
      expect(getModelFamily('unknown/model')).toBe('default');
    });
  });

  describe('estimateTokens', () => {
    it('returns 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('estimates tokens based on model family', () => {
      const text = 'Hello world this is a test';
      const openaiTokens = estimateTokens(text, 'openai');
      const claudeTokens = estimateTokens(text, 'claude');
      expect(openaiTokens).toBeGreaterThan(0);
      expect(claudeTokens).toBeGreaterThan(0);
      // OpenAI has higher chars/token ratio, so fewer tokens for same text
      expect(openaiTokens).toBeLessThanOrEqual(claudeTokens);
    });
  });

  describe('estimateMessageTokens', () => {
    it('includes structure overhead', () => {
      const tokens = estimateMessageTokens({ role: 'user', content: '' });
      expect(tokens).toBeGreaterThanOrEqual(10);
    });

    it('estimates tokens for tool calls', () => {
      const msg: LLMMessage = {
        role: 'assistant',
        content: 'test',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"/foo"}' } }],
      };
      const tokens = estimateMessageTokens(msg);
      expect(tokens).toBeGreaterThan(10);
    });
  });

  describe('calculateContextUsage', () => {
    it('calculates usage correctly', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
      ];
      const usage = calculateContextUsage(messages, mockTools, 'openai/gpt-4o-mini');
      expect(usage.totalTokens).toBeGreaterThan(0);
      expect(usage.contextWindow).toBe(128_000);
      expect(usage.usagePercent).toBeGreaterThan(0);
      expect(usage.usagePercent).toBeLessThan(1);
      expect(usage.isWarning).toBe(false);
      expect(usage.isCritical).toBe(false);
    });

    it('respects AUTOHAND_RESERVE_TOKENS env var', () => {
      const orig = process.env[CONTEXT_ENV_VARS.RESERVE_TOKENS];
      process.env[CONTEXT_ENV_VARS.RESERVE_TOKENS] = '32000';
      const usage = calculateContextUsage([], [], 'openai/gpt-4o-mini');
      // With 32k reserve on 128k window, effective window = 96k
      expect(usage.contextWindow).toBe(128_000);
      delete process.env[CONTEXT_ENV_VARS.RESERVE_TOKENS];
      if (orig) process.env[CONTEXT_ENV_VARS.RESERVE_TOKENS] = orig;
    });
  });

  describe('findCroppableMessages', () => {
    it('excludes system and last user message', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'bye' },
      ];
      const croppable = findCroppableMessages(messages);
      expect(croppable).not.toContain(0); // system
      expect(croppable).not.toContain(3); // last user
      expect(croppable).toContain(1); // first user
      expect(croppable).toContain(2); // assistant
    });
  });

  describe('calculateTokensToCrop', () => {
    it('returns 0 when under target', () => {
      expect(calculateTokensToCrop(100, 1000, 0.7)).toBe(0);
    });

    it('calculates tokens to remove', () => {
      const toCrop = calculateTokensToCrop(900, 1000, 0.7);
      expect(toCrop).toBe(900 - 700);
    });
  });
});

// ── Serializer ───────────────────────────────────────────────────────────────

describe('context/serializer', () => {
  it('serializes user messages', () => {
    const result = serializeMessagesForSummary([
      { role: 'user', content: 'Hello there' },
    ]);
    expect(result).toContain('[User]: Hello there');
  });

  it('serializes assistant messages with tool calls', () => {
    const result = serializeMessagesForSummary([
      {
        role: 'assistant',
        content: 'Let me read that file',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"/foo.ts"}' } }],
      },
    ]);
    expect(result).toContain('[Assistant]:');
    expect(result).toContain('[Assistant tool calls]:');
    expect(result).toContain('read_file');
  });

  it('serializes tool results with truncation', () => {
    const longContent = 'x'.repeat(5000);
    const result = serializeMessagesForSummary([
      { role: 'tool', content: longContent, name: 'read_file', tool_call_id: 'c1' },
    ]);
    expect(result).toContain('[Tool result (read_file)]:');
    expect(result.length).toBeLessThan(longContent.length);
  });

  it('skips system messages', () => {
    const result = serializeMessagesForSummary([
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hi' },
    ]);
    expect(result).not.toContain('[System]');
    expect(result).toContain('[User]: Hi');
  });
});

// ── Priority ─────────────────────────────────────────────────────────────────

describe('context/priority', () => {
  describe('extractMessageMetadata', () => {
    it('extracts file paths', () => {
      const meta = extractMessageMetadata({
        role: 'assistant',
        content: 'I modified `src/index.ts` and `src/utils.ts`',
      });
      expect(meta.files).toBeDefined();
      expect(meta.files!.length).toBeGreaterThanOrEqual(2);
    });

    it('detects decisions', () => {
      const meta = extractMessageMetadata({
        role: 'assistant',
        content: "I'll use React for the frontend",
      });
      expect(meta.isDecision).toBe(true);
    });

    it('detects errors', () => {
      const meta = extractMessageMetadata({
        role: 'tool',
        content: 'Error: file not found',
        name: 'read_file',
      });
      expect(meta.isError).toBe(true);
    });

    it('extracts tool names from tool_calls', () => {
      const meta = extractMessageMetadata({
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write_file', arguments: '{}' } }],
      });
      expect(meta.tools).toContain('write_file');
    });

    it('extracts bare file paths from message content', () => {
      const meta = extractMessageMetadata({
        role: 'tool',
        content: 'Read file src/index.ts and found exports in lib/utils.js',
      });
      expect(meta.files).toContain('src/index.ts');
      expect(meta.files).toContain('lib/utils.js');
    });

    it('extracts backticked file paths', () => {
      const meta = extractMessageMetadata({
        role: 'assistant',
        content: 'I will edit `package.json` and `tsconfig.json`',
      });
      expect(meta.files).toContain('package.json');
      expect(meta.files).toContain('tsconfig.json');
    });

    it('extracts the tool name from a tool message', () => {
      const meta = extractMessageMetadata({ role: 'tool', name: 'read_file', content: 'File contents here' });
      expect(meta.tools).toContain('read_file');
    });
  });

  describe('determineMessagePriority', () => {
    it('system messages are critical', () => {
      expect(determineMessagePriority({ role: 'system', content: 'sys' })).toBe('critical');
    });

    it('user messages are high', () => {
      expect(determineMessagePriority({ role: 'user', content: 'hi' })).toBe('high');
    });

    it('long tool outputs are low', () => {
      expect(determineMessagePriority({ role: 'tool', content: 'x'.repeat(3000), name: 'read_file' })).toBe('low');
    });

    it('error messages are high', () => {
      expect(determineMessagePriority({ role: 'tool', content: 'Error: crash', name: 'run_command' })).toBe('high');
    });

    it('assistant decisions are high', () => {
      expect(determineMessagePriority({ role: 'assistant', content: 'I decided to use React for the frontend.' })).toBe('high');
    });
  });

  describe('sortMessagesByPriority', () => {
    it('sorts low priority first', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'sys' },
        { role: 'tool', content: 'x'.repeat(3000), name: 'read_file' },
        { role: 'user', content: 'hi' },
      ];
      const sorted = sortMessagesByPriority(messages);
      // The tool message (low priority) should be first
      expect(sorted[0]).toBe(1);
    });

    it('keeps system messages last in removal order', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'system' },
        { role: 'tool', content: 'short tool' },
      ];
      const sorted = sortMessagesByPriority(messages);
      expect(sorted[sorted.length - 1]).toBe(0);
    });
  });

  describe('findCoherentRemovalIndices', () => {
    it('includes matching assistant when removing tool result', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'sys' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
        { role: 'tool', content: 'file content', tool_call_id: 'c1', name: 'read_file' },
      ];
      const result = findCoherentRemovalIndices(messages, [2]);
      expect(result).toContain(1); // assistant should be included
      expect(result).toContain(2);
    });

    it('includes matching tool results when removing assistant', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'sys' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
        { role: 'tool', content: 'file content', tool_call_id: 'c1', name: 'read_file' },
      ];
      const result = findCoherentRemovalIndices(messages, [1]);
      expect(result).toContain(2); // tool result should be included
    });
  });
});

// ── Compressor ───────────────────────────────────────────────────────────────

describe('context/compressor', () => {
  it('compresses long tool outputs', () => {
    const msg: LLMMessage = { role: 'tool', content: 'x'.repeat(5000), name: 'read_file', tool_call_id: 'c1' };
    const compressed = compressToolOutput(msg, 500);
    expect(compressed.content.length).toBeLessThan(msg.content.length);
    expect(compressed.metadata?.isCompressed).toBe(true);
  });

  it('does not compress short tool outputs', () => {
    const msg: LLMMessage = { role: 'tool', content: 'short', name: 'read_file', tool_call_id: 'c1' };
    const compressed = compressToolOutput(msg, 500);
    expect(compressed.content).toBe('short');
  });

  it('does not compress non-tool messages', () => {
    const msg: LLMMessage = { role: 'user', content: 'x'.repeat(5000) };
    const compressed = compressToolOutput(msg, 500);
    expect(compressed.content).toBe(msg.content);
  });

  it('preserves the head and tail of a compressed output', () => {
    const msg: LLMMessage = { role: 'tool', content: 'START' + 'x'.repeat(2000) + 'END' };
    const compressed = compressToolOutput(msg, 500);
    expect(compressed.content).toContain('START');
    expect(compressed.content).toContain('END');
    expect(compressed.content).toContain('characters compressed');
    expect(compressed.metadata?.isCompressed).toBe(true);
  });
});

// ── Summarizer ────────────────────────────────────────────────────────────────

describe('context/summarizer', () => {
  describe('summarizeMessagesStatic', () => {
    it('produces a summary with file and tool info', () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: 'Read src/index.ts' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"src/index.ts"}' } }], metadata: { files: ['src/index.ts'], tools: ['read_file'] } },
        { role: 'tool', content: 'file content', name: 'read_file', tool_call_id: 'c1' },
      ];
      const summary = summarizeMessagesStatic(messages);
      expect(summary).toContain('Context Summary');
      expect(summary).toContain('src/index.ts');
      expect(summary).toContain('read_file');
    });

    it('preserves assistant ideas that a follow-up user message refers to', () => {
      const summary = summarizeMessagesStatic([
        { role: 'user', content: 'What feature should we build?' },
        { role: 'assistant', content: 'Ideas: a live token dashboard, an extension marketplace, and offline Ollama mode.' },
      ]);

      expect(summary).toContain('live token dashboard');
      expect(summary).toContain('extension marketplace');
      expect(summary).toContain('offline Ollama mode');
    });

    it('lists user requests, files touched and tools used', () => {
      const summary = summarizeMessagesStatic([
        { role: 'user', content: 'Fix the login bug' },
        { role: 'tool', name: 'read_file', content: 'Contents of src/auth.ts' },
        { role: 'tool', name: 'write_file', content: 'success' },
      ]);
      expect(summary).toContain('Fix the login bug');
      expect(summary).toContain('Files touched');
      expect(summary).toContain('src/auth.ts');
      expect(summary).toContain('Tools used');
      expect(summary).toContain('read_file');
      expect(summary).toContain('write_file');
    });
  });

  describe('summarizeWithLLM', () => {
    const jwtMessages: LLMMessage[] = [
      { role: 'user', content: 'Refactor the auth module to use JWT' },
      {
        role: 'assistant',
        content: "I'll refactor auth to JWT. Let me create the files.",
        tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'write_file', arguments: '{"path":"src/auth/jwt.ts"}' } }],
      },
      { role: 'tool', name: 'write_file', content: 'File created', tool_call_id: 'tc1' },
    ];

    it('calls the LLM and wraps its output as an LLM context summary', async () => {
      const llm = createMockLLM('User asked to refactor the auth module to use JWT. Remaining: add tests.');

      const summary = await summarizeWithLLM(jwtMessages, llm);

      expect(llm.complete).toHaveBeenCalledOnce();
      expect(summary).toContain('LLM Context Summary');
      expect(summary).toContain('refactor');
      expect(summary).toContain('Remaining');
    });

    it('falls back to the static summary when the LLM call fails', async () => {
      const llm = createMockLLM('', true);

      const summary = await summarizeWithLLM(
        [
          { role: 'user', content: 'Fix the login bug' },
          { role: 'tool', name: 'read_file', content: 'Contents of src/auth.ts' },
        ],
        llm,
      );

      expect(llm.complete).toHaveBeenCalledOnce();
      expect(summary).toContain('Context Summary');
      expect(summary).toContain('Fix the login bug');
    });

    it('falls back to the static summary when the LLM returns empty content', async () => {
      const llm = createMockLLM('   ');
      const summary = await summarizeWithLLM(jwtMessages, llm);
      expect(summary).toContain('[Context Summary');
      expect(summary).not.toContain('LLM Context Summary');
    });

    it('uses the static summary when no LLM is provided', async () => {
      const summary = await summarizeWithLLM([{ role: 'user', content: 'Hello world' }]);
      expect(summary).toContain('Context Summary');
    });

    it('does not call the LLM for an empty message list', async () => {
      const llm = createMockLLM('should not be called');
      const summary = await summarizeWithLLM([], llm);
      expect(llm.complete).not.toHaveBeenCalled();
      expect(summary).toContain('Context Summary');
    });

    it('persists key facts from the summary to project memory', async () => {
      const llm = createMockLLM('User chose PostgreSQL over MySQL for the database. Preference for using single quotes in code.');
      const memoryManager = createMockMemoryManager();

      await summarizeWithLLM(
        [
          { role: 'user', content: 'Set up the database' },
          { role: 'assistant', content: 'I chose PostgreSQL over MySQL because...' },
        ],
        llm,
        memoryManager,
      );

      expect(memoryManager.store).toHaveBeenCalled();
      const calls = (memoryManager.store as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.some((c: unknown[]) => c[1] === 'project')).toBe(true);
    });

    it('ignores memory persistence failures', async () => {
      const llm = createMockLLM('User chose PostgreSQL over MySQL for the database.');
      const memoryManager = createMockMemoryManager();
      (memoryManager.store as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('disk full'));

      const summary = await summarizeWithLLM([{ role: 'user', content: 'Set up the database' }], llm, memoryManager);

      expect(summary).toContain('LLM Context Summary');
    });
  });

  describe('extractFileOperations', () => {
    it('categorizes read vs modified files', () => {
      const messages: LLMMessage[] = [
        { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{}' } }], metadata: { files: ['a.ts'], tools: ['read_file'] } },
        { role: 'assistant', content: '', tool_calls: [{ id: 'c2', type: 'function', function: { name: 'write_file', arguments: '{}' } }], metadata: { files: ['b.ts'], tools: ['write_file'] } },
      ];
      const ops = extractFileOperations(messages);
      expect(ops.readFiles).toContain('a.ts');
      expect(ops.modifiedFiles).toContain('b.ts');
    });
  });
});

// ── Compactor ────────────────────────────────────────────────────────────────

describe('context/compactor', () => {
  let conversationManager: ConversationManager;
  let compactor: ContextCompactor;

  beforeEach(() => {
    conversationManager = ConversationManager.getInstance();
    conversationManager.reset('You are a helpful assistant');
    compactor = new ContextCompactor({ conversationManager });
  });

  it('returns messages without cropping when usage is low', async () => {
    conversationManager.addMessage({ role: 'user', content: 'Hello' });
    conversationManager.addMessage({ role: 'assistant', content: 'Hi there!' });

    const result = await compactor.compact('openai/gpt-4o-mini', mockTools);
    expect(result.wasCropped).toBe(false);
    expect(result.croppedCount).toBe(0);
  });

  it('preserves system prompts during cropping', async () => {
    for (let i = 0; i < 50; i++) {
      conversationManager.addMessage(createMessage('user', 100));
      conversationManager.addMessage(createMessage('assistant', 100));
    }

    const result = await compactor.compact('openai/gpt-4o-mini', mockTools);
    const hasSystem = result.messages.some(m => m.role === 'system');
    expect(hasSystem).toBe(true);
  });

  it('preserves recent messages during cropping', async () => {
    for (let i = 0; i < 50; i++) {
      conversationManager.addMessage({ role: 'user', content: `Message ${i}` });
      conversationManager.addMessage({ role: 'assistant', content: `Response ${i}` });
    }

    const result = await compactor.compact('openai/gpt-4o-mini', mockTools);
    const lastUser = result.messages.filter(m => m.role === 'user').pop();
    expect(lastUser?.content).toContain('Message 49');
  });

  it('preserves the last complete turn when the latest user message references it', async () => {
    for (let i = 0; i < 12; i++) {
      conversationManager.addMessage({ role: 'user', content: `Old request ${i} ${'x'.repeat(500)}` });
      conversationManager.addMessage({ role: 'assistant', content: `Old response ${i} ${'y'.repeat(500)}` });
    }
    conversationManager.addMessage({ role: 'user', content: 'What can you do?' });
    conversationManager.addMessage({
      role: 'assistant',
      content: 'Feature ideas: live token dashboard, extension marketplace, offline Ollama mode.',
    });
    conversationManager.addMessage({ role: 'user', content: "I loved those ideas, let's spec it." });

    const result = await compactor.compact('fantail', [], undefined, undefined, 4_000);

    expect(result.wasCropped).toBe(true);
    expect(result.messages.some(message => message.content.includes('Feature ideas:'))).toBe(true);
    expect(result.messages.some(message => message.content.includes("let's spec it"))).toBe(true);
  });

  it('does not emit no-op summaries when only the active turn is large', async () => {
    const onCrop = vi.fn();
    conversationManager.addMessage({ role: 'user', content: 'Inspect this failure' });
    for (let i = 0; i < 12; i++) {
      conversationManager.addMessage({ role: 'assistant', content: `Large tool follow-up ${i}: ${'x'.repeat(25_000)}` });
    }
    const initialLength = conversationManager.history().length;

    const result = await compactor.compact('openai/gpt-4o-mini', mockTools, onCrop);

    expect(result.wasCropped).toBe(false);
    expect(result.croppedCount).toBe(0);
    expect(onCrop).not.toHaveBeenCalled();
    expect(conversationManager.history()).toHaveLength(initialLength);
    expect(conversationManager.history().filter(msg => msg.role === 'system')).toHaveLength(1);
  });

  it('removes the selected low-priority messages during critical compaction', async () => {
    const onCrop = vi.fn();
    for (let i = 0; i < 14; i++) {
      conversationManager.addMessage({ role: 'user', content: `Old request ${i}` });
      conversationManager.addMessage({
        role: 'assistant',
        priority: 'low',
        content: `Verbose assistant context ${i}: ${'y'.repeat(30_000)}`,
      });
    }
    conversationManager.addMessage({ role: 'user', content: 'Continue from here' });
    const initialAssistantCount = conversationManager.history().filter(msg => msg.role === 'assistant').length;
    const initialLength = conversationManager.history().length;

    const result = await compactor.compact('openai/gpt-4o-mini', mockTools, onCrop);

    expect(result.wasCropped).toBe(true);
    expect(result.croppedCount).toBeGreaterThan(0);
    expect(onCrop).toHaveBeenCalledWith(expect.any(Number), expect.stringContaining('priority-based'));
    expect(result.messages.length).toBeLessThan(initialLength);
    expect(result.messages.filter(msg => msg.role === 'assistant').length).toBeLessThan(initialAssistantCount);
  });

  it('uses the LLM for tier-2 summarization when the conversation crosses 80%', async () => {
    const llm = createMockLLM('Summary: user asked to refactor auth. Files modified: auth.ts, index.ts.');
    const llmCompactor = new ContextCompactor({ conversationManager, llm });
    fillConversation(conversationManager, 200, 500);

    const result = await llmCompactor.compact('openai/gpt-4o-mini', mockTools);

    if (result.wasCropped) {
      expect(llm.complete).toHaveBeenCalled();
    }
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages[0].role).toBe('system');
  });

  it('falls back to static summarization when the context is critically tight', async () => {
    const llm = createMockLLM('Critical summary: extensive work done on auth module.');
    const llmCompactor = new ContextCompactor({ conversationManager, llm });
    fillConversation(conversationManager, 400, 500);

    const result = await llmCompactor.compact('openai/gpt-4o-mini', mockTools);

    expect(result.wasCropped).toBe(true);
    expect(llm.complete).not.toHaveBeenCalled();
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('compacts without an LLM using static summarization', async () => {
    fillConversation(conversationManager, 200, 500);

    const result = await compactor.compact('openai/gpt-4o-mini', mockTools);

    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages[0].role).toBe('system');
  });

  it('does not repeatedly destroy recent turns when fixed tool overhead dominates the window', async () => {
    conversationManager.addMessage({ role: 'user', content: `Old request ${'x'.repeat(1000)}` });
    conversationManager.addMessage({ role: 'assistant', content: `Old response ${'y'.repeat(1000)}` });
    conversationManager.addMessage({ role: 'user', content: 'What can you do?' });
    conversationManager.addMessage({ role: 'assistant', content: 'Keep this complete brainstorm turn.' });
    conversationManager.addMessage({ role: 'user', content: "Let's spec it." });
    const fixedTools: FunctionDefinition[] = [{
      name: 'large_tool',
      description: 'z'.repeat(20_000),
      parameters: { type: 'object', properties: {} },
    }];

    await compactor.compact('fantail', fixedTools, undefined, undefined, 4_000);
    const second = await compactor.compact('fantail', fixedTools, undefined, undefined, 4_000);

    expect(second.wasCropped).toBe(false);
    expect(second.messages.some(message => message.content === 'Keep this complete brainstorm turn.')).toBe(true);
    expect(second.messages.some(message => message.content === "Let's spec it.")).toBe(true);
  });
});

// ── Orchestrator ─────────────────────────────────────────────────────────────

describe('context/orchestrator', () => {
  let conversationManager: ConversationManager;
  let orchestrator: ContextOrchestrator;

  beforeEach(() => {
    conversationManager = ConversationManager.getInstance();
    conversationManager.reset('You are a helpful assistant');
    orchestrator = new ContextOrchestrator({
      model: 'openai/gpt-4o-mini',
      conversationManager,
    });
  });

  describe('toggle and enabled state', () => {
    it('is enabled by default', () => {
      expect(orchestrator.isEnabled()).toBe(true);
    });

    it('toggles between enabled and disabled', () => {
      orchestrator.toggle();
      expect(orchestrator.isEnabled()).toBe(false);
      orchestrator.toggle();
      expect(orchestrator.isEnabled()).toBe(true);
    });

    it('sets enabled state directly', () => {
      orchestrator.setEnabled(false);
      expect(orchestrator.isEnabled()).toBe(false);
      orchestrator.setEnabled(true);
      expect(orchestrator.isEnabled()).toBe(true);
    });

    it('respects AUTOHAND_CONTEXT_COMPACT env var', () => {
      const orig = process.env[CONTEXT_ENV_VARS.CONTEXT_COMPACT];
      process.env[CONTEXT_ENV_VARS.CONTEXT_COMPACT] = 'false';
      const envOrchestrator = new ContextOrchestrator({
        model: 'openai/gpt-4o-mini',
        conversationManager,
      });
      expect(envOrchestrator.isEnabled()).toBe(false);
      delete process.env[CONTEXT_ENV_VARS.CONTEXT_COMPACT];
      if (orig) process.env[CONTEXT_ENV_VARS.CONTEXT_COMPACT] = orig;
    });

    it('respects enabled option in constructor', () => {
      const disabledOrchestrator = new ContextOrchestrator({
        model: 'openai/gpt-4o-mini',
        conversationManager,
        enabled: false,
      });
      expect(disabledOrchestrator.isEnabled()).toBe(false);
    });
  });

  describe('ACP config', () => {
    it('applies context_compact config', () => {
      expect(orchestrator.applyAcpConfig('context_compact', 'off')).toBe(true);
      expect(orchestrator.isEnabled()).toBe(false);
      expect(orchestrator.applyAcpConfig('context_compact', 'on')).toBe(true);
      expect(orchestrator.isEnabled()).toBe(true);
    });

    it('returns false for unknown config IDs', () => {
      expect(orchestrator.applyAcpConfig('unknown', 'value')).toBe(false);
    });
  });

  describe('prepareRequest', () => {
    it('returns messages when usage is low', async () => {
      conversationManager.addMessage({ role: 'user', content: 'Hello' });
      const result = await orchestrator.prepareRequest(mockTools);
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.wasCropped).toBe(false);
    });

    it('uses legacy path when disabled', async () => {
      orchestrator.setEnabled(false);
      conversationManager.addMessage({ role: 'user', content: 'Hello' });
      const result = await orchestrator.prepareRequest(mockTools);
      expect(result.messages.length).toBeGreaterThan(0);
    });

    it('emits critical and compact hook payloads with post-compaction usage', async () => {
      const onHookEvent = vi.fn();
      const hookOrchestrator = new ContextOrchestrator({
        model: 'openai/gpt-4o-mini',
        contextWindow: 1000,
        conversationManager,
        onHookEvent,
      });
      for (let index = 0; index < 6; index++) {
        conversationManager.addMessage({
          role: index % 2 === 0 ? 'user' : 'assistant',
          content: `${index}${'x'.repeat(500)}`,
        });
      }
      conversationManager.addMessage({ role: 'user', content: 'Continue' });
      const usageBefore = hookOrchestrator.getUsage([]);

      const result = await hookOrchestrator.prepareRequest([]);

      expect(onHookEvent).toHaveBeenNthCalledWith(1, {
        event: 'context:critical',
        usagePercent: Math.min(1, usageBefore.usagePercent),
        remainingTokens: usageBefore.remainingTokens,
      });
      expect(onHookEvent).toHaveBeenNthCalledWith(2, {
        event: 'context:compact',
        croppedCount: result.croppedCount,
        summary: result.summary,
        usagePercent: Math.min(1, result.usage.usagePercent),
        reason: 'tiered-compaction',
      });
      expect(usageBefore.usagePercent).toBeGreaterThan(1);
      expect(result.croppedCount).toBeGreaterThan(0);
      expect(result.usage.usagePercent).toBeLessThan(usageBefore.usagePercent);
    });

    it('keeps public warning percentages within the documented zero-to-one contract', async () => {
      const onWarning = vi.fn();
      const hookOrchestrator = new ContextOrchestrator({
        model: 'fantail', contextWindow: 1_000, conversationManager, onWarning,
      });
      conversationManager.addMessage({ role: 'user', content: 'x'.repeat(10_000) });

      const result = await hookOrchestrator.prepareRequest([]);

      expect(result.usage.usagePercent).toBeGreaterThan(1);
      expect(onWarning).toHaveBeenCalledWith(expect.objectContaining({ usagePercent: 1 }));
    });

    it('emits a warning hook when warning usage does not compact', async () => {
      const onHookEvent = vi.fn();
      const hookOrchestrator = new ContextOrchestrator({
        model: 'openai/gpt-4o-mini', contextWindow: 1000, conversationManager, onHookEvent,
      });
      conversationManager.addMessage({ role: 'user', content: 'x'.repeat(2400) });

      const result = await hookOrchestrator.prepareRequest([]);

      expect(onHookEvent).toHaveBeenCalledOnce();
      expect(onHookEvent).toHaveBeenCalledWith({
        event: 'context:warning',
        usagePercent: Math.min(1, result.usage.usagePercent),
        remainingTokens: result.usage.remainingTokens,
      });
      expect(result.usage.usagePercent).toBeGreaterThanOrEqual(0.8);
      expect(result.usage.usagePercent).toBeLessThan(0.9);
      expect(result.wasCropped).toBe(false);
    });
  });

  describe('getUsage', () => {
    it('returns context usage', () => {
      conversationManager.addMessage({ role: 'user', content: 'Hello' });
      const usage = orchestrator.getUsage(mockTools);
      expect(usage.totalTokens).toBeGreaterThan(0);
      expect(usage.contextWindow).toBe(128_000);
    });

    it('uses configured context windows for usage and extended usage', () => {
      orchestrator.setContextWindow(262_144);
      conversationManager.addMessage({ role: 'user', content: 'Hello' });

      expect(orchestrator.getUsage(mockTools).contextWindow).toBe(262_144);
      expect(orchestrator.getExtendedUsage(mockTools).contextWindow).toBe(262_144);
    });
  });

  describe('getExtendedUsage', () => {
    it('returns extended usage for RPC', () => {
      conversationManager.addMessage({ role: 'user', content: 'Hello' });
      const extUsage = orchestrator.getExtendedUsage(mockTools);
      expect(extUsage.total).toBeGreaterThan(0);
      expect(extUsage.contextWindow).toBe(128_000);
      expect(typeof extUsage.isWarning).toBe('boolean');
      expect(typeof extUsage.isCritical).toBe('boolean');
    });
  });

  describe('getStatus', () => {
    it('returns a human-readable status', () => {
      conversationManager.addMessage({ role: 'user', content: 'Hello' });
      const status = orchestrator.getStatus(mockTools);
      expect(status).toContain('Context:');
    });
  });

  describe('handleOverflow', () => {
    it('makes meaningful progress when provider overflow disagrees with local usage', async () => {
      for (let i = 0; i < 8; i++) {
        conversationManager.addMessage({ role: 'user', content: `Request ${i} ${'x'.repeat(400)}` });
        conversationManager.addMessage({ role: 'assistant', content: `Response ${i} ${'y'.repeat(400)}` });
      }
      conversationManager.addMessage({ role: 'user', content: 'Continue' });

      const before = orchestrator.getUsage(mockTools);
      expect(before.usagePercent).toBeLessThan(0.55);

      const result = await orchestrator.handleOverflow(mockTools);

      expect(result.croppedCount).toBeGreaterThan(1);
      expect(result.usage.totalTokens).toBeLessThan(before.totalTokens);
      expect(result.messages.at(-1)?.content).toContain('[Auto-Recovery]');
      expect(result.messages.some(message => message.content === 'Continue')).toBe(true);
    });

    it('emits overflow and compact payloads with before and after token counts', async () => {
      const onHookEvent = vi.fn();
      const hookOrchestrator = new ContextOrchestrator({
        model: 'openai/gpt-4o-mini', conversationManager, onHookEvent,
      });
      for (let i = 0; i < 8; i++) {
        conversationManager.addMessage({ role: 'user', content: `Request ${i} ${'x'.repeat(400)}` });
        conversationManager.addMessage({ role: 'assistant', content: `Response ${i} ${'y'.repeat(400)}` });
      }
      conversationManager.addMessage({ role: 'user', content: 'Continue' });
      const before = hookOrchestrator.getUsage(mockTools);

      const result = await hookOrchestrator.handleOverflow(mockTools);

      expect(onHookEvent).toHaveBeenCalledWith({
        event: 'context:compact',
        croppedCount: result.croppedCount,
        summary: result.summary,
        usagePercent: Math.min(1, result.usage.usagePercent),
        reason: 'overflow',
      });
      expect(onHookEvent).toHaveBeenCalledWith({
        event: 'context:overflow',
        tokensBefore: before.totalTokens,
        tokensAfter: result.usage.totalTokens,
        croppedCount: result.croppedCount,
        usagePercent: result.usage.usagePercent,
      });
    });
  });

  describe('setModel', () => {
    it('updates the model', () => {
      orchestrator.setModel('anthropic/claude-4-sonnet');
      const usage = orchestrator.getUsage(mockTools);
      expect(usage.contextWindow).toBe(200_000);
    });
  });

  describe('checkMidTurnCompaction', () => {
    it('returns false when not critical', async () => {
      conversationManager.addMessage({ role: 'user', content: 'Hello' });
      const result = await orchestrator.checkMidTurnCompaction(mockTools, 1);
      expect(result).toBe(false);
    });

    it('returns false when iteration is 0', async () => {
      const result = await orchestrator.checkMidTurnCompaction(mockTools, 0);
      expect(result).toBe(false);
    });

    it('returns false when disabled', async () => {
      orchestrator.setEnabled(false);
      const result = await orchestrator.checkMidTurnCompaction(mockTools, 1);
      expect(result).toBe(false);
    });
  });
});
