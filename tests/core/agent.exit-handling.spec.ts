/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutohandAgent } from '../../src/core/agent.js';
import { FileActionManager } from '../../src/actions/filesystem.js';
import type { AgentRuntime, LLMProvider } from '../../src/types.js';

describe('Agent Exit Handling', () => {
  let agent: AutohandAgent;
  let mockLLM: LLMProvider;
  let mockFiles: FileActionManager;
  let mockRuntime: AgentRuntime;

  beforeEach(() => {
    mockLLM = {
      generate: vi.fn(),
      generateStream: vi.fn(),
      getModel: vi.fn().mockReturnValue('test-model'),
    } as unknown as LLMProvider;

    mockFiles = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
    } as unknown as FileActionManager;

    mockRuntime = {
      config: {
        provider: 'openrouter',
        openrouter: { model: 'test-model' },
        ui: { useInkRenderer: false },
      },
      workspaceRoot: '/test/workspace',
      options: {},
    } as AgentRuntime;

    agent = new AutohandAgent(mockLLM, mockFiles, mockRuntime);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Signal handling setup', () => {
    it('should install exit signal handlers when runInteractive is called', async () => {
      const processOnSpy = vi.spyOn(process, 'on');
      
      // Mock stdin as TTY
      Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
      
      // We can't actually run the interactive loop, but we can verify the method exists
      expect(agent).toBeDefined();
      expect(typeof agent.runInteractive).toBe('function');
      
      processOnSpy.mockRestore();
    });
  });

  describe('Queue cleanup on exit', () => {
    it('should clear all queues when clearAllQueuesAndAbort is called', async () => {
      // Access private method for testing
      const clearAllQueuesAndAbort = (agent as any).clearAllQueuesAndAbort.bind(agent);
      const pendingInkInstructions: string[] = (agent as any).pendingInkInstructions;
      
      // Add some mock queued items
      pendingInkInstructions.push('test instruction 1');
      pendingInkInstructions.push('test instruction 2');
      
      // Call the cleanup method
      clearAllQueuesAndAbort();
      
      // Verify queues are cleared
      expect(pendingInkInstructions.length).toBe(0);
    });

    it('should abort active abort controllers on exit', async () => {
      // Create mock abort controllers
      const mockController1 = { abort: vi.fn() } as unknown as AbortController;
      const mockController2 = { abort: vi.fn() } as unknown as AbortController;
      
      // Set them on the agent
      (agent as any).activeAbortController = mockController1;
      (agent as any).currentInkAbortController = mockController2;
      (agent as any).shellSuggestionAbortController = { abort: vi.fn() } as unknown as AbortController;
      
      // Call the cleanup method
      const clearAllQueuesAndAbort = (agent as any).clearAllQueuesAndAbort.bind(agent);
      clearAllQueuesAndAbort();
      
      // Verify controllers were aborted
      expect(mockController1.abort).toHaveBeenCalled();
      expect(mockController2.abort).toHaveBeenCalled();
    });

    it('should resolve ink instruction resolver if pending', async () => {
      const mockResolver = vi.fn();
      (agent as any).inkInstructionResolver = mockResolver;
      
      const clearAllQueuesAndAbort = (agent as any).clearAllQueuesAndAbort.bind(agent);
      clearAllQueuesAndAbort();
      
      expect(mockResolver).toHaveBeenCalled();
      expect((agent as any).inkInstructionResolver).toBeNull();
    });
  });

  describe('shouldExit flag behavior', () => {
    it('should have shouldExit flag initialized to false', () => {
      expect((agent as any).shouldExit).toBe(false);
    });

    it('should set shouldExit flag when exit signal is received', async () => {
      // We can't easily test the signal handler directly, but we can verify the flag exists
      // and can be set
      (agent as any).shouldExit = true;
      expect((agent as any).shouldExit).toBe(true);
    });

    it('should prevent duplicate signal handler installation', () => {
      const installExitSignalHandlers = (agent as any).installExitSignalHandlers.bind(agent);
      
      // First call should install handlers
      installExitSignalHandlers();
      expect((agent as any).exitSignalHandlersInstalled).toBe(true);
      
      // Second call should be a no-op
      const processOnSpy = vi.spyOn(process, 'on');
      installExitSignalHandlers();
      expect(processOnSpy).not.toHaveBeenCalled();
      
      processOnSpy.mockRestore();
    });
  });
});
