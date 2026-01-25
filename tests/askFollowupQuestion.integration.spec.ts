/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActionExecutor } from '../src/core/actionExecutor.js';
import type { AgentRuntime } from '../src/types.js';

// Mock the FileActionManager
const mockFileActionManager = {
  readFile: vi.fn(),
  writeFile: vi.fn(),
  appendFile: vi.fn(),
  applyPatch: vi.fn(),
  search: vi.fn().mockReturnValue([]),
  searchWithContext: vi.fn(),
  semanticSearch: vi.fn().mockReturnValue([]),
  createDirectory: vi.fn(),
  deletePath: vi.fn(),
  renamePath: vi.fn(),
  copyPath: vi.fn(),
  formatFile: vi.fn(),
  root: '/test'
};

// Mock runtime
const createMockRuntime = (overrides: Partial<AgentRuntime> = {}): AgentRuntime => ({
  workspaceRoot: '/test',
  config: {
    provider: 'openrouter',
    openrouter: { apiKey: 'test', model: 'test' },
    permissions: {}
  },
  options: {},
  ...overrides
} as AgentRuntime);

describe('ask_followup_question integration', () => {
  let mockOnAskFollowup: ReturnType<typeof vi.fn>;
  let executor: ActionExecutor;

  beforeEach(() => {
    mockOnAskFollowup = vi.fn();
    executor = new ActionExecutor({
      runtime: createMockRuntime(),
      files: mockFileActionManager as any,
      resolveWorkspacePath: (p) => `/test/${p}`,
      confirmDangerousAction: vi.fn().mockResolvedValue(true),
      onAskFollowup: mockOnAskFollowup
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('callback delegation', () => {
    it('delegates to onAskFollowup callback when provided', async () => {
      mockOnAskFollowup.mockResolvedValue('<answer>Yes</answer>');

      const result = await executor.execute({
        type: 'ask_followup_question',
        question: 'Do you want to proceed?',
        suggested_answers: ['Yes', 'No']
      });

      expect(mockOnAskFollowup).toHaveBeenCalledWith('Do you want to proceed?', ['Yes', 'No']);
      expect(result).toBe('<answer>Yes</answer>');
    });

    it('passes question without suggested answers', async () => {
      mockOnAskFollowup.mockResolvedValue('<answer>Custom response</answer>');

      const result = await executor.execute({
        type: 'ask_followup_question',
        question: 'What is your name?'
      });

      expect(mockOnAskFollowup).toHaveBeenCalledWith('What is your name?', undefined);
      expect(result).toBe('<answer>Custom response</answer>');
    });

    it('throws error when question is missing', async () => {
      await expect(executor.execute({
        type: 'ask_followup_question',
        question: ''
      } as any)).rejects.toThrow('ask_followup_question requires a "question" parameter.');
    });
  });

  describe('non-interactive mode', () => {
    it('should handle cancellation response', async () => {
      mockOnAskFollowup.mockResolvedValue('<answer>User cancelled</answer>');

      const result = await executor.execute({
        type: 'ask_followup_question',
        question: 'Continue?',
        suggested_answers: ['Yes', 'No']
      });

      expect(result).toBe('<answer>User cancelled</answer>');
    });

    it('should handle skip response', async () => {
      mockOnAskFollowup.mockResolvedValue('<answer>Skipped (non-interactive mode)</answer>');

      const result = await executor.execute({
        type: 'ask_followup_question',
        question: 'Continue?'
      });

      expect(result).toBe('<answer>Skipped (non-interactive mode)</answer>');
    });
  });

  describe('fallback mode (no callback)', () => {
    // This tests the legacy enquirer-based fallback when no callback is provided
    // These tests would require mocking enquirer, which is complex
    // For now, we just verify the callback is called when provided

    it('uses callback when provided instead of direct enquirer', async () => {
      mockOnAskFollowup.mockResolvedValue('<answer>Selected</answer>');

      await executor.execute({
        type: 'ask_followup_question',
        question: 'Test?',
        suggested_answers: ['A', 'B', 'C']
      });

      // Callback should be used, not enquirer
      expect(mockOnAskFollowup).toHaveBeenCalled();
    });
  });

  describe('answer format', () => {
    it('returns answer wrapped in XML tags', async () => {
      mockOnAskFollowup.mockResolvedValue('<answer>My answer</answer>');

      const result = await executor.execute({
        type: 'ask_followup_question',
        question: 'What?'
      });

      expect(result).toMatch(/^<answer>.*<\/answer>$/);
    });

    it('preserves exact answer content', async () => {
      const exactAnswer = 'This is a detailed answer with special chars: <>&"\'';
      mockOnAskFollowup.mockResolvedValue(`<answer>${exactAnswer}</answer>`);

      const result = await executor.execute({
        type: 'ask_followup_question',
        question: 'Describe'
      });

      expect(result).toContain(exactAnswer);
    });
  });

  describe('suggested answers handling', () => {
    it('passes empty array when no suggestions', async () => {
      mockOnAskFollowup.mockResolvedValue('<answer>Free form</answer>');

      await executor.execute({
        type: 'ask_followup_question',
        question: 'Question?',
        suggested_answers: []
      });

      expect(mockOnAskFollowup).toHaveBeenCalledWith('Question?', []);
    });

    it('passes multiple suggestions', async () => {
      mockOnAskFollowup.mockResolvedValue('<answer>Option 2</answer>');

      await executor.execute({
        type: 'ask_followup_question',
        question: 'Choose:',
        suggested_answers: ['Option 1', 'Option 2', 'Option 3', 'Option 4']
      });

      expect(mockOnAskFollowup).toHaveBeenCalledWith('Choose:', ['Option 1', 'Option 2', 'Option 3', 'Option 4']);
    });
  });
});

describe('ActionExecutorOptions.onAskFollowup', () => {
  it('is optional in ActionExecutorOptions', () => {
    // Should not throw when onAskFollowup is not provided
    const executor = new ActionExecutor({
      runtime: createMockRuntime(),
      files: mockFileActionManager as any,
      resolveWorkspacePath: (p) => `/test/${p}`,
      confirmDangerousAction: vi.fn().mockResolvedValue(true)
      // onAskFollowup intentionally omitted
    });

    expect(executor).toBeDefined();
  });
});
