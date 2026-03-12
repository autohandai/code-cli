/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SuggestionEngine } from '../../src/core/SuggestionEngine.js';
import type { LLMProvider } from '../../src/providers/LLMProvider.js';

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
});
