/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionExecutor } from '../src/core/actionExecutor.js';
import type { AgentRuntime } from '../src/types.js';

/**
 * Tests for input validation in actionExecutor tool handlers.
 *
 * Bug: When the LLM sends search_replace or multi_file_edit without the
 * required path/file_path argument, the executor crashes with:
 *   'The "path" property must be of type string, got undefined'
 *
 * These tests verify that proper validation errors are returned instead
 * of crashing, and cover additional edge cases.
 */

const mockFileActionManager = {
  readFile: vi.fn().mockResolvedValue(''),
  writeFile: vi.fn().mockResolvedValue(undefined),
  appendFile: vi.fn().mockResolvedValue(undefined),
  applyPatch: vi.fn().mockResolvedValue(undefined),
  search: vi.fn().mockReturnValue([]),
  searchWithContext: vi.fn(),
  semanticSearch: vi.fn().mockReturnValue([]),
  createDirectory: vi.fn().mockResolvedValue(undefined),
  deletePath: vi.fn().mockResolvedValue(undefined),
  renamePath: vi.fn().mockResolvedValue(undefined),
  copyPath: vi.fn().mockResolvedValue(undefined),
  formatFile: vi.fn().mockResolvedValue(undefined),
  fileStats: vi.fn().mockResolvedValue({}),
  checksum: vi.fn().mockResolvedValue(''),
  root: '/test'
};

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

function createExecutor() {
  return new ActionExecutor({
    runtime: createMockRuntime(),
    files: mockFileActionManager as any,
    resolveWorkspacePath: (p: string) => `/test/${p}`,
    confirmDangerousAction: vi.fn().mockResolvedValue(true),
    onAskFollowup: vi.fn(),
    onToolOutput: undefined,
    onFileModified: undefined,
    onReviewHook: undefined,
    onTodoUpdate: undefined,
    onMemoryUpdate: undefined,
    onScheduleUpdate: undefined,
    onAgentUpdate: undefined,
    onTeamUpdate: undefined,
    onSkillUpdate: undefined,
    onWebSearch: undefined,
    onFetchUrl: undefined,
    onPackageInfo: undefined,
    onWebRepo: undefined,
    onProjectTracker: undefined,
    onDelegateTask: undefined,
    onDelegateParallel: undefined,
    onCreateTeam: undefined,
    onAddTeammate: undefined,
    onCreateTask: undefined,
    onTeamStatus: undefined,
    onSendTeamMessage: undefined,
    onListSchedules: undefined,
    onCancelSchedule: undefined,
    onCreateMetaTool: undefined,
    onSaveMemory: undefined,
    onRecallMemory: undefined,
    onFindAgentSkills: undefined,
    onFormatFile: undefined,
    onFileStats: undefined,
    onChecksum: undefined,
    onGitDiff: undefined,
    onGitCheckout: undefined,
    onGitStatus: undefined,
    onGitListUntracked: undefined,
    onGitDiffRange: undefined,
    onGitApplyPatch: undefined,
    onGitWorktreeList: undefined,
    onGitWorktreeAdd: undefined,
    onGitWorktreeRemove: undefined,
    onGitWorktreeStatusAll: undefined,
    onGitWorktreeCleanup: undefined,
    onGitWorktreeRunParallel: undefined,
    onGitWorktreeSync: undefined,
    onGitWorktreeCreateForPr: undefined,
    onGitWorktreeCreateFromTemplate: undefined,
    onGitStash: undefined,
    onGitStashList: undefined,
    onGitStashPop: undefined,
    onGitStashApply: undefined,
    onGitStashDrop: undefined,
    onGitBranch: undefined,
    onGitSwitch: undefined,
    onGitCherryPick: undefined,
    onGitCherryPickAbort: undefined,
    onGitCherryPickContinue: undefined,
    onGitRebase: undefined,
    onGitRebaseAbort: undefined,
    onGitRebaseContinue: undefined,
    onGitRebaseSkip: undefined,
    onGitMerge: undefined,
    onGitMergeAbort: undefined,
    onGitCommit: undefined,
    onGitAdd: undefined,
    onGitReset: undefined,
    onAutoCommit: undefined,
    onGitLog: undefined,
    onGitFetch: undefined,
    onGitPull: undefined,
    onGitPush: undefined,
    onCustomCommand: undefined,
    onMultiFileEdit: undefined,
    onTodoWrite: undefined,
    onSmartContextCropper: undefined,
    onPlan: undefined,
    onReadFile: undefined,
    onWriteFile: undefined,
    onAppendFile: undefined,
    onApplyPatch: undefined,
    onSearch: undefined,
    onSearchWithContext: undefined,
    onSemanticSearch: undefined,
    onCreateDirectory: undefined,
    onDeletePath: undefined,
    onRenamePath: undefined,
    onCopyPath: undefined,
    onSearchReplace: undefined,
    onRunCommand: undefined,
    onAddDependency: undefined,
    onRemoveDependency: undefined,
    onListTree: undefined,
  });
}

describe('actionExecutor input validation', () => {
  let executor: ActionExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = createExecutor();
  });

  describe('search_replace', () => {
    it('returns error when path is missing', async () => {
      const action = {
        type: 'search_replace',
        blocks: 'some blocks',
      } as any;

      const result = await executor.execute(action);
      expect(result).toContain('search_replace requires a "path" argument');
    });

    it('returns error when blocks is missing', async () => {
      const action = {
        type: 'search_replace',
        path: 'some/file.ts',
      } as any;

      const result = await executor.execute(action);
      expect(result).toContain('search_replace requires a "blocks" argument');
    });

    it('returns error when both path and blocks are missing', async () => {
      const action = {
        type: 'search_replace',
      } as any;

      const result = await executor.execute(action);
      expect(result).toContain('search_replace requires a "path" argument');
    });
  });

  describe('multi_file_edit', () => {
    it('returns error when file_path is missing', async () => {
      const action = {
        type: 'multi_file_edit',
        edits: [{ old_string: 'a', new_string: 'b' }],
      } as any;

      const result = await executor.execute(action);
      expect(result).toContain('multi_file_edit requires a "file_path" argument');
    });

    it('returns error when edits is missing', async () => {
      const action = {
        type: 'multi_file_edit',
        file_path: 'some/file.ts',
      } as any;

      const result = await executor.execute(action);
      expect(result).toContain('multi_file_edit requires an "edits" argument');
    });

    it('returns error when both file_path and edits are missing', async () => {
      const action = {
        type: 'multi_file_edit',
      } as any;

      const result = await executor.execute(action);
      expect(result).toContain('multi_file_edit requires a "file_path" argument');
    });
  });

  describe('additional edge cases', () => {
    it('write_file returns error when path is missing', async () => {
      const action = {
        type: 'write_file',
        contents: 'some content',
      } as any;

      await expect(executor.execute(action)).rejects.toThrow('write_file requires a "path" argument');
    });

    it('write_file returns error when contents is missing', async () => {
      const action = {
        type: 'write_file',
        path: 'some/file.ts',
      } as any;

      const result = await executor.execute(action);
      expect(result).toContain('write_file requires "contents"');
    });

    it('read_file returns error when path is missing', async () => {
      const action = {
        type: 'read_file',
      } as any;

      await expect(executor.execute(action)).rejects.toThrow('read_file requires a "path" argument');
    });

    it('delete_path returns error when path is missing', async () => {
      const action = {
        type: 'delete_path',
      } as any;

      await expect(executor.execute(action)).rejects.toThrow('delete_path requires a "path" argument');
    });

    it('rename_path returns error when from is missing', async () => {
      const action = {
        type: 'rename_path',
        to: 'new_name.ts',
      } as any;

      await expect(executor.execute(action)).rejects.toThrow(/rename_path requires.*"from"/);
    });

    it('rename_path returns error when to is missing', async () => {
      const action = {
        type: 'rename_path',
        from: 'old_name.ts',
      } as any;

      await expect(executor.execute(action)).rejects.toThrow(/rename_path requires.*"to"/);
    });

    it('copy_path returns error when from is missing', async () => {
      const action = {
        type: 'copy_path',
        to: 'dest.ts',
      } as any;

      await expect(executor.execute(action)).rejects.toThrow(/copy_path requires.*"from"/);
    });

    it('copy_path returns error when to is missing', async () => {
      const action = {
        type: 'copy_path',
        from: 'src.ts',
      } as any;

      await expect(executor.execute(action)).rejects.toThrow(/copy_path requires.*"to"/);
    });

    it('apply_patch returns error when path is missing', async () => {
      const action = {
        type: 'apply_patch',
        patch: 'some patch',
      } as any;

      const result = await executor.execute(action);
      expect(result).toContain('apply_patch requires a "path" argument');
    });

    it('apply_patch returns error when patch is missing', async () => {
      const action = {
        type: 'apply_patch',
        path: 'some/file.ts',
      } as any;

      const result = await executor.execute(action);
      expect(result).toContain('apply_patch requires a "patch" argument');
    });

    it('create_directory returns error when path is missing', async () => {
      const action = {
        type: 'create_directory',
      } as any;

      const result = await executor.execute(action);
      expect(result).toContain('create_directory requires a "path" argument');
    });
  });


  describe('todo_write', () => {
    it('accepts tasks without id field (LLM sends {content, status, activeForm})', async () => {
      const action = {
        type: 'todo_write',
        tasks: [
          { content: 'Read existing auth code', status: 'pending' as const, activeForm: 'Reading auth code' },
          { content: 'Create JWT utility module', status: 'pending' as const, activeForm: 'Creating JWT module' },
          { content: 'Add login endpoint', status: 'pending' as const, activeForm: 'Adding login endpoint' },
        ],
      } as any;

      const result = await executor.execute(action);
      // Should NOT return empty/0/0 result — tasks should be accepted
      expect(result).not.toContain('0/0');
      expect(result).toContain('3');
    });

    it('accepts tasks with id field when provided', async () => {
      const action = {
        type: 'todo_write',
        tasks: [
          { id: '1', content: 'Task one', status: 'pending' as const, activeForm: 'Task one' },
          { id: '2', content: 'Task two', status: 'in_progress' as const, activeForm: 'Task two' },
        ],
      } as any;

      const result = await executor.execute(action);
      expect(result).toContain('2');
    });

    it('handles empty task list gracefully', async () => {
      const action = {
        type: 'todo_write',
        tasks: [],
      } as any;

      const result = await executor.execute(action);
      expect(result).toContain('cleared');
    });

    it('filters out null/undefined tasks but keeps valid ones', async () => {
      const action = {
        type: 'todo_write',
        tasks: [
          null,
          { content: 'Valid task', status: 'pending' as const, activeForm: 'Valid task' },
          undefined,
          { content: 'Another valid', status: 'completed' as const, activeForm: 'Another valid' },
        ],
      } as any;

      const result = await executor.execute(action);
      expect(result).toContain('2');
    });

    it('filters out tasks without content or title', async () => {
      const action = {
        type: 'todo_write',
        tasks: [
          { status: 'pending' as const, activeForm: 'No content' },
          { content: 'Has content', status: 'pending' as const, activeForm: 'Has content' },
        ],
      } as any;

      const result = await executor.execute(action);
      expect(result).toContain('1');
    });

    it('auto-generates id for tasks missing one', async () => {
      const action = {
        type: 'todo_write',
        tasks: [
          { content: 'Task without id', status: 'pending' as const, activeForm: 'Task without id' },
        ],
      } as any;

      const result = await executor.execute(action);
      // Should succeed and not crash
      expect(result).toContain('1');
    });
  });
});
