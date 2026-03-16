/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SuggestionEngine } from '../../src/core/SuggestionEngine.js';
import type { LLMProvider } from '../../src/providers/LLMProvider.js';
import type { LLMMessage } from '../../src/types.js';

function createMockProvider(response = 'Run the test suite'): LLMProvider {
  return {
    getName: () => 'mock',
    complete: vi.fn().mockResolvedValue({
      id: 'test',
      created: Date.now(),
      content: response,
      raw: {},
    }),
    listModels: vi.fn().mockResolvedValue([]),
    isAvailable: vi.fn().mockResolvedValue(true),
    setModel: vi.fn(),
  } as unknown as LLMProvider;
}

describe('SuggestionEngine', () => {
  let engine: SuggestionEngine;
  let provider: LLMProvider;

  beforeEach(() => {
    provider = createMockProvider();
    engine = new SuggestionEngine(provider);
  });

  it('should return null before any generation', () => {
    expect(engine.getSuggestion()).toBeNull();
  });

  it('should generate a suggestion from conversation history', async () => {
    await engine.generate([
      { role: 'user', content: 'Fix the login bug' },
      { role: 'assistant', content: 'I fixed the auth validation in login.ts' },
    ]);
    expect(engine.getSuggestion()).toBe('Run the test suite');
  });

  it('should call LLM with small maxTokens and no tools', async () => {
    await engine.generate([
      { role: 'user', content: 'hello' },
    ]);
    expect(provider.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTokens: 60,
      })
    );
    // Verify tools is not passed (omitted, not explicitly undefined)
    const call = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call).not.toHaveProperty('tools');
  });

  it('should clear the suggestion', async () => {
    await engine.generate([{ role: 'user', content: 'test' }]);
    expect(engine.getSuggestion()).toBe('Run the test suite');
    engine.clear();
    expect(engine.getSuggestion()).toBeNull();
  });

  it('should cancel in-flight request', async () => {
    const slowProvider = createMockProvider();
    (slowProvider.complete as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({
        id: 'test', created: Date.now(), content: 'Late result', raw: {},
      }), 5000))
    );
    const slowEngine = new SuggestionEngine(slowProvider);
    const promise = slowEngine.generate([{ role: 'user', content: 'test' }]);
    slowEngine.cancel();
    await promise;
    expect(slowEngine.getSuggestion()).toBeNull();
  });

  it('should handle LLM errors gracefully', async () => {
    const errorProvider = createMockProvider();
    (errorProvider.complete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API down'));
    const errorEngine = new SuggestionEngine(errorProvider);
    await errorEngine.generate([{ role: 'user', content: 'test' }]);
    expect(errorEngine.getSuggestion()).toBeNull();
  });

  it('should truncate suggestions longer than 80 characters', async () => {
    const longProvider = createMockProvider(
      'This is a really long suggestion that goes way beyond eighty characters and should be truncated to fit the prompt'
    );
    const longEngine = new SuggestionEngine(longProvider);
    await longEngine.generate([{ role: 'user', content: 'test' }]);
    const suggestion = longEngine.getSuggestion();
    expect(suggestion).not.toBeNull();
    expect(suggestion!.length).toBeLessThanOrEqual(80);
  });

  it('should strip quotes and whitespace from LLM response', async () => {
    const quotedProvider = createMockProvider('"Run tests for auth module"\n');
    const quotedEngine = new SuggestionEngine(quotedProvider);
    await quotedEngine.generate([{ role: 'user', content: 'test' }]);
    expect(quotedEngine.getSuggestion()).toBe('Run tests for auth module');
  });

  it('should only send last N turns to keep prompt small', async () => {
    const longHistory = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `Message ${i}`,
    }));
    await engine.generate(longHistory);
    const call = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // System prompt + last 6 messages (3 turns)
    expect(call.messages.length).toBeLessThanOrEqual(7);
  });

  describe('allowed tools constraint', () => {
    it('should include allowed tools in the system prompt when provided', async () => {
      const constrainedEngine = new SuggestionEngine(provider, {
        allowedTools: ['read_file', 'list_files', 'web_search'],
      });
      await constrainedEngine.generate([{ role: 'user', content: 'test' }]);
      const call = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const systemMessage = call.messages[0].content;
      expect(systemMessage).toContain('read_file');
      expect(systemMessage).toContain('list_files');
      expect(systemMessage).toContain('web_search');
    });

    it('should NOT include tool constraints when no allowedTools provided', async () => {
      await engine.generate([{ role: 'user', content: 'test' }]);
      const call = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const systemMessage = call.messages[0].content;
      expect(systemMessage).not.toContain('ONLY suggest actions');
    });

    it('should include allowed tools in startup suggestions too', async () => {
      const constrainedEngine = new SuggestionEngine(provider, {
        allowedTools: ['read_file'],
      });
      await constrainedEngine.generateFromProjectContext({
        gitStatus: '## main\n M src/index.ts',
        recentFiles: ['src/index.ts'],
      });
      const call = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const systemMessage = call.messages[0].content;
      expect(systemMessage).toContain('read_file');
    });
  });

  describe('history sanitization for tool messages', () => {
    it('should strip tool-role messages from history before calling LLM', async () => {
      const history: LLMMessage[] = [
        { role: 'user', content: 'Fix the login bug' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'tc_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"login.ts"}' } }] },
        { role: 'tool', content: 'file contents here', tool_call_id: 'tc_1' },
        { role: 'assistant', content: 'I found and fixed the bug in login.ts' },
        { role: 'user', content: 'Great, what should I do next?' },
        { role: 'assistant', content: 'You should run the tests to verify the fix.' },
      ];
      await engine.generate(history);
      const call = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const roles = call.messages.map((m: LLMMessage) => m.role);
      expect(roles).not.toContain('tool');
    });

    it('should strip tool_calls from assistant messages', async () => {
      const history: LLMMessage[] = [
        { role: 'user', content: 'Read the config' },
        { role: 'assistant', content: 'Let me read that file.', tool_calls: [{ id: 'tc_1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
        { role: 'tool', content: 'config data', tool_call_id: 'tc_1' },
        { role: 'assistant', content: 'Here is your config data.' },
      ];
      await engine.generate(history);
      const call = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const nonSystemMessages = call.messages.filter((m: LLMMessage) => m.role !== 'system');
      for (const msg of nonSystemMessages) {
        expect(msg).not.toHaveProperty('tool_calls');
        expect(msg).not.toHaveProperty('tool_call_id');
      }
    });

    it('should skip assistant messages with empty content (tool-call-only turns)', async () => {
      const history: LLMMessage[] = [
        { role: 'user', content: 'Fix the bug' },
        // Assistant message with tool_calls but empty content
        { role: 'assistant', content: '', tool_calls: [{ id: 'tc_1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
        { role: 'tool', content: 'file data', tool_call_id: 'tc_1' },
        { role: 'assistant', content: 'Fixed the bug.' },
      ];
      await engine.generate(history);
      const call = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const nonSystemMessages = call.messages.filter((m: LLMMessage) => m.role !== 'system');
      // Should only have: user + assistant (with content)
      expect(nonSystemMessages.length).toBe(2);
      expect(nonSystemMessages[0]).toEqual({ role: 'user', content: 'Fix the bug' });
      expect(nonSystemMessages[1]).toEqual({ role: 'assistant', content: 'Fixed the bug.' });
    });

    it('should handle history that is entirely tool messages gracefully', async () => {
      const history: LLMMessage[] = [
        { role: 'assistant', content: '', tool_calls: [{ id: 'tc_1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
        { role: 'tool', content: 'data', tool_call_id: 'tc_1' },
        { role: 'tool', content: 'more data', tool_call_id: 'tc_2' },
      ];
      await engine.generate(history);
      // With no usable messages, the LLM gets only the system prompt
      const call = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const nonSystemMessages = call.messages.filter((m: LLMMessage) => m.role !== 'system');
      expect(nonSystemMessages.length).toBe(0);
    });

    it('should strip internal metadata (priority, metadata) from messages', async () => {
      const history: LLMMessage[] = [
        { role: 'user', content: 'Do something', priority: 'high' as any, metadata: { compressed: true } as any },
        { role: 'assistant', content: 'Done.' },
      ];
      await engine.generate(history);
      const call = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const nonSystemMessages = call.messages.filter((m: LLMMessage) => m.role !== 'system');
      for (const msg of nonSystemMessages) {
        expect(msg).not.toHaveProperty('priority');
        expect(msg).not.toHaveProperty('metadata');
      }
    });

    it('should truncate long message content to keep suggestion prompt small', async () => {
      const longContent = 'A'.repeat(2000);
      const history: LLMMessage[] = [
        { role: 'user', content: 'Analyze the codebase' },
        { role: 'assistant', content: longContent },
      ];
      await engine.generate(history);
      const call = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const assistantMsg = call.messages.find((m: LLMMessage) => m.role === 'assistant');
      // Content should be truncated to a reasonable size, not the full 2000 chars
      expect(assistantMsg.content.length).toBeLessThan(600);
      expect(assistantMsg.content).toContain('…');
    });

    it('should not truncate short messages', async () => {
      const history: LLMMessage[] = [
        { role: 'user', content: 'Fix the login bug' },
        { role: 'assistant', content: 'I fixed the auth validation.' },
      ];
      await engine.generate(history);
      const call = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const assistantMsg = call.messages.find((m: LLMMessage) => m.role === 'assistant');
      expect(assistantMsg.content).toBe('I fixed the auth validation.');
    });

    it('should apply MAX_HISTORY_MESSAGES limit after filtering tool messages', async () => {
      // Create 20 messages with tool calls interspersed
      const history: LLMMessage[] = [];
      for (let i = 0; i < 10; i++) {
        history.push({ role: 'user', content: `Question ${i}` });
        history.push({ role: 'assistant', content: '', tool_calls: [{ id: `tc_${i}`, type: 'function', function: { name: 'read_file', arguments: '{}' } }] });
        history.push({ role: 'tool', content: `result ${i}`, tool_call_id: `tc_${i}` });
        history.push({ role: 'assistant', content: `Answer ${i}` });
      }
      await engine.generate(history);
      const call = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const nonSystemMessages = call.messages.filter((m: LLMMessage) => m.role !== 'system');
      // After filtering: 10 user + 10 assistant = 20 clean messages, sliced to last 6
      expect(nonSystemMessages.length).toBeLessThanOrEqual(6);
    });
  });

  describe('permission-aware tool filtering', () => {
    it('should exclude blacklisted tools from suggestion constraint', async () => {
      // Simulate the agent's filtering logic: start with all tools,
      // remove fully-blacklisted ones, pass the rest to SuggestionEngine.
      const allTools = ['read_file', 'write_file', 'run_command', 'delete_path', 'search'];
      const blacklist = ['delete_path', 'run_command:rm -rf *']; // delete_path = full block, run_command = pattern only
      const fullyBlocked = new Set(
        blacklist.filter(e => !e.includes(':')).map(e => e.trim())
      );
      const filtered = allTools.filter(name => !fullyBlocked.has(name));

      // delete_path should be removed (fully blocked)
      expect(filtered).not.toContain('delete_path');
      // run_command should remain (only pattern-blocked, not fully blocked)
      expect(filtered).toContain('run_command');
      expect(filtered).toContain('read_file');

      const constrainedEngine = new SuggestionEngine(provider, { allowedTools: filtered });
      await constrainedEngine.generate([{ role: 'user', content: 'test' }]);
      const call = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const systemMessage = call.messages[0].content;
      expect(systemMessage).toContain('run_command');
      expect(systemMessage).not.toContain('delete_path');
    });

    it('should restrict to read-only tools in restricted permission mode', async () => {
      // In restricted mode, only read/git_read/meta categories are allowed
      const readOnlyTools = ['read_file', 'search', 'git_status'];
      const constrainedEngine = new SuggestionEngine(provider, { allowedTools: readOnlyTools });
      await constrainedEngine.generate([{ role: 'user', content: 'test' }]);
      const call = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const systemMessage = call.messages[0].content;
      expect(systemMessage).toContain('read_file');
      expect(systemMessage).toContain('search');
      expect(systemMessage).not.toContain('write_file');
      expect(systemMessage).not.toContain('delete_path');
    });
  });

  describe('generateFromProjectContext', () => {
    it('should generate a suggestion from git status and recent files', async () => {
      const contextProvider = createMockProvider('Review the 3 uncommitted files');
      const contextEngine = new SuggestionEngine(contextProvider);
      await contextEngine.generateFromProjectContext({
        gitStatus: '## main\n M src/index.ts\n M src/config.ts\n?? new-file.ts',
        recentFiles: ['src/index.ts', 'src/config.ts', 'package.json'],
      });
      expect(contextEngine.getSuggestion()).toBe('Review the 3 uncommitted files');
    });

    it('should include recent commits in the LLM prompt', async () => {
      await engine.generateFromProjectContext({
        gitStatus: '## main',
        recentCommits: 'abc1234 feat: add auth module\ndef5678 fix: login redirect',
        recentFiles: ['src/auth.ts'],
      });
      const call = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const userMessage = call.messages[1].content;
      expect(userMessage).toContain('Recent commits:');
      expect(userMessage).toContain('feat: add auth module');
    });

    it('should return null when no project context is available', async () => {
      await engine.generateFromProjectContext({
        recentFiles: [],
      });
      expect(engine.getSuggestion()).toBeNull();
      // Should not call LLM when there is no context
      expect(provider.complete).not.toHaveBeenCalled();
    });

    it('should use startup-specific system prompt', async () => {
      await engine.generateFromProjectContext({
        gitStatus: '## main\n M src/index.ts',
        recentFiles: ['src/index.ts'],
      });
      const call = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const systemMessage = call.messages[0].content;
      expect(systemMessage).toContain('project context');
      expect(systemMessage).not.toContain('recent conversation');
    });

    it('should handle LLM errors gracefully', async () => {
      const errorProvider = createMockProvider();
      (errorProvider.complete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API down'));
      const errorEngine = new SuggestionEngine(errorProvider);
      await errorEngine.generateFromProjectContext({
        gitStatus: '## main',
        recentFiles: ['src/index.ts'],
      });
      expect(errorEngine.getSuggestion()).toBeNull();
    });
  });

  describe('lazy provider pattern (late-arriving suggestions)', () => {
    it('getSuggestion returns null while LLM is still pending', async () => {
      let resolveComplete!: (value: any) => void;
      const slowProvider = {
        ...createMockProvider(),
        complete: vi.fn().mockImplementation(
          () => new Promise((resolve) => { resolveComplete = resolve; })
        ),
      } as unknown as LLMProvider;

      const slowEngine = new SuggestionEngine(slowProvider);
      const pending = slowEngine.generate([
        { role: 'user', content: 'help me' },
        { role: 'assistant', content: 'I helped' },
      ]);

      // LLM hasn't responded yet — provider should return null
      expect(slowEngine.getSuggestion()).toBeNull();

      // Resolve the LLM call
      resolveComplete({ content: 'Run the tests', raw: {} });
      await pending;

      // Now the provider should return the suggestion
      expect(slowEngine.getSuggestion()).toBe('Run the tests');
    });

    it('getSuggestion stays valid across multiple reads without clear', async () => {
      await engine.generate([{ role: 'user', content: 'test' }]);
      // Multiple reads should return the same value (no auto-clear)
      expect(engine.getSuggestion()).toBe('Run the test suite');
      expect(engine.getSuggestion()).toBe('Run the test suite');
      expect(engine.getSuggestion()).toBe('Run the test suite');
    });

    it('new generate() clears stale suggestion before LLM responds', async () => {
      // First generation completes
      await engine.generate([{ role: 'user', content: 'first' }]);
      expect(engine.getSuggestion()).toBe('Run the test suite');

      // Second generation starts (slow LLM)
      let resolveSecond!: (value: any) => void;
      const slowProvider = {
        ...createMockProvider(),
        complete: vi.fn().mockImplementation(
          () => new Promise((resolve) => { resolveSecond = resolve; })
        ),
      } as unknown as LLMProvider;
      const engine2 = new SuggestionEngine(slowProvider);

      // Pre-populate with a suggestion
      (engine2 as any).suggestion = 'Stale suggestion';
      expect(engine2.getSuggestion()).toBe('Stale suggestion');

      // Start new generation — should clear the stale suggestion immediately
      const pending = engine2.generate([{ role: 'user', content: 'second' }]);
      expect(engine2.getSuggestion()).toBeNull();

      // LLM responds with new suggestion
      resolveSecond({ content: 'Fresh suggestion', raw: {} });
      await pending;
      expect(engine2.getSuggestion()).toBe('Fresh suggestion');
    });
  });
});
