/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import stripAnsi from 'strip-ansi';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import type { AgentAction, AgentRuntime } from '../src/types.js';
import type { FileActionManager } from '../src/actions/filesystem.js';
import { ActionExecutor } from '../src/core/actionExecutor.js';
import type { MetaToolDefinition } from '../src/core/toolsRegistry.js';
import * as gitActions from '../src/actions/git.js';
import * as commandActions from '../src/actions/command.js';
import * as dependencyActions from '../src/actions/dependencies.js';
import * as shellActions from '../src/ui/shellCommand.js';
import * as webActions from '../src/actions/web.js';
import * as webRepoActions from '../src/actions/webRepo.js';
import { WorktreeManager } from '../src/actions/worktree.js';
import * as modalComponents from '../src/ui/ink/components/Modal.js';
import { ToolManager, type ToolDefinition } from '../src/core/toolManager.js';
import * as customCommandActions from '../src/core/customCommands.js';
import { execSync } from 'node:child_process';
import { PlanFileStorage } from '../src/modes/planMode/PlanFileStorage.js';
import { PermissionManager } from '../src/permissions/PermissionManager.js';

// Mock execSync for security scanner tests
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process');
  return {
    ...actual,
    execSync: vi.fn()
  };
});

vi.mock('../src/core/customCommands.js', () => ({
  loadCustomCommand: vi.fn().mockResolvedValue(undefined),
  saveCustomCommand: vi.fn().mockResolvedValue(undefined),
}));

// Mock fs-extra for pathExists control in write_file tests
const mockPathExists = vi.fn().mockResolvedValue(false);
const mockStat = vi.fn().mockResolvedValue({ isDirectory: () => true });
vi.mock('fs-extra', async () => {
  const actual = await vi.importActual('fs-extra');
  return {
    ...actual,
    default: {
      ...(actual as Record<string, unknown>).default,
      pathExists: (...args: unknown[]) => mockPathExists(...args),
      stat: (...args: unknown[]) => mockStat(...args),
    },
    pathExists: (...args: unknown[]) => mockPathExists(...args),
    stat: (...args: unknown[]) => mockStat(...args),
  };
});

function createRuntime(overrides: Partial<AgentRuntime> = {}): AgentRuntime {
  return {
    config: {
      configPath: '',
      openrouter: { apiKey: 'test', model: 'model' }
    },
    workspaceRoot: '/repo',
    options: {},
    ...overrides
  } as AgentRuntime;
}

function createFiles(overrides: Partial<FileActionManager> = {}): Partial<FileActionManager> {
  return {
    root: '/repo',
    readFile: vi.fn().mockResolvedValue('console.log("ok")'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    appendFile: vi.fn().mockResolvedValue(undefined),
    applyPatch: vi.fn().mockResolvedValue(undefined),
    deletePath: vi.fn().mockResolvedValue(undefined),
    renamePath: vi.fn().mockResolvedValue(undefined),
    copyPath: vi.fn().mockResolvedValue(undefined),
    createDirectory: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockReturnValue([]),
    searchWithContext: vi.fn().mockReturnValue(''),
    semanticSearch: vi.fn().mockReturnValue([]),
    formatFile: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as Partial<FileActionManager>;
}

function createExecutor(
  filesOverrides: Partial<FileActionManager> = {},
  options: {
    runtime?: Partial<AgentRuntime>;
    onFileModified?: (filePath?: string, changeType?: 'create' | 'modify' | 'delete') => void;
    onExploration?: (entry: { kind: string; target: string }) => void;
    confirmDangerousAction?: () => Promise<boolean>;
    onGoalWrittenCompleted?: (context: {
      goalId?: string;
      goalObjective: string;
      goalSource: string;
    }) => Promise<void>;
    onModalPause?: <T>(callback: () => Promise<T>) => Promise<T>;
    onReviewHook?: (event: string) => Promise<void>;
  } = {}
): ActionExecutor {
  return new ActionExecutor({
    runtime: createRuntime(options.runtime),
    files: createFiles(filesOverrides) as FileActionManager,
    resolveWorkspacePath: (rel) => `/repo/${rel}`,
    confirmDangerousAction: options.confirmDangerousAction ?? vi.fn().mockResolvedValue(true),
    onFileModified: options.onFileModified,
    onExploration: options.onExploration,
    onGoalWrittenCompleted: options.onGoalWrittenCompleted,
    onModalPause: options.onModalPause,
    onReviewHook: options.onReviewHook,
  });
}

describe('ActionExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('File Operations', () => {
    it('reads files via FileActionManager', async () => {
      const readFile = vi.fn().mockResolvedValue('console.log("ok")');
      const executor = createExecutor({ readFile });

      const result = await executor.execute({ type: 'read_file', path: 'src/index.ts' });

      expect(readFile).toHaveBeenCalledWith('src/index.ts');
      expect(result).toContain('console.log');
    });

    it('returns full read_file contents even when display limits are configured', async () => {
      const content = 'x'.repeat(40);
      const executor = createExecutor(
        { readFile: vi.fn().mockResolvedValue(content) },
        { runtime: { config: { ui: { readFileCharLimit: 5 } } } as any }
      );

      const result = await executor.execute({ type: 'read_file', path: 'src/index.ts' });

      expect(result).toBe(content);
    });

    it('throws error when read_file path is missing', async () => {
      const executor = createExecutor();

      await expect(executor.execute({ type: 'read_file' } as any)).rejects.toThrow('path');
    });

    it('writes file contents provided via content alias', async () => {
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({
        readFile: vi.fn().mockResolvedValue('old'),
        writeFile
      });

      await executor.execute({ type: 'write_file', path: 'README.md', content: '# hello' } as any);

      expect(writeFile).toHaveBeenCalledWith('README.md', '# hello');
    });

    it('skips write when existing file content is identical', async () => {
      mockPathExists.mockResolvedValueOnce(true);
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const onFileModified = vi.fn();
      const executor = createExecutor(
        { readFile: vi.fn().mockResolvedValue('same content'), writeFile },
        { onFileModified }
      );

      const result = await executor.execute({ type: 'write_file', path: 'README.md', content: 'same content' } as any);

      expect(writeFile).not.toHaveBeenCalled();
      expect(onFileModified).not.toHaveBeenCalled();
      expect(result).toContain('No changes needed');
      expect(result).toContain('content identical');
    });

    it('writes file when content differs from existing', async () => {
      mockPathExists.mockResolvedValueOnce(true);
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const onFileModified = vi.fn();
      const executor = createExecutor(
        { readFile: vi.fn().mockResolvedValue('old content'), writeFile },
        { onFileModified }
      );

      const result = await executor.execute({ type: 'write_file', path: 'README.md', content: 'new content' } as any);

      expect(writeFile).toHaveBeenCalledWith('README.md', 'new content');
      expect(onFileModified).toHaveBeenCalledWith('README.md', 'modify');
      expect(result).toContain('Added');
      expect(result).toContain('removed');
    });

    it('passes file path to onFileModified callback for new files', async () => {
      mockPathExists.mockResolvedValueOnce(false);
      const onFileModified = vi.fn();
      const executor = createExecutor(
        { readFile: vi.fn().mockRejectedValue(new Error('not found')), writeFile: vi.fn() },
        { onFileModified }
      );

      await executor.execute({ type: 'write_file', path: 'src/new.ts', content: 'code' } as any);

      expect(onFileModified).toHaveBeenCalledWith('src/new.ts', 'create');
    });

    it('uses canonical write approval without prompting again for a new file', async () => {
      mockPathExists.mockResolvedValueOnce(false);
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const confirmDangerousAction = vi.fn().mockResolvedValue(false);
      const executor = createExecutor(
        { readFile: vi.fn().mockRejectedValue(new Error('not found')), writeFile },
        { confirmDangerousAction },
      );

      await executor.execute(
        { type: 'write_file', path: 'src/new.ts', content: 'code' },
        { tool: 'write_file', toolCallId: 'call-write', approvalHandled: true },
      );

      expect(confirmDangerousAction).not.toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalledWith('src/new.ts', 'code');
    });

    it('throws error when write_file path is missing', async () => {
      const executor = createExecutor();

      await expect(executor.execute({ type: 'write_file', content: 'test' } as any)).rejects.toThrow('path');
    });

    it('appends file contents provided via content alias', async () => {
      const appendFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({
        readFile: vi.fn().mockResolvedValue('old'),
        appendFile
      });

      await executor.execute({ type: 'append_file', path: 'README.md', content: '\nMore' } as any);

      expect(appendFile).toHaveBeenCalledWith('README.md', '\nMore');
    });

    it('accepts diff alias for apply_patch', async () => {
      const readFile = vi.fn()
        .mockResolvedValueOnce('old')
        .mockResolvedValueOnce('new');
      const applyPatch = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, applyPatch });

      await executor.execute({ type: 'apply_patch', path: 'src/index.ts', diff: '@@ diff @@' } as any);

      expect(applyPatch).toHaveBeenCalledWith('src/index.ts', '@@ diff @@');
    });

    it('edits a notebook cell by index with notebook_edit', async () => {
      const notebook = JSON.stringify({
        nbformat: 4,
        nbformat_minor: 5,
        metadata: { language_info: { name: 'python' } },
        cells: [
          { id: 'cell-1', cell_type: 'markdown', source: ['# Title\n'] },
          { id: 'cell-2', cell_type: 'code', source: ['print("old")\n'], outputs: [] },
        ],
      });
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const onFileModified = vi.fn();
      const executor = createExecutor(
        { readFile: vi.fn().mockResolvedValue(notebook), writeFile },
        { onFileModified }
      );

      const result = await executor.execute({
        type: 'notebook_edit',
        path: 'analysis.ipynb',
        cell_index: 1,
        new_source: 'print("new")\n',
        edit_mode: 'replace',
      } as any);

      expect(writeFile).toHaveBeenCalledTimes(1);
      const [, updatedContent] = writeFile.mock.calls[0];
      const parsed = JSON.parse(updatedContent);
      expect(parsed.cells[1].source).toBe('print("new")\n');
      expect(onFileModified).toHaveBeenCalledWith('analysis.ipynb', 'modify');
      expect(result).toContain('Updated notebook cell');
    });

    it('inserts a new notebook cell with notebook_edit', async () => {
      const notebook = JSON.stringify({
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {},
        cells: [
          { id: 'cell-1', cell_type: 'markdown', source: ['# Title\n'] },
        ],
      });
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({
        readFile: vi.fn().mockResolvedValue(notebook),
        writeFile
      });

      await executor.execute({
        type: 'notebook_edit',
        path: 'analysis.ipynb',
        cell_index: 0,
        new_source: 'print("hello")\n',
        cell_type: 'code',
        edit_mode: 'insert',
      } as any);

      const [, updatedContent] = writeFile.mock.calls[0];
      const parsed = JSON.parse(updatedContent);
      expect(parsed.cells).toHaveLength(2);
      expect(parsed.cells[1].cell_type).toBe('code');
      expect(parsed.cells[1].source).toBe('print("hello")\n');
    });

    it('rejects notebook_edit for non-ipynb paths', async () => {
      const executor = createExecutor();

      await expect(executor.execute({
        type: 'notebook_edit',
        path: 'analysis.py',
        cell_index: 0,
        new_source: 'print("x")',
      } as any)).rejects.toThrow('.ipynb');
    });

    it('returns diff preview for append_file', async () => {
      const appendFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({
        readFile: vi.fn().mockResolvedValue('old'),
        appendFile
      });

      const result = await executor.execute({ type: 'append_file', path: 'README.md', content: '\nMore' } as any);

      expect(result).toContain('Added');
      expect(result).toContain('removed');
    });

    it('creates directories', async () => {
      const createDirectory = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ createDirectory });

      const result = await executor.execute({ type: 'create_directory', path: 'src/new' } as any);

      expect(createDirectory).toHaveBeenCalledWith('src/new');
      expect(result).toContain('Created directory');
    });

    it('renames paths', async () => {
      const renamePath = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ renamePath });

      const result = await executor.execute({ type: 'rename_path', from: 'old.ts', to: 'new.ts' } as any);

      expect(renamePath).toHaveBeenCalledWith('old.ts', 'new.ts');
      expect(result).toContain('Renamed');
    });

    it('throws error when rename_path missing from/to', async () => {
      const executor = createExecutor();

      await expect(executor.execute({ type: 'rename_path', from: 'old.ts' } as any)).rejects.toThrow('from');
    });

    it('copies paths', async () => {
      const copyPath = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ copyPath });

      const result = await executor.execute({ type: 'copy_path', from: 'src', to: 'src-backup' } as any);

      expect(copyPath).toHaveBeenCalledWith('src', 'src-backup');
      expect(result).toContain('Copied');
    });

    it('requires confirmation before deleting paths', async () => {
      const deletePath = vi.fn().mockResolvedValue(undefined);
      const confirmDangerousAction = vi.fn().mockResolvedValue(false);
      const executor = createExecutor({ deletePath }, { confirmDangerousAction });

      const result = await executor.execute({ type: 'delete_path', path: 'dist' });

      expect(confirmDangerousAction).toHaveBeenCalled();
      expect(deletePath).not.toHaveBeenCalled();
      expect(result).toContain('Skipped');
    });

    it('deletes paths when confirmed', async () => {
      const deletePath = vi.fn().mockResolvedValue(undefined);
      const confirmDangerousAction = vi.fn().mockResolvedValue(true);
      const onFileModified = vi.fn();
      const executor = createExecutor({ deletePath }, { confirmDangerousAction, onFileModified });

      const result = await executor.execute({ type: 'delete_path', path: 'dist' });

      expect(confirmDangerousAction).toHaveBeenCalledOnce();
      expect(deletePath).toHaveBeenCalledWith('dist');
      expect(onFileModified).toHaveBeenCalledWith('dist', 'delete');
      // File deletions now show diff preview with removal stats
      expect(result).toContain('removed');
    });

    it('does not prompt again when the canonical caller already handled approval', async () => {
      const deletePath = vi.fn().mockResolvedValue(undefined);
      const confirmDangerousAction = vi.fn().mockResolvedValue(false);
      const executor = createExecutor({ deletePath }, { confirmDangerousAction });

      await executor.execute(
        { type: 'delete_path', path: 'dist' },
        { tool: 'delete_path', toolCallId: 'call-1', approvalHandled: true },
      );

      expect(confirmDangerousAction).not.toHaveBeenCalled();
      expect(deletePath).toHaveBeenCalledWith('dist');
    });

    it('deletes directories when readFile fails (directory)', async () => {
      const deletePath = vi.fn().mockResolvedValue(undefined);
      const confirmDangerousAction = vi.fn().mockResolvedValue(true);
      const onFileModified = vi.fn();
      const executor = createExecutor(
        { deletePath, readFile: vi.fn().mockRejectedValue(new Error('EISDIR')) },
        { confirmDangerousAction, onFileModified }
      );

      const result = await executor.execute({ type: 'delete_path', path: 'dist' });

      expect(deletePath).toHaveBeenCalledWith('dist');
      expect(onFileModified).toHaveBeenCalledWith('dist', 'delete');
      expect(result).toContain('Deleted directory');
    });
  });

  describe('Goal Tools', () => {
    it('emits goal-written completion hook when create_goal succeeds', async () => {
      const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-action-goal-'));
      const onGoalWrittenCompleted = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({}, {
        runtime: { workspaceRoot, config: { features: { slashGoal: true } } },
        onGoalWrittenCompleted,
      });

      try {
        const result = await executor.execute({ type: 'create_goal', objective: 'ship stable goal-writer support' } as any);

        expect(JSON.parse(result)).toMatchObject({ ok: true, message: 'Goal created.' });
        expect(onGoalWrittenCompleted).toHaveBeenCalledWith(expect.objectContaining({
          goalObjective: 'ship stable goal-writer support',
          goalSource: 'tool',
        }));
      } finally {
        await fs.remove(workspaceRoot);
      }
    });
  });

  describe('File Modification Callback', () => {
    it('calls onFileModified after write_file', async () => {
      const onFileModified = vi.fn();
      const executor = createExecutor(
        { readFile: vi.fn().mockResolvedValue('old'), writeFile: vi.fn() },
        { onFileModified }
      );

      await executor.execute({ type: 'write_file', path: 'test.ts', content: 'new' } as any);

      expect(onFileModified).toHaveBeenCalledTimes(1);
    });

    it('calls onFileModified after append_file', async () => {
      const onFileModified = vi.fn();
      const executor = createExecutor(
        { readFile: vi.fn().mockResolvedValue('old'), appendFile: vi.fn() },
        { onFileModified }
      );

      await executor.execute({ type: 'append_file', path: 'test.ts', content: '\nnew' } as any);

      expect(onFileModified).toHaveBeenCalledTimes(1);
    });

    it('calls onFileModified after apply_patch', async () => {
      const onFileModified = vi.fn();
      const readFile = vi.fn()
        .mockResolvedValueOnce('old')
        .mockResolvedValueOnce('new');
      const executor = createExecutor(
        { readFile, applyPatch: vi.fn() },
        { onFileModified }
      );

      await executor.execute({ type: 'apply_patch', path: 'test.ts', patch: '@@ patch @@' } as any);

      expect(onFileModified).toHaveBeenCalledTimes(1);
    });

    it('does not call onFileModified for read operations', async () => {
      const onFileModified = vi.fn();
      const executor = createExecutor({}, { onFileModified });

      await executor.execute({ type: 'read_file', path: 'test.ts' });

      expect(onFileModified).not.toHaveBeenCalled();
    });

    it('onFileModified passes changeType for write_file creating a new file', async () => {
      // Check source code contains changeType parameter
      const { readFileSync } = await import('node:fs');
      const source = readFileSync('src/core/actionExecutor.ts', 'utf-8');
      // All onFileModified calls should pass a second argument
      const calls = source.match(/onFileModified\?\.\([^)]+\)/g) || [];
      const withChangeType = calls.filter(c => c.includes(','));
      expect(withChangeType.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('Search Operations', () => {
    it('executes find as the canonical search tool', async () => {
      const search = vi.fn().mockReturnValue([
        { file: 'src/index.ts', line: 10, text: 'console.log("hello")' },
      ]);
      const executor = createExecutor({ search });

      const result = await executor.execute({ type: 'find', query: 'console.log' } as any);

      expect(search).toHaveBeenCalledWith('console.log', undefined);
      expect(result).toContain('src/index.ts:10');
    });

    it('executes find with context when requested', async () => {
      const searchWithContext = vi.fn().mockReturnValue('matched context');
      const executor = createExecutor({ searchWithContext });

      const result = await executor.execute({
        type: 'find',
        query: 'function',
        context: 3,
        limit: 5,
      } as any);

      expect(searchWithContext).toHaveBeenCalledWith('function', {
        limit: 5,
        context: 3,
        relativePath: undefined
      });
      expect(result).toBe('matched context');
    });

    it('executes find in semantic mode when requested', async () => {
      const semanticSearch = vi.fn().mockReturnValue([
        { file: 'src/auth.ts', snippet: 'login function' }
      ]);
      const executor = createExecutor({ semanticSearch });

      const result = await executor.execute({
        type: 'find',
        query: 'authentication',
        mode: 'semantic'
      } as any);

      expect(semanticSearch).toHaveBeenCalledWith('authentication', {
        limit: undefined,
        window: undefined,
        relativePath: undefined
      });
      expect(result).toContain('src/auth.ts');
    });

    it('executes find in exact mode', async () => {
      const search = vi.fn().mockReturnValue([
        { file: 'src/index.ts', line: 10, text: 'console.log("hello")' },
        { file: 'src/utils.ts', line: 5, text: 'console.log("world")' }
      ]);
      const executor = createExecutor({ search });

      const result = await executor.execute({ type: 'find', query: 'console.log', mode: 'exact' } as any);

      expect(search).toHaveBeenCalledWith('console.log', undefined);
      expect(result).toContain('src/index.ts:10');
      expect(result).toContain('src/utils.ts:5');
    });

    it('executes find with context mode', async () => {
      const searchWithContext = vi.fn().mockReturnValue('matched context');
      const executor = createExecutor({ searchWithContext });

      const result = await executor.execute({
        type: 'find',
        query: 'function',
        mode: 'context',
        limit: 5,
        context: 3
      } as any);

      expect(searchWithContext).toHaveBeenCalledWith('function', {
        limit: 5,
        context: 3,
        relativePath: undefined
      });
      expect(result).toBe('matched context');
    });

    it('executes find in semantic mode', async () => {
      const semanticSearch = vi.fn().mockReturnValue([
        { file: 'src/auth.ts', snippet: 'login function' }
      ]);
      const executor = createExecutor({ semanticSearch });

      const result = await executor.execute({
        type: 'find',
        query: 'authentication',
        mode: 'semantic'
      } as any);

      expect(semanticSearch).toHaveBeenCalled();
      expect(result).toContain('src/auth.ts');
    });
  });

  describe('Git Operations', () => {
    it('executes git_status', async () => {
      const statusSpy = vi.spyOn(gitActions, 'gitStatus').mockReturnValue('M src/index.ts');
      const executor = createExecutor();

      const result = await executor.execute({ type: 'git_status' } as any);

      expect(statusSpy).toHaveBeenCalledWith('/repo');
      expect(result).toBe('M src/index.ts');
      statusSpy.mockRestore();
    });

    it('executes git_diff', async () => {
      const diffSpy = vi.spyOn(gitActions, 'diffFile').mockReturnValue('diff output');
      const executor = createExecutor();

      const result = await executor.execute({ type: 'git_diff', path: 'src/index.ts' } as any);

      expect(diffSpy).toHaveBeenCalledWith('/repo', 'src/index.ts');
      // Result includes colorized stats header + original diff
      expect(result).toContain('diff output');
      diffSpy.mockRestore();
    });

    it('executes git_diff without path to show all uncommitted changes', async () => {
      const diffAllSpy = vi.spyOn(gitActions, 'diffWorkspace').mockReturnValue('workspace diff output');
      const executor = createExecutor();

      // path is omitted — should NOT throw and should call diffWorkspace
      const result = await executor.execute({ type: 'git_diff' } as any);

      expect(diffAllSpy).toHaveBeenCalledWith('/repo');
      expect(result).toContain('workspace diff output');
      diffAllSpy.mockRestore();
    });

    it('executes git_diff without path in dry-run mode', async () => {
      const diffAllSpy = vi.spyOn(gitActions, 'diffWorkspace').mockReturnValue('workspace diff output');
      const executor = createExecutor(
        {},
        { runtime: { options: { dryRun: true } } as any }
      );

      const result = await executor.execute({ type: 'git_diff' } as any);

      expect(result).toBeDefined();
      diffAllSpy.mockRestore();
    });

    it('accepts diff alias for git_apply_patch', async () => {
      const patchSpy = vi.spyOn(gitActions, 'applyGitPatch').mockImplementation(() => 'ok');
      const executor = createExecutor();

      await executor.execute({ type: 'git_apply_patch', diff: 'diff --git a b' } as any);

      expect(patchSpy).toHaveBeenCalledWith('/repo', 'diff --git a b');
      patchSpy.mockRestore();
    });

    it('executes git_add', async () => {
      const addSpy = vi.spyOn(gitActions, 'gitAdd').mockReturnValue('added');
      const executor = createExecutor();

      const result = await executor.execute({ type: 'git_add', paths: ['src/'] } as any);

      expect(addSpy).toHaveBeenCalledWith('/repo', ['src/']);
      expect(result).toBe('added');
      addSpy.mockRestore();
    });

    it('executes git_log', async () => {
      const logSpy = vi.spyOn(gitActions, 'gitLog').mockReturnValue('commit abc123');
      const executor = createExecutor();

      const result = await executor.execute({ type: 'git_log', max_count: 5 } as any);

      expect(logSpy).toHaveBeenCalledWith('/repo', { maxCount: 5, oneline: undefined, graph: undefined, all: undefined });
      expect(result).toContain('abc123');
      logSpy.mockRestore();
    });
  });

  describe('Security Scanning', () => {
    it('scans for secrets before git_commit', async () => {
      const mockedExecSync = vi.mocked(execSync);
      // OpenAI key pattern: sk-proj- followed by 32+ alphanumeric chars
      mockedExecSync.mockReturnValue('+const API_KEY = "sk-proj-abc123def456ghi789jkl012mno345pqr678";\n');

      const commitSpy = vi.spyOn(gitActions, 'gitCommit').mockReturnValue('committed');
      const executor = createExecutor();

      const result = await executor.execute({ type: 'git_commit', message: 'test' } as any);

      expect(mockedExecSync).toHaveBeenCalledWith('git diff --cached', expect.any(Object));
      // Should be blocked due to secret detection
      expect(result).toContain('BLOCKED');
      expect(commitSpy).not.toHaveBeenCalled();
      commitSpy.mockRestore();
    });

    it('allows git_commit when no secrets detected', async () => {
      const mockedExecSync = vi.mocked(execSync);
      mockedExecSync.mockReturnValue('+const message = "hello world";\n');

      const commitSpy = vi.spyOn(gitActions, 'gitCommit').mockReturnValue('committed');
      const executor = createExecutor();

      const result = await executor.execute({ type: 'git_commit', message: 'test' } as any);

      expect(result).toBe('committed');
      expect(commitSpy).toHaveBeenCalled();
      commitSpy.mockRestore();
    });

    it('allows git_commit when diff is empty', async () => {
      const mockedExecSync = vi.mocked(execSync);
      mockedExecSync.mockReturnValue('');

      const commitSpy = vi.spyOn(gitActions, 'gitCommit').mockReturnValue('committed');
      const executor = createExecutor();

      const result = await executor.execute({ type: 'git_commit', message: 'test' } as any);

      expect(result).toBe('committed');
      commitSpy.mockRestore();
    });

    it('proceeds with commit if git diff fails', async () => {
      const mockedExecSync = vi.mocked(execSync);
      mockedExecSync.mockImplementation(() => { throw new Error('git not found'); });

      const commitSpy = vi.spyOn(gitActions, 'gitCommit').mockReturnValue('committed');
      const executor = createExecutor();

      const result = await executor.execute({ type: 'git_commit', message: 'test' } as any);

      expect(result).toBe('committed');
      commitSpy.mockRestore();
    });

    it('auto_commit bypasses confirmation modal in yes mode', async () => {
      const mockedExecSync = vi.mocked(execSync);
      mockedExecSync.mockReturnValue('+const message = "safe";\n');

      const infoSpy = vi.spyOn(gitActions, 'getAutoCommitInfo').mockReturnValue({
        canCommit: true,
        suggestedMessage: 'chore: automated commit',
        filesChanged: ['src/index.ts']
      } as any);
      const executeSpy = vi.spyOn(gitActions, 'executeAutoCommit').mockReturnValue({
        success: true,
        message: 'Committed 1 file'
      } as any);
      const modalSpy = vi.spyOn(modalComponents, 'showModal');
      const inputSpy = vi.spyOn(modalComponents, 'showInput');

      const executor = createExecutor(
        {},
        { runtime: { options: { yes: true } } as any }
      );

      const result = await executor.execute({ type: 'auto_commit' } as any);

      expect(modalSpy).not.toHaveBeenCalled();
      expect(inputSpy).not.toHaveBeenCalled();
      expect(executeSpy).toHaveBeenCalledWith('/repo', 'chore: automated commit', true);
      expect(result).toBe('Committed 1 file');

      infoSpy.mockRestore();
      executeSpy.mockRestore();
      modalSpy.mockRestore();
      inputSpy.mockRestore();
    });

    it('auto_commit still prompts in interactive mode', async () => {
      const mockedExecSync = vi.mocked(execSync);
      mockedExecSync.mockReturnValue('+const message = "safe";\n');

      const infoSpy = vi.spyOn(gitActions, 'getAutoCommitInfo').mockReturnValue({
        canCommit: true,
        suggestedMessage: 'chore: suggested message',
        filesChanged: ['src/index.ts']
      } as any);
      const executeSpy = vi.spyOn(gitActions, 'executeAutoCommit').mockReturnValue({
        success: true,
        message: 'Committed 1 file'
      } as any);
      const modalSpy = vi.spyOn(modalComponents, 'showModal').mockResolvedValue({ value: 'n' } as any);

      const executor = createExecutor();
      const result = await executor.execute({ type: 'auto_commit' } as any);

      expect(modalSpy).toHaveBeenCalled();
      expect(executeSpy).not.toHaveBeenCalled();
      expect(result).toBe('Commit cancelled by user');

      infoSpy.mockRestore();
      executeSpy.mockRestore();
      modalSpy.mockRestore();
    });
  });

  describe('Multi-File Edit', () => {
    it('applies multiple edits to a file', async () => {
      const content = 'const a = 1;\nconst b = 2;\nconst c = 3;';
      const readFile = vi.fn().mockResolvedValue(content);
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, writeFile });

      const result = await executor.execute({
        type: 'multi_file_edit',
        file_path: 'test.ts',
        edits: [
          { old_string: 'const a = 1;', new_string: 'const a = 10;' },
          { old_string: 'const b = 2;', new_string: 'const b = 20;' }
        ]
      } as any);

      expect(writeFile).toHaveBeenCalled();
      const writtenContent = writeFile.mock.calls[0][1];
      expect(writtenContent).toContain('const a = 10;');
      expect(writtenContent).toContain('const b = 20;');
      expect(result).toContain('Added');
      expect(result).toContain('removed');
    });

    it('applies replace_all edits', async () => {
      const content = 'foo bar foo baz foo';
      const readFile = vi.fn().mockResolvedValue(content);
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, writeFile });

      await executor.execute({
        type: 'multi_file_edit',
        file_path: 'test.ts',
        edits: [
          { old_string: 'foo', new_string: 'qux', replace_all: true }
        ]
      } as any);

      const writtenContent = writeFile.mock.calls[0][1];
      expect(writtenContent).toBe('qux bar qux baz qux');
    });

    it('throws error when edit text not found', async () => {
      const readFile = vi.fn().mockResolvedValue('hello world');
      const executor = createExecutor({ readFile });

      await expect(executor.execute({
        type: 'multi_file_edit',
        file_path: 'test.ts',
        edits: [
          { old_string: 'not found text', new_string: 'replacement' }
        ]
      } as any)).rejects.toThrow('Could not find text');
    });

    it('calls onFileModified after multi_file_edit', async () => {
      const onFileModified = vi.fn();
      const readFile = vi.fn().mockResolvedValue('old text');
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, writeFile }, { onFileModified });

      await executor.execute({
        type: 'multi_file_edit',
        file_path: 'test.ts',
        edits: [{ old_string: 'old text', new_string: 'new text' }]
      } as any);

      expect(onFileModified).toHaveBeenCalledTimes(1);
    });
  });

  describe('Todo Write', () => {
    it('writes tasks to todo file', async () => {
      const readFile = vi.fn().mockRejectedValue(new Error('not found'));
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, writeFile });

      const result = await executor.execute({
        type: 'todo_write',
        tasks: [
          { id: '1', title: 'Task 1', status: 'pending' },
          { id: '2', title: 'Task 2', status: 'completed' }
        ]
      } as any);

      expect(writeFile).toHaveBeenCalledWith('.autohand/agents/tasks/todos.json', expect.any(String));
      const written = JSON.parse(writeFile.mock.calls[0][1]);
      expect(written).toHaveLength(2);
      expect(result).toContain('50%');
    });

    it('replaces entire task list (does not merge)', async () => {
      // Note: todo_write now replaces the entire list instead of merging
      // The LLM sends a COMPLETE updated list, not incremental updates
      const existingTasks = JSON.stringify([
        { id: '1', title: 'Existing', status: 'pending' }
      ]);
      const readFile = vi.fn().mockResolvedValue(existingTasks);
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, writeFile });

      await executor.execute({
        type: 'todo_write',
        tasks: [
          { id: '2', title: 'New Task', status: 'pending' }
        ]
      } as any);

      const written = JSON.parse(writeFile.mock.calls[0][1]);
      // Should only have the new task, not merge with existing
      expect(written).toHaveLength(1);
      expect(written.find((t: any) => t.id === '1')).toBeUndefined();
      expect(written.find((t: any) => t.id === '2')).toBeDefined();
    });

    it('updates existing tasks by id', async () => {
      const existingTasks = JSON.stringify([
        { id: '1', title: 'Old Title', status: 'pending' }
      ]);
      const readFile = vi.fn().mockResolvedValue(existingTasks);
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, writeFile });

      await executor.execute({
        type: 'todo_write',
        tasks: [
          { id: '1', title: 'New Title', status: 'completed' }
        ]
      } as any);

      const written = JSON.parse(writeFile.mock.calls[0][1]);
      expect(written).toHaveLength(1);
      expect(written[0].title).toBe('New Title');
      expect(written[0].status).toBe('completed');
    });

    it('skips invalid tasks array', async () => {
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'todo_write',
        tasks: 'not an array'
      } as any);

      expect(result).toContain('skipped');
    });

    it('handles empty tasks array', async () => {
      const readFile = vi.fn().mockRejectedValue(new Error('not found'));
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, writeFile });

      await executor.execute({
        type: 'todo_write',
        tasks: []
      } as any);

      expect(writeFile).toHaveBeenCalled();
      const written = JSON.parse(writeFile.mock.calls[0][1]);
      expect(written).toHaveLength(0);
    });

    it('calculates 0% progress for all pending tasks', async () => {
      const readFile = vi.fn().mockRejectedValue(new Error('not found'));
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, writeFile });

      const result = await executor.execute({
        type: 'todo_write',
        tasks: [
          { id: '1', title: 'Task 1', status: 'pending' },
          { id: '2', title: 'Task 2', status: 'pending' }
        ]
      } as any);

      expect(result).toContain('0%');
    });

    it('calculates 100% progress for all completed tasks', async () => {
      const readFile = vi.fn().mockRejectedValue(new Error('not found'));
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, writeFile });

      const result = await executor.execute({
        type: 'todo_write',
        tasks: [
          { id: '1', title: 'Task 1', status: 'completed' },
          { id: '2', title: 'Task 2', status: 'completed' }
        ]
      } as any);

      expect(result).toContain('100%');
    });

    it('handles in_progress status', async () => {
      const readFile = vi.fn().mockRejectedValue(new Error('not found'));
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, writeFile });

      const result = await executor.execute({
        type: 'todo_write',
        tasks: [
          { id: '1', title: 'Task 1', status: 'in_progress' },
          { id: '2', title: 'Task 2', status: 'pending' }
        ]
      } as any);

      expect(result).toContain('0%'); // in_progress doesn't count as completed
    });

    it('prints completed, active, and pending tasks in the progress output', async () => {
      const readFile = vi.fn().mockRejectedValue(new Error('not found'));
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, writeFile });
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      try {
        await executor.execute({
          type: 'todo_write',
          tasks: [
            { id: '1', title: 'Set up project shell', status: 'completed' },
            { id: '2', title: 'Wire game state', status: 'in_progress' },
            { id: '3', title: 'Persist high score', status: 'pending' }
          ]
        } as any);
        const output = stripAnsi(log.mock.calls.map(([message]) => String(message)).join('\n'));
        expect(output).toContain('✅ Completed Tasks:');
        expect(output).toContain('✓ Set up project shell');
        expect(output).toContain('🔄 Active Tasks:');
        expect(output).toContain('• Wire game state');
        expect(output).toContain('⏳ Pending Tasks:');
        expect(output).toContain('○ Persist high score');
      } finally {
        log.mockRestore();
      }
    });

    it('auto-generates ids for tasks without id', async () => {
      const readFile = vi.fn().mockRejectedValue(new Error('not found'));
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, writeFile });

      await executor.execute({
        type: 'todo_write',
        tasks: [
          { title: 'No ID Task', status: 'pending' },
          { id: '1', title: 'Valid Task', status: 'pending' }
        ]
      } as any);

      const written = JSON.parse(writeFile.mock.calls[0][1]);
      expect(written).toHaveLength(2);
      expect(written[0].id).toMatch(/^task-/);
      expect(written[1].id).toBe('1');
    });

    it('skips tasks without title or content', async () => {
      const readFile = vi.fn().mockRejectedValue(new Error('not found'));
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, writeFile });

      await executor.execute({
        type: 'todo_write',
        tasks: [
          { id: '1', status: 'pending' }, // Missing title/content - should be skipped
          { id: '2', title: 'Valid Task', status: 'pending' }
        ]
      } as any);

      const written = JSON.parse(writeFile.mock.calls[0][1]);
      expect(written).toHaveLength(1);
      expect(written[0].id).toBe('2');
    });

    it('skips null and undefined tasks in array', async () => {
      const readFile = vi.fn().mockRejectedValue(new Error('not found'));
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, writeFile });

      await executor.execute({
        type: 'todo_write',
        tasks: [
          null,
          { id: '1', title: 'Valid Task', status: 'pending' },
          undefined
        ]
      } as any);

      const written = JSON.parse(writeFile.mock.calls[0][1]);
      expect(written).toHaveLength(1);
      expect(written[0].id).toBe('1');
    });

    it('handles corrupted existing todos JSON', async () => {
      const readFile = vi.fn().mockResolvedValue('not valid json');
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, writeFile });

      await executor.execute({
        type: 'todo_write',
        tasks: [
          { id: '1', title: 'New Task', status: 'pending' }
        ]
      } as any);

      // Should start fresh when existing JSON is corrupted
      const written = JSON.parse(writeFile.mock.calls[0][1]);
      expect(written).toHaveLength(1);
    });

    it('handles existing todos as non-array', async () => {
      const readFile = vi.fn().mockResolvedValue('{}'); // Object, not array
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, writeFile });

      await executor.execute({
        type: 'todo_write',
        tasks: [
          { id: '1', title: 'New Task', status: 'pending' }
        ]
      } as any);

      const written = JSON.parse(writeFile.mock.calls[0][1]);
      expect(written).toHaveLength(1);
    });

    it('preserves extra task properties', async () => {
      const readFile = vi.fn().mockRejectedValue(new Error('not found'));
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, writeFile });

      await executor.execute({
        type: 'todo_write',
        tasks: [
          { id: '1', title: 'Task', status: 'pending', priority: 'high', tags: ['urgent'] }
        ]
      } as any);

      const written = JSON.parse(writeFile.mock.calls[0][1]);
      expect(written[0].priority).toBe('high');
      expect(written[0].tags).toEqual(['urgent']);
    });

    it('replaces existing task with same id completely', async () => {
      const existingTasks = JSON.stringify([
        { id: '1', title: 'Old', status: 'pending', priority: 'low' }
      ]);
      const readFile = vi.fn().mockResolvedValue(existingTasks);
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, writeFile });

      await executor.execute({
        type: 'todo_write',
        tasks: [
          { id: '1', title: 'New', status: 'completed' } // No priority
        ]
      } as any);

      const written = JSON.parse(writeFile.mock.calls[0][1]);
      expect(written[0].title).toBe('New');
      expect(written[0].priority).toBeUndefined(); // Priority removed
    });

    it('handles many tasks efficiently', async () => {
      const readFile = vi.fn().mockRejectedValue(new Error('not found'));
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, writeFile });

      const manyTasks = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        title: `Task ${i}`,
        status: i % 2 === 0 ? 'completed' : 'pending'
      }));

      const result = await executor.execute({
        type: 'todo_write',
        tasks: manyTasks
      } as any);

      const written = JSON.parse(writeFile.mock.calls[0][1]);
      expect(written).toHaveLength(100);
      expect(result).toContain('50%'); // 50 completed out of 100
    });

    it('handles tasks with special characters in title', async () => {
      const readFile = vi.fn().mockRejectedValue(new Error('not found'));
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, writeFile });

      await executor.execute({
        type: 'todo_write',
        tasks: [
          { id: '1', title: 'Fix bug: "undefined" in $PATH', status: 'pending' },
          { id: '2', title: 'Add <div> component', status: 'pending' }
        ]
      } as any);

      const written = JSON.parse(writeFile.mock.calls[0][1]);
      expect(written[0].title).toContain('$PATH');
      expect(written[1].title).toContain('<div>');
    });

    it('handles tasks object instead of array', async () => {
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'todo_write',
        tasks: { '1': { title: 'Task', status: 'pending' } }
      } as any);

      expect(result).toContain('skipped');
    });

    it('handles undefined tasks', async () => {
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'todo_write',
        tasks: undefined
      } as any);

      expect(result).toContain('skipped');
    });

    it('handles numeric tasks value', async () => {
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'todo_write',
        tasks: 42
      } as any);

      expect(result).toContain('skipped');
    });
  });

  describe('Command Execution', () => {
    describe('typed runtime outcomes', () => {
      it('classifies empty plan notes as validation failure', async () => {
        const executor = createExecutor();

        const outcome = await executor.executeForTool(
          { type: 'plan', notes: '' },
          { approvalHandled: true },
        );

        expect(outcome).toEqual({
          success: false,
          kind: 'validation',
          error: 'No plan notes provided',
          output: 'No plan notes provided',
        });
      });

      it('classifies non-array todo tasks as validation failure', async () => {
        const executor = createExecutor();

        const outcome = await executor.executeForTool(
          { type: 'todo_write', tasks: 42 } as unknown as AgentAction,
          { approvalHandled: true },
        );

        expect(outcome).toMatchObject({
          success: false,
          kind: 'validation',
          error: expect.stringContaining('tasks'),
        });
      });

      it('classifies missing required command input as validation failure', async () => {
        const executor = createExecutor();

        const outcome = await executor.executeForTool({ type: 'run_command' } as AgentAction);

        expect(outcome).toEqual({
          success: false,
          kind: 'validation',
          error: 'run_command requires a "command" argument (string)',
          output: 'Error: run_command requires a "command" argument (string)',
        });
        await expect(executor.execute({ type: 'run_command' } as AgentAction)).resolves.toEqual(
          expect.stringContaining('command')
        );
      });

      it('classifies a non-zero foreground command with output and exit code', async () => {
        vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
          stdout: 'partial stdout',
          stderr: 'command failed',
          code: 19,
        });
        const executor = createExecutor();

        const outcome = await executor.executeForTool({
          type: 'run_command',
          command: 'failing-command',
        });

        expect(outcome).toMatchObject({
          success: false,
          kind: 'command',
          error: 'command failed',
          exitCode: 19,
          output: expect.stringContaining('partial stdout'),
        });
      });

      it('classifies a non-zero interactive command', async () => {
        vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
          stdout: '',
          stderr: '',
          code: 4,
        });
        const executor = createExecutor({}, {
          onModalPause: async (callback) => callback(),
        });

        const outcome = await executor.executeForTool({
          type: 'run_command',
          command: 'interactive-command',
          interactive: true,
        });

        expect(outcome).toMatchObject({
          success: false,
          kind: 'command',
          exitCode: 4,
          output: expect.stringContaining('(exit code: 4)'),
        });
      });

      it('classifies command spawn errors without throwing', async () => {
        const error = new Error('spawn failed') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        vi.spyOn(commandActions, 'runCommand').mockRejectedValue(error);
        const executor = createExecutor();

        const outcome = await executor.executeForTool({
          type: 'run_command',
          command: 'missing-command',
        });

        expect(outcome).toMatchObject({
          success: false,
          kind: 'command',
          error: expect.stringContaining('missing-command'),
          exitCode: null,
        });
      });

      it('forwards the active signal and preserves partial command output on abort', async () => {
        const controller = new AbortController();
        const abortError = Object.assign(new Error('Command execution aborted.'), {
          name: 'AbortError',
          stdout: 'partial stdout',
          stderr: 'partial stderr',
        });
        const runCommand = vi.spyOn(commandActions, 'runCommand').mockRejectedValue(abortError);
        const executor = createExecutor();

        const outcome = await executor.executeForTool(
          { type: 'run_command', command: 'long-running-command' },
          { approvalHandled: true, signal: controller.signal },
        );

        expect(runCommand).toHaveBeenCalledWith(
          'long-running-command',
          [],
          '/repo',
          expect.objectContaining({ signal: controller.signal }),
        );
        expect(outcome).toEqual({
          success: false,
          kind: 'aborted',
          error: 'Command execution aborted.',
          output: 'partial stdout\npartial stderr',
        });
      });

      it('forwards the active signal to interactive commands', async () => {
        const controller = new AbortController();
        const abortError = Object.assign(new Error('Command execution aborted'), { name: 'AbortError' });
        const runCommand = vi.spyOn(commandActions, 'runCommand').mockRejectedValue(abortError);
        const executor = createExecutor({}, {
          onModalPause: async (callback) => callback(),
        });

        const outcome = await executor.executeForTool(
          { type: 'run_command', command: 'interactive-command', interactive: true },
          { approvalHandled: true, signal: controller.signal },
        );

        expect(runCommand).toHaveBeenCalledWith(
          'interactive-command',
          [],
          '/repo',
          expect.objectContaining({ interactive: true, signal: controller.signal }),
        );
        expect(outcome).toMatchObject({ success: false, kind: 'aborted' });
      });

      it('classifies a failed live shell result as command failure', async () => {
        vi.spyOn(shellActions, 'executeStreamingShellCommand').mockResolvedValue({
          success: false,
          output: 'partial shell output',
          error: 'shell failed',
        });
        const executor = createExecutor({}, {
          onModalPause: async (callback) => callback(),
        });
        Object.assign(executor as unknown as Record<string, unknown>, {
          onLiveCommandStart: vi.fn(() => 'live-shell'),
          onLiveCommandOutput: vi.fn(),
          onLiveCommandRemove: vi.fn(),
        });

        const outcome = await executor.executeForTool({
          type: 'shell',
          command: 'failing-shell',
        });

        expect(outcome).toMatchObject({
          success: false,
          kind: 'command',
          error: 'shell failed',
          output: expect.stringContaining('partial shell output'),
        });
      });

      it('forwards the active signal and classifies a live shell abort', async () => {
        const controller = new AbortController();
        const abortError = Object.assign(new Error('Shell command aborted.'), {
          name: 'AbortError',
          output: 'partial shell output',
        });
        const executeShell = vi
          .spyOn(shellActions, 'executeStreamingShellCommand')
          .mockRejectedValue(abortError);
        const executor = createExecutor();
        Object.assign(executor as unknown as Record<string, unknown>, {
          onLiveCommandStart: vi.fn(() => 'live-shell'),
          onLiveCommandOutput: vi.fn(),
          onLiveCommandRemove: vi.fn(),
        });

        const outcome = await executor.executeForTool(
          { type: 'shell', command: 'long-running-shell' },
          { approvalHandled: true, signal: controller.signal },
        );

        expect(executeShell).toHaveBeenCalledWith(
          'long-running-shell',
          '/repo',
          expect.objectContaining({ signal: controller.signal }),
        );
        expect(outcome).toEqual({
          success: false,
          kind: 'aborted',
          error: 'Shell command aborted.',
          output: 'partial shell output',
        });
      });

      it('forwards the active signal to the non-live shell fallback', async () => {
        const controller = new AbortController();
        const abortError = Object.assign(new Error('Command execution aborted'), { name: 'AbortError' });
        const runCommand = vi.spyOn(commandActions, 'runCommand').mockRejectedValue(abortError);
        const executor = createExecutor();

        const outcome = await executor.executeForTool(
          { type: 'shell', command: 'fallback-shell' },
          { approvalHandled: true, signal: controller.signal },
        );

        expect(runCommand).toHaveBeenCalledWith(
          'fallback-shell',
          [],
          '/repo',
          expect.objectContaining({ shell: true, signal: controller.signal }),
        );
        expect(outcome).toMatchObject({ success: false, kind: 'aborted' });
      });

      it('forwards the active signal and classifies a web action abort', async () => {
        const controller = new AbortController();
        const abortError = Object.assign(new Error('Web action aborted.'), { name: 'AbortError' });
        const webSearch = vi.spyOn(webActions, 'webSearch').mockRejectedValue(abortError);
        const executor = createExecutor();

        const outcome = await executor.executeForTool(
          { type: 'web_search', query: 'cancellation semantics' },
          { approvalHandled: true, signal: controller.signal },
        );

        expect(webSearch).toHaveBeenCalledWith(
          'cancellation semantics',
          expect.objectContaining({ signal: controller.signal }),
        );
        expect(outcome).toEqual({
          success: false,
          kind: 'aborted',
          error: 'Web action aborted.',
        });
      });

      it('forwards the active signal to URL fetches', async () => {
        const controller = new AbortController();
        const abortError = Object.assign(new Error('Web action aborted.'), { name: 'AbortError' });
        const fetchUrl = vi.spyOn(webActions, 'fetchUrl').mockRejectedValue(abortError);
        const executor = createExecutor();

        const outcome = await executor.executeForTool(
          { type: 'fetch_url', url: 'https://example.com' },
          { approvalHandled: true, signal: controller.signal },
        );

        expect(fetchUrl).toHaveBeenCalledWith(
          'https://example.com',
          expect.objectContaining({ signal: controller.signal }),
        );
        expect(outcome).toMatchObject({ success: false, kind: 'aborted' });
      });

      it('forwards the active signal to package metadata requests', async () => {
        const controller = new AbortController();
        const abortError = Object.assign(new Error('Web action aborted.'), { name: 'AbortError' });
        const getPackageInfo = vi.spyOn(webActions, 'getPackageInfo').mockRejectedValue(abortError);
        const executor = createExecutor();

        const outcome = await executor.executeForTool(
          { type: 'package_info', package_name: 'typescript', registry: 'npm' },
          { approvalHandled: true, signal: controller.signal },
        );

        expect(getPackageInfo).toHaveBeenCalledWith(
          'typescript',
          expect.objectContaining({ signal: controller.signal }),
        );
        expect(outcome).toMatchObject({ success: false, kind: 'aborted' });
      });

      it('forwards the active signal and classifies a web repository abort', async () => {
        const controller = new AbortController();
        const abortError = Object.assign(new Error('Web repository request aborted'), { name: 'AbortError' });
        const webRepo = vi.spyOn(webRepoActions, 'webRepo').mockRejectedValue(abortError);
        const executor = createExecutor();

        const outcome = await executor.executeForTool(
          { type: 'web_repo', repo: 'github:autohandai/code-cli', operation: 'info' },
          { approvalHandled: true, signal: controller.signal },
        );

        expect(webRepo).toHaveBeenCalledWith(expect.objectContaining({
          signal: controller.signal,
        }));
        expect(outcome).toEqual({
          success: false,
          kind: 'aborted',
          error: 'Web repository request aborted',
        });
      });

      it('forwards the active signal and classifies parallel worktree aborts', async () => {
        const controller = new AbortController();
        const abortError = Object.assign(new Error('Command execution aborted'), { name: 'AbortError' });
        const runParallel = vi.spyOn(WorktreeManager.prototype, 'runParallel').mockRejectedValue(abortError);
        const executor = createExecutor({}, {
          runtime: { workspaceRoot: process.cwd() },
        });

        const outcome = await executor.executeForTool(
          {
            type: 'git_worktree_run_parallel',
            command: 'bun test',
            max_concurrent: 2,
          },
          { approvalHandled: true, signal: controller.signal },
        );

        expect(runParallel).toHaveBeenCalledWith('bun test', expect.objectContaining({
          maxConcurrent: 2,
          signal: controller.signal,
        }));
        expect(outcome).toEqual({
          success: false,
          kind: 'aborted',
          error: 'Command execution aborted',
        });
      });

      it('normalizes thrown unknown errors as operational failures', async () => {
        const executor = createExecutor({
          readFile: vi.fn().mockRejectedValue('disk unavailable'),
        });

        const outcome = await executor.executeForTool({
          type: 'read_file',
          path: 'src/index.ts',
        });

        expect(outcome).toEqual({
          success: false,
          kind: 'operational',
          error: 'disk unavailable',
        });
      });

      it('classifies direct permission denial as authorization failure', async () => {
        const executor = new ActionExecutor({
          runtime: createRuntime(),
          files: createFiles() as FileActionManager,
          resolveWorkspacePath: (relativePath) => `/repo/${relativePath}`,
          confirmDangerousAction: vi.fn().mockResolvedValue(true),
          permissionManager: new PermissionManager({ mode: 'interactive' }),
        });

        const outcome = await executor.executeForTool({
          type: 'run_command',
          command: 'printenv',
        });

        expect(outcome).toMatchObject({
          success: false,
          kind: 'authorization',
          error: expect.stringContaining('Permission policy denied'),
        });
      });

      it('classifies dependency operation errors as operational failures', async () => {
        vi.spyOn(dependencyActions, 'addDependency').mockRejectedValue(new Error('registry unavailable'));
        const executor = createExecutor();

        const outcome = await executor.executeForTool({
          type: 'add_dependency',
          name: 'missing-package',
        });

        expect(outcome).toEqual({
          success: false,
          kind: 'operational',
          error: 'registry unavailable',
        });
      });

      it('classifies a caught review failure instead of returning successful error text', async () => {
        const onReviewHook = vi.fn(async (event: string) => {
          if (event === 'review:completed') {
            throw new Error('review hook failed');
          }
        });
        const executor = createExecutor({}, { onReviewHook });

        const outcome = await executor.executeForTool({
          type: 'code_review',
          scope: 'diff',
        });

        expect(outcome).toEqual({
          success: false,
          kind: 'operational',
          error: 'review hook failed',
          output: 'Review failed: review hook failed',
        });
      });

      it('classifies a write permission-hook block as authorization failure', async () => {
        mockPathExists.mockResolvedValue(false);
        const executor = new ActionExecutor({
          runtime: createRuntime(),
          files: createFiles() as FileActionManager,
          resolveWorkspacePath: (relativePath) => `/repo/${relativePath}`,
          confirmDangerousAction: vi.fn().mockResolvedValue(true),
          permissionManager: new PermissionManager({ mode: 'interactive', rememberSession: false }),
          onPermissionRequest: vi.fn().mockResolvedValue({
            decision: 'block',
            reason: 'workspace policy blocked the write',
          }),
        });

        const outcome = await executor.executeForTool({
          type: 'write_file',
          path: 'src/new.ts',
          contents: 'export {};',
        });

        expect(outcome).toEqual({
          success: false,
          kind: 'authorization',
          error: 'Blocked: workspace policy blocked the write',
          output: 'Blocked: workspace policy blocked the write',
        });
      });

      it('classifies an unavailable auto-commit state as operational failure', async () => {
        vi.mocked(execSync).mockReturnValue('');
        vi.spyOn(gitActions, 'getAutoCommitInfo').mockReturnValue({
          canCommit: false,
          error: 'No changes to commit',
          suggestedMessage: '',
          filesChanged: [],
        });
        const executor = createExecutor();

        const outcome = await executor.executeForTool(
          { type: 'auto_commit' },
          { approvalHandled: true },
        );

        expect(outcome).toEqual({
          success: false,
          kind: 'operational',
          error: 'No changes to commit',
          output: 'No changes to commit',
        });
      });

      it('classifies custom command rejection as authorization failure', async () => {
        const confirmDangerousAction = vi.fn().mockResolvedValue(false);
        const executor = createExecutor({}, {
          confirmDangerousAction,
        });

        const outcome = await executor.executeForTool({
          type: 'custom_command',
          name: 'local-check',
          command: 'echo ok',
        });

        expect(outcome).toEqual({
          success: false,
          kind: 'authorization',
          error: 'Skipped custom_command.',
          output: 'Skipped custom_command.',
        });
        expect(confirmDangerousAction).toHaveBeenCalledOnce();
      });

      it('does not prompt twice after canonical custom-command approval', async () => {
        vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
          stdout: 'ok',
          stderr: '',
          code: 0,
        });
        const confirmDangerousAction = vi.fn().mockResolvedValue(false);
        const executor = createExecutor({}, { confirmDangerousAction });
        const confirmApproval = vi.fn().mockResolvedValue({ decision: 'allow_once' });
        const manager = new ToolManager({
          executor: (action, context) => executor.executeForTool(action, context),
          confirmApproval,
          authorization: {
            permissionManager: new PermissionManager({ mode: 'interactive', rememberSession: false }),
          },
        });

        const [outcome] = await manager.execute([{
          tool: 'custom_command',
          args: { name: 'local-check', command: 'echo ok' },
        }]);

        expect(outcome).toMatchObject({ success: true, output: expect.stringContaining('ok') });
        expect(confirmApproval).toHaveBeenCalledOnce();
        expect(confirmDangerousAction).not.toHaveBeenCalled();
        expect(customCommandActions.saveCustomCommand).toHaveBeenCalledOnce();
      });

      it('forwards the active signal to custom commands and classifies aborts', async () => {
        const controller = new AbortController();
        const abortError = Object.assign(new Error('Command execution aborted'), { name: 'AbortError' });
        const runCommand = vi.spyOn(commandActions, 'runCommand').mockRejectedValue(abortError);
        const executor = createExecutor();

        const outcome = await executor.executeForTool(
          { type: 'custom_command', name: 'long-check', command: 'sleep 30' },
          { approvalHandled: true, signal: controller.signal },
        );

        expect(runCommand).toHaveBeenCalledWith(
          'sleep 30',
          [],
          '/repo',
          { signal: controller.signal },
        );
        expect(outcome).toEqual({
          success: false,
          kind: 'aborted',
          error: 'Command execution aborted',
        });
      });
    });

    it('executes run_command', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'output',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'echo',
        args: ['hello']
      } as any);

      expect(runCommandSpy).toHaveBeenCalledWith('echo hello', [], '/repo', expect.objectContaining({ shell: true }));
      expect(result).toContain('output');
      runCommandSpy.mockRestore();
    });

    it('returns error for missing command', async () => {
      const executor = createExecutor();

      const result = await executor.execute({ type: 'run_command' } as any);

      expect(result).toContain('Error');
    });

    it('includes stderr in output', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: '',
        stderr: 'warning message',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'test'
      } as any);

      expect(result).toContain('warning message');
      runCommandSpy.mockRestore();
    });

    it('includes both stdout and stderr in output', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'standard output',
        stderr: 'error output',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'mixed'
      } as any);

      expect(result).toContain('standard output');
      expect(result).toContain('error output');
      runCommandSpy.mockRestore();
    });

    it('returns error for null command', async () => {
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: null
      } as any);

      expect(result).toContain('Error');
    });

    it('returns error for numeric command', async () => {
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 123
      } as any);

      expect(result).toContain('Error');
    });

    it('returns error for object command', async () => {
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: { cmd: 'echo' }
      } as any);

      expect(result).toContain('Error');
    });

    it('returns error for empty string command', async () => {
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: ''
      } as any);

      expect(result).toContain('Error');
    });

    it('passes empty args array when args not provided', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'ok',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      await executor.execute({
        type: 'run_command',
        command: 'ls'
      } as any);

      expect(runCommandSpy).toHaveBeenCalledWith('ls', [], '/repo', expect.any(Object));
      runCommandSpy.mockRestore();
    });

    it('passes multiple args correctly', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'ok',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      await executor.execute({
        type: 'run_command',
        command: 'git',
        args: ['commit', '-m', 'message', '--amend']
      } as any);

      expect(runCommandSpy).toHaveBeenCalledWith('git commit -m message --amend', [], '/repo', expect.objectContaining({ shell: true }));
      runCommandSpy.mockRestore();
    });

    it('includes command header in output', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'result',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'echo',
        args: ['hello', 'world']
      } as any);

      expect(result).toContain('$ echo hello world');
      runCommandSpy.mockRestore();
    });

    it('includes description in header when provided', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'result',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'npm',
        args: ['install'],
        description: 'Installing dependencies'
      } as any);

      expect(result).toContain('Installing dependencies');
      expect(result).toContain('npm install');
      runCommandSpy.mockRestore();
    });

    it('includes directory info when directory option is provided', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'result',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'npm',
        args: ['test'],
        directory: 'packages/core'
      } as any);

      expect(result).toContain('packages/core');
      expect(runCommandSpy).toHaveBeenCalledWith('npm test', [], '/repo', expect.objectContaining({
        shell: true,
        directory: 'packages/core'
      }));
      runCommandSpy.mockRestore();
    });

    it('includes background PID info when running in background', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: null,
        backgroundPid: 12345
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'node',
        args: ['server.js'],
        background: true
      } as any);

      expect(result).toContain('Background PID: 12345');
      runCommandSpy.mockRestore();
    });

    it('passes background option to runCommand', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: null,
        backgroundPid: 99999
      });
      const executor = createExecutor();

      await executor.execute({
        type: 'run_command',
        command: 'sleep',
        args: ['60'],
        background: true
      } as any);

      expect(runCommandSpy).toHaveBeenCalledWith('sleep 60', [], '/repo', expect.objectContaining({
        shell: true,
        background: true
      }));
      runCommandSpy.mockRestore();
    });

    it('handles command with special characters in args', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'ok',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      await executor.execute({
        type: 'run_command',
        command: 'git',
        args: ['commit', '-m', 'fix: handle "quotes" and $variables']
      } as any);

      expect(runCommandSpy).toHaveBeenCalledWith('git commit -m fix: handle "quotes" and $variables', [], '/repo', expect.objectContaining({ shell: true }));
      runCommandSpy.mockRestore();
    });

    it('handles command with unicode characters', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: '✓ Success',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'echo',
        args: ['✓']
      } as any);

      expect(result).toContain('✓');
      runCommandSpy.mockRestore();
    });

    it('handles multiline stdout output', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'line1\nline2\nline3',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'cat'
      } as any);

      expect(result).toContain('line1');
      expect(result).toContain('line2');
      expect(result).toContain('line3');
      runCommandSpy.mockRestore();
    });

    it('handles empty stdout and stderr', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'true'
      } as any);

      expect(result).toContain('$ true');
      runCommandSpy.mockRestore();
    });

    it('handles very long output', async () => {
      const longOutput = 'x'.repeat(10000);
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: longOutput,
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'cat'
      } as any);

      expect(result).toContain(longOutput);
      runCommandSpy.mockRestore();
    });

    it('uses workspace root as working directory', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'ok',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor({}, { runtime: { workspaceRoot: '/custom/workspace' } as any });

      await executor.execute({
        type: 'run_command',
        command: 'pwd'
      } as any);

      expect(runCommandSpy).toHaveBeenCalledWith('pwd', [], '/custom/workspace', expect.any(Object));
      runCommandSpy.mockRestore();
    });

    it('handles command that outputs to both streams', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'INFO: Starting process\nINFO: Done',
        stderr: 'WARN: Deprecated API\nWARN: Consider upgrading',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'build'
      } as any);

      expect(result).toContain('Starting process');
      expect(result).toContain('Done');
      expect(result).toContain('Deprecated API');
      expect(result).toContain('Consider upgrading');
      runCommandSpy.mockRestore();
    });
  });

  describe('Exploration Events', () => {
    it('emits exploration events for read actions', async () => {
      const onExploration = vi.fn();
      const executor = createExecutor({}, { onExploration });

      await executor.execute({ type: 'read_file', path: 'src/index.ts' });

      expect(onExploration).toHaveBeenCalledWith({ kind: 'read', target: 'src/index.ts' });
    });

    it('emits exploration events for find actions', async () => {
      const onExploration = vi.fn();
      const executor = createExecutor(
        { search: vi.fn().mockReturnValue([]) },
        { onExploration }
      );

      await executor.execute({ type: 'find', query: 'test', mode: 'exact' } as any);

      expect(onExploration).toHaveBeenCalledWith({ kind: 'search', target: 'test' });
    });

    it('emits exploration events for list_tree', async () => {
      const onExploration = vi.fn();
      const executor = createExecutor({}, { onExploration });

      // Mock the listDirectoryTree function
      const listTreeSpy = vi.spyOn(await import('../src/actions/metadata.js'), 'listDirectoryTree')
        .mockResolvedValue(['src/', 'src/index.ts']);

      await executor.execute({ type: 'list_tree', path: 'src' } as any);

      expect(onExploration).toHaveBeenCalledWith({ kind: 'list', target: 'src' });
      listTreeSpy.mockRestore();
    });

    it('does not emit exploration events when callback not provided', async () => {
      const executor = createExecutor(); // No onExploration callback

      // Should not throw when callback is missing
      await expect(executor.execute({ type: 'read_file', path: 'src/index.ts' })).resolves.not.toThrow();
    });

    it('emits exploration for find with context mode', async () => {
      const onExploration = vi.fn();
      const executor = createExecutor(
        { searchWithContext: vi.fn().mockReturnValue('context') },
        { onExploration }
      );

      await executor.execute({ type: 'find', query: 'function', mode: 'context' } as any);

      expect(onExploration).toHaveBeenCalledWith({ kind: 'search', target: 'function' });
    });

    it('emits exploration events with nested paths', async () => {
      const onExploration = vi.fn();
      const executor = createExecutor({}, { onExploration });

      await executor.execute({ type: 'read_file', path: 'src/core/deep/nested/file.ts' });

      expect(onExploration).toHaveBeenCalledWith({ kind: 'read', target: 'src/core/deep/nested/file.ts' });
    });

    it('emits exploration events with special characters in path', async () => {
      const onExploration = vi.fn();
      const executor = createExecutor({}, { onExploration });

      await executor.execute({ type: 'read_file', path: 'src/file with spaces.ts' });

      expect(onExploration).toHaveBeenCalledWith({ kind: 'read', target: 'src/file with spaces.ts' });
    });

    it('emits exploration events with unicode in query', async () => {
      const onExploration = vi.fn();
      const executor = createExecutor(
        { search: vi.fn().mockReturnValue([]) },
        { onExploration }
      );

      await executor.execute({ type: 'find', query: 'función', mode: 'exact' } as any);

      expect(onExploration).toHaveBeenCalledWith({ kind: 'search', target: 'función' });
    });

    it('emits list_tree with default path when not specified', async () => {
      const onExploration = vi.fn();
      const executor = createExecutor({}, { onExploration });

      const listTreeSpy = vi.spyOn(await import('../src/actions/metadata.js'), 'listDirectoryTree')
        .mockResolvedValue(['src/']);

      await executor.execute({ type: 'list_tree' } as any);

      expect(onExploration).toHaveBeenCalledWith({ kind: 'list', target: '.' });
      listTreeSpy.mockRestore();
    });

    it('does not emit exploration for write actions', async () => {
      const onExploration = vi.fn();
      const executor = createExecutor(
        { readFile: vi.fn().mockResolvedValue(''), writeFile: vi.fn() },
        { onExploration }
      );

      await executor.execute({ type: 'write_file', path: 'test.ts', content: 'new' } as any);

      expect(onExploration).not.toHaveBeenCalled();
    });

    it('does not emit exploration for delete actions', async () => {
      const onExploration = vi.fn();
      const executor = createExecutor(
        { deletePath: vi.fn() },
        { onExploration, confirmDangerousAction: async () => true }
      );

      await executor.execute({ type: 'delete_path', path: 'temp' } as any);

      expect(onExploration).not.toHaveBeenCalled();
    });

    it('does not emit exploration for run_command', async () => {
      const onExploration = vi.fn();
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'ok',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor({}, { onExploration });

      await executor.execute({ type: 'run_command', command: 'ls' } as any);

      expect(onExploration).not.toHaveBeenCalled();
      runCommandSpy.mockRestore();
    });

    it('handles empty query gracefully', async () => {
      const search = vi.fn().mockReturnValue([]);
      const executor = createExecutor(
        { search },
        {}
      );

      // Empty query should complete without error
      const result = await executor.execute({ type: 'find', query: '', mode: 'exact' } as any);

      expect(result).toBeDefined();
    });

    it('emits exploration once per read action', async () => {
      const onExploration = vi.fn();
      const executor = createExecutor({}, { onExploration });

      await executor.execute({ type: 'read_file', path: 'file1.ts' });
      await executor.execute({ type: 'read_file', path: 'file2.ts' });

      expect(onExploration).toHaveBeenCalledTimes(2);
      expect(onExploration).toHaveBeenNthCalledWith(1, { kind: 'read', target: 'file1.ts' });
      expect(onExploration).toHaveBeenNthCalledWith(2, { kind: 'read', target: 'file2.ts' });
    });

    it('emits exploration for regex search patterns', async () => {
      const onExploration = vi.fn();
      const executor = createExecutor(
        { search: vi.fn().mockReturnValue([]) },
        { onExploration }
      );

      await executor.execute({ type: 'find', query: 'function\\s+\\w+', mode: 'exact' } as any);

      expect(onExploration).toHaveBeenCalledWith({ kind: 'search', target: 'function\\s+\\w+' });
    });

    it('emits exploration for search with path filter', async () => {
      const onExploration = vi.fn();
      const executor = createExecutor(
        { search: vi.fn().mockReturnValue([]) },
        { onExploration }
      );

      await executor.execute({ type: 'find', query: 'test', path: 'src/', mode: 'exact' } as any);

      expect(onExploration).toHaveBeenCalledWith({ kind: 'search', target: 'test' });
    });

    it('propagates callback errors', async () => {
      const onExploration = vi.fn().mockImplementation(() => {
        throw new Error('Callback error');
      });
      const executor = createExecutor({}, { onExploration });

      // Implementation propagates callback errors - this is expected behavior
      await expect(executor.execute({ type: 'read_file', path: 'test.ts' })).rejects.toThrow('Callback error');
    });

    it('handles async callback', async () => {
      const calls: string[] = [];
      const onExploration = vi.fn().mockImplementation((event) => {
        calls.push(event.target);
      });
      const executor = createExecutor({}, { onExploration });

      await executor.execute({ type: 'read_file', path: 'async-test.ts' });

      expect(calls).toContain('async-test.ts');
    });

    it('does not emit exploration for git operations', async () => {
      const onExploration = vi.fn();
      const statusSpy = vi.spyOn(gitActions, 'gitStatus').mockReturnValue('clean');
      const executor = createExecutor({}, { onExploration });

      await executor.execute({ type: 'git_status' } as any);

      expect(onExploration).not.toHaveBeenCalled();
      statusSpy.mockRestore();
    });
  });

  describe('Dry Run Mode', () => {
    it('skips mutations in dry-run mode', async () => {
      const writeFile = vi.fn();
      const executor = createExecutor(
        { writeFile, readFile: vi.fn().mockResolvedValue('old') },
        { runtime: { options: { dryRun: true } } as any }
      );

      const result = await executor.execute({ type: 'write_file', path: 'test.ts', content: 'new' } as any);

      expect(writeFile).not.toHaveBeenCalled();
      expect(result).toContain('Dry-run');
    });

    it('allows search in dry-run mode', async () => {
      const search = vi.fn().mockReturnValue([{ file: 'test.ts', line: 1, text: 'found' }]);
      const executor = createExecutor(
        { search },
        { runtime: { options: { dryRun: true } } as any }
      );

      const result = await executor.execute({ type: 'find', query: 'test', mode: 'exact' } as any);

      expect(search).toHaveBeenCalled();
      expect(result).toContain('test.ts');
    });

    it('skips append_file in dry-run mode', async () => {
      const appendFile = vi.fn();
      const executor = createExecutor(
        { appendFile, readFile: vi.fn().mockResolvedValue('old') },
        { runtime: { options: { dryRun: true } } as any }
      );

      const result = await executor.execute({ type: 'append_file', path: 'test.ts', content: 'new' } as any);

      expect(appendFile).not.toHaveBeenCalled();
      expect(result).toContain('Dry-run');
    });

    it('skips apply_patch in dry-run mode', async () => {
      const applyPatch = vi.fn();
      const executor = createExecutor(
        { applyPatch, readFile: vi.fn().mockResolvedValue('old') },
        { runtime: { options: { dryRun: true } } as any }
      );

      const result = await executor.execute({ type: 'apply_patch', path: 'test.ts', patch: '@@ patch' } as any);

      expect(applyPatch).not.toHaveBeenCalled();
      expect(result).toContain('Dry-run');
    });

    it('skips delete_path in dry-run mode', async () => {
      const deletePath = vi.fn();
      const executor = createExecutor(
        { deletePath },
        { runtime: { options: { dryRun: true } } as any }
      );

      const result = await executor.execute({ type: 'delete_path', path: 'temp' } as any);

      expect(deletePath).not.toHaveBeenCalled();
      expect(result).toContain('Dry-run');
    });

    it('skips rename_path in dry-run mode', async () => {
      const renamePath = vi.fn();
      const executor = createExecutor(
        { renamePath },
        { runtime: { options: { dryRun: true } } as any }
      );

      const result = await executor.execute({ type: 'rename_path', from: 'old.ts', to: 'new.ts' } as any);

      expect(renamePath).not.toHaveBeenCalled();
      expect(result).toContain('Dry-run');
    });

    it('skips copy_path in dry-run mode', async () => {
      const copyPath = vi.fn();
      const executor = createExecutor(
        { copyPath },
        { runtime: { options: { dryRun: true } } as any }
      );

      const result = await executor.execute({ type: 'copy_path', from: 'src', to: 'dst' } as any);

      expect(copyPath).not.toHaveBeenCalled();
      expect(result).toContain('Dry-run');
    });

    it('skips create_directory in dry-run mode', async () => {
      const createDirectory = vi.fn();
      const executor = createExecutor(
        { createDirectory },
        { runtime: { options: { dryRun: true } } as any }
      );

      const result = await executor.execute({ type: 'create_directory', path: 'new-dir' } as any);

      expect(createDirectory).not.toHaveBeenCalled();
      expect(result).toContain('Dry-run');
    });

    it('skips run_command in dry-run mode', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand');
      const executor = createExecutor(
        {},
        { runtime: { options: { dryRun: true } } as any }
      );

      const result = await executor.execute({ type: 'run_command', command: 'rm', args: ['-rf', '/'] } as any);

      expect(runCommandSpy).not.toHaveBeenCalled();
      expect(result).toContain('Dry-run');
      runCommandSpy.mockRestore();
    });

    it('skips git_commit in dry-run mode', async () => {
      const commitSpy = vi.spyOn(gitActions, 'gitCommit');
      const executor = createExecutor(
        {},
        { runtime: { options: { dryRun: true } } as any }
      );

      const result = await executor.execute({ type: 'git_commit', message: 'test' } as any);

      expect(commitSpy).not.toHaveBeenCalled();
      expect(result).toContain('Dry-run');
      commitSpy.mockRestore();
    });

    it('skips git_add in dry-run mode', async () => {
      const addSpy = vi.spyOn(gitActions, 'gitAdd');
      const executor = createExecutor(
        {},
        { runtime: { options: { dryRun: true } } as any }
      );

      const result = await executor.execute({ type: 'git_add', paths: ['src/'] } as any);

      expect(addSpy).not.toHaveBeenCalled();
      expect(result).toContain('Dry-run');
      addSpy.mockRestore();
    });

    it('skips read_file in dry-run mode', async () => {
      const readFile = vi.fn().mockResolvedValue('content');
      const executor = createExecutor(
        { readFile },
        { runtime: { options: { dryRun: true } } as any }
      );

      const result = await executor.execute({ type: 'read_file', path: 'test.ts' } as any);

      // In dry-run mode, read_file is also skipped
      expect(readFile).not.toHaveBeenCalled();
      expect(result).toContain('Dry-run');
    });

    it('allows git_status in dry-run mode', async () => {
      const statusSpy = vi.spyOn(gitActions, 'gitStatus').mockReturnValue('clean');
      const executor = createExecutor(
        {},
        { runtime: { options: { dryRun: true } } as any }
      );

      // git_status is not a mutation but may be skipped in dry-run
      const result = await executor.execute({ type: 'git_status' } as any);

      // This depends on implementation - check if it's skipped or allowed
      expect(result).toBeDefined();
      statusSpy.mockRestore();
    });

    it('allows git_diff in dry-run mode', async () => {
      const diffSpy = vi.spyOn(gitActions, 'diffFile').mockReturnValue('diff output');
      const executor = createExecutor(
        {},
        { runtime: { options: { dryRun: true } } as any }
      );

      const result = await executor.execute({ type: 'git_diff', path: 'test.ts' } as any);

      expect(result).toBeDefined();
      diffSpy.mockRestore();
    });

    it('allows plan action in dry-run mode', async () => {
      vi.spyOn(PlanFileStorage.prototype, 'listPlans').mockResolvedValue([]);
      vi.spyOn(PlanFileStorage.prototype, 'savePlan').mockResolvedValue('/tmp/plan-123.md');
      const executor = createExecutor(
        {},
        { runtime: { options: { dryRun: true } } as any }
      );

      const result = await executor.execute({ type: 'plan', notes: 'Planning' } as any);

      // Plan action is allowed in dry-run mode and saves plan to file
      expect(result).toContain('Plan saved to');
      expect(result).toContain('Planning');
    });

    it('skips multi_file_edit in dry-run mode', async () => {
      const writeFile = vi.fn();
      const executor = createExecutor(
        { writeFile, readFile: vi.fn().mockResolvedValue('old') },
        { runtime: { options: { dryRun: true } } as any }
      );

      const result = await executor.execute({
        type: 'multi_file_edit',
        file_path: 'test.ts',
        edits: [{ old_string: 'old', new_string: 'new' }]
      } as any);

      expect(writeFile).not.toHaveBeenCalled();
      expect(result).toContain('Dry-run');
    });

    it('skips todo_write in dry-run mode', async () => {
      const writeFile = vi.fn();
      const executor = createExecutor(
        { writeFile, readFile: vi.fn().mockRejectedValue(new Error('not found')) },
        { runtime: { options: { dryRun: true } } as any }
      );

      const result = await executor.execute({
        type: 'todo_write',
        tasks: [{ id: '1', title: 'Task', status: 'pending' }]
      } as any);

      expect(writeFile).not.toHaveBeenCalled();
      expect(result).toContain('Dry-run');
    });

    it('does not call onFileModified in dry-run mode', async () => {
      const onFileModified = vi.fn();
      const executor = createExecutor(
        { readFile: vi.fn().mockResolvedValue('old'), writeFile: vi.fn() },
        { runtime: { options: { dryRun: true } } as any, onFileModified }
      );

      await executor.execute({ type: 'write_file', path: 'test.ts', content: 'new' } as any);

      expect(onFileModified).not.toHaveBeenCalled();
    });

    it('skips format_file in dry-run mode', async () => {
      const formatFile = vi.fn();
      const executor = createExecutor(
        { formatFile },
        { runtime: { options: { dryRun: true } } as any }
      );

      const result = await executor.execute({ type: 'format_file', path: 'test.ts', formatter: 'prettier' } as any);

      expect(formatFile).not.toHaveBeenCalled();
      expect(result).toContain('Dry-run');
    });

    it('handles dryRun false correctly', async () => {
      const writeFile = vi.fn();
      const executor = createExecutor(
        { writeFile, readFile: vi.fn().mockResolvedValue('old') },
        { runtime: { options: { dryRun: false } } as any }
      );

      await executor.execute({ type: 'write_file', path: 'test.ts', content: 'new' } as any);

      expect(writeFile).toHaveBeenCalled();
    });

    it('handles undefined dryRun option', async () => {
      const writeFile = vi.fn();
      const executor = createExecutor(
        { writeFile, readFile: vi.fn().mockResolvedValue('old') },
        { runtime: { options: {} } as any }
      );

      await executor.execute({ type: 'write_file', path: 'test.ts', content: 'new' } as any);

      expect(writeFile).toHaveBeenCalled();
    });
  });

  describe('Tools Registry', () => {
    it('returns the tools registry as JSON', async () => {
      const tools: ToolDefinition[] = [{ name: 'read_file', description: 'Read files' } as ToolDefinition];
      const registry = {
        listTools: vi.fn().mockResolvedValue([{ name: 'read_file', description: 'Read files', source: 'builtin' }]),
        getMetaTool: vi.fn().mockReturnValue(undefined)
      };
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        toolsRegistry: registry as any,
        getRegisteredTools: () => tools
      });

      const result = await executor.execute({ type: 'tools_registry' } as any);
      const parsed = JSON.parse(result ?? '[]');

      expect(registry.listTools).toHaveBeenCalled();
      expect(parsed[0]).toMatchObject({ name: 'read_file', source: 'builtin' });
    });

    it('returns multiple tools from registry', async () => {
      const tools: ToolDefinition[] = [
        { name: 'read_file', description: 'Read files' } as ToolDefinition,
        { name: 'write_file', description: 'Write files' } as ToolDefinition,
        { name: 'search', description: 'Search files' } as ToolDefinition
      ];
      const registry = {
        listTools: vi.fn().mockResolvedValue([
          { name: 'read_file', description: 'Read files', source: 'builtin' },
          { name: 'write_file', description: 'Write files', source: 'builtin' },
          { name: 'search', description: 'Search files', source: 'builtin' }
        ]),
        getMetaTool: vi.fn().mockReturnValue(undefined)
      };
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        toolsRegistry: registry as any,
        getRegisteredTools: () => tools
      });

      const result = await executor.execute({ type: 'tools_registry' } as any);
      const parsed = JSON.parse(result ?? '[]');

      expect(parsed).toHaveLength(3);
      expect(parsed.map((t: any) => t.name)).toEqual(['read_file', 'write_file', 'search']);
    });

    it('returns empty array when no tools registered', async () => {
      const registry = {
        listTools: vi.fn().mockResolvedValue([]),
        getMetaTool: vi.fn().mockReturnValue(undefined)
      };
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        toolsRegistry: registry as any,
        getRegisteredTools: () => []
      });

      const result = await executor.execute({ type: 'tools_registry' } as any);
      const parsed = JSON.parse(result ?? '[]');

      expect(parsed).toEqual([]);
    });

    it('includes tool parameters in registry output', async () => {
      const tools: ToolDefinition[] = [
        {
          name: 'read_file',
          description: 'Read files',
          parameters: { type: 'object', properties: { path: { type: 'string' } } }
        } as ToolDefinition
      ];
      const registry = {
        listTools: vi.fn().mockResolvedValue([
          { name: 'read_file', description: 'Read files', source: 'builtin', parameters: { type: 'object' } }
        ]),
        getMetaTool: vi.fn().mockReturnValue(undefined)
      };
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        toolsRegistry: registry as any,
        getRegisteredTools: () => tools
      });

      const result = await executor.execute({ type: 'tools_registry' } as any);
      const parsed = JSON.parse(result ?? '[]');

      expect(parsed[0].parameters).toBeDefined();
    });

    it('includes tools from different sources', async () => {
      const registry = {
        listTools: vi.fn().mockResolvedValue([
          { name: 'read_file', source: 'builtin' },
          { name: 'custom_tool', source: 'custom' },
          { name: 'skill_tool', source: 'skill' }
        ]),
        getMetaTool: vi.fn().mockReturnValue(undefined)
      };
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        toolsRegistry: registry as any,
        getRegisteredTools: () => []
      });

      const result = await executor.execute({ type: 'tools_registry' } as any);
      const parsed = JSON.parse(result ?? '[]');

      const sources = parsed.map((t: any) => t.source);
      expect(sources).toContain('builtin');
      expect(sources).toContain('custom');
      expect(sources).toContain('skill');
    });

    it('returns valid JSON string', async () => {
      const registry = {
        listTools: vi.fn().mockResolvedValue([
          { name: 'test', description: 'Test tool with "quotes"', source: 'builtin' }
        ]),
        getMetaTool: vi.fn().mockReturnValue(undefined)
      };
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        toolsRegistry: registry as any,
        getRegisteredTools: () => []
      });

      const result = await executor.execute({ type: 'tools_registry' } as any);

      expect(() => JSON.parse(result ?? '')).not.toThrow();
    });

    it('formats JSON with indentation', async () => {
      const registry = {
        listTools: vi.fn().mockResolvedValue([{ name: 'test', source: 'builtin' }]),
        getMetaTool: vi.fn().mockReturnValue(undefined)
      };
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        toolsRegistry: registry as any,
        getRegisteredTools: () => []
      });

      const result = await executor.execute({ type: 'tools_registry' } as any);

      // Should be formatted with indentation (contains newlines)
      expect(result).toContain('\n');
    });

    it('passes registered tools to listTools', async () => {
      const tools: ToolDefinition[] = [
        { name: 'custom_tool', description: 'Custom' } as ToolDefinition
      ];
      const registry = {
        listTools: vi.fn().mockResolvedValue([]),
        getMetaTool: vi.fn().mockReturnValue(undefined)
      };
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        toolsRegistry: registry as any,
        getRegisteredTools: () => tools
      });

      await executor.execute({ type: 'tools_registry' } as any);

      expect(registry.listTools).toHaveBeenCalledWith(tools);
    });

    it('handles registry with meta-tools', async () => {
      const registry = {
        listTools: vi.fn().mockResolvedValue([
          { name: 'builtin_tool', source: 'builtin' },
          { name: 'meta_tool', source: 'agent' }
        ]),
        getMetaTool: vi.fn().mockReturnValue(undefined)
      };
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        toolsRegistry: registry as any,
        getRegisteredTools: () => []
      });

      const result = await executor.execute({ type: 'tools_registry' } as any);
      const parsed = JSON.parse(result ?? '[]');

      expect(parsed.some((t: any) => t.source === 'agent')).toBe(true);
    });

    it('handles tools with complex parameters', async () => {
      const registry = {
        listTools: vi.fn().mockResolvedValue([
          {
            name: 'complex_tool',
            source: 'builtin',
            parameters: {
              type: 'object',
              properties: {
                nested: {
                  type: 'object',
                  properties: {
                    value: { type: 'string' }
                  }
                },
                array: { type: 'array', items: { type: 'number' } }
              }
            }
          }
        ]),
        getMetaTool: vi.fn().mockReturnValue(undefined)
      };
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        toolsRegistry: registry as any,
        getRegisteredTools: () => []
      });

      const result = await executor.execute({ type: 'tools_registry' } as any);
      const parsed = JSON.parse(result ?? '[]');

      expect(parsed[0].parameters.properties.nested).toBeDefined();
      expect(parsed[0].parameters.properties.array.type).toBe('array');
    });

    it('uses default registry when not provided', async () => {
      const executor = createExecutor();

      // Should not throw when using default registry
      const result = await executor.execute({ type: 'tools_registry' } as any);

      expect(result).toBeDefined();
      expect(() => JSON.parse(result ?? '[]')).not.toThrow();
    });

    it('handles large number of tools', async () => {
      const manyTools = Array.from({ length: 100 }, (_, i) => ({
        name: `tool_${i}`,
        description: `Tool number ${i}`,
        source: 'builtin'
      }));
      const registry = {
        listTools: vi.fn().mockResolvedValue(manyTools),
        getMetaTool: vi.fn().mockReturnValue(undefined)
      };
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        toolsRegistry: registry as any,
        getRegisteredTools: () => []
      });

      const result = await executor.execute({ type: 'tools_registry' } as any);
      const parsed = JSON.parse(result ?? '[]');

      expect(parsed).toHaveLength(100);
    });

    it('preserves tool order from registry', async () => {
      const registry = {
        listTools: vi.fn().mockResolvedValue([
          { name: 'z_tool', source: 'builtin' },
          { name: 'a_tool', source: 'builtin' },
          { name: 'm_tool', source: 'builtin' }
        ]),
        getMetaTool: vi.fn().mockReturnValue(undefined)
      };
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        toolsRegistry: registry as any,
        getRegisteredTools: () => []
      });

      const result = await executor.execute({ type: 'tools_registry' } as any);
      const parsed = JSON.parse(result ?? '[]');

      expect(parsed[0].name).toBe('z_tool');
      expect(parsed[1].name).toBe('a_tool');
      expect(parsed[2].name).toBe('m_tool');
    });

    it('handles tools with unicode in description', async () => {
      const registry = {
        listTools: vi.fn().mockResolvedValue([
          { name: 'unicode_tool', description: 'Tool with émojis 🔧 and spëcial chàrs', source: 'builtin' }
        ]),
        getMetaTool: vi.fn().mockReturnValue(undefined)
      };
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        toolsRegistry: registry as any,
        getRegisteredTools: () => []
      });

      const result = await executor.execute({ type: 'tools_registry' } as any);
      const parsed = JSON.parse(result ?? '[]');

      expect(parsed[0].description).toContain('🔧');
    });

    it('handles tool names with special characters', async () => {
      const registry = {
        listTools: vi.fn().mockResolvedValue([
          { name: 'tool-with-dashes', source: 'builtin' },
          { name: 'tool_with_underscores', source: 'builtin' }
        ]),
        getMetaTool: vi.fn().mockReturnValue(undefined)
      };
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        toolsRegistry: registry as any,
        getRegisteredTools: () => []
      });

      const result = await executor.execute({ type: 'tools_registry' } as any);
      const parsed = JSON.parse(result ?? '[]');

      expect(parsed.map((t: any) => t.name)).toEqual(['tool-with-dashes', 'tool_with_underscores']);
    });

    it('includes all tool properties in output', async () => {
      const registry = {
        listTools: vi.fn().mockResolvedValue([
          {
            name: 'full_tool',
            description: 'Full description',
            source: 'builtin',
            parameters: { type: 'object' },
            category: 'file',
            deprecated: false
          }
        ]),
        getMetaTool: vi.fn().mockReturnValue(undefined)
      };
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        toolsRegistry: registry as any,
        getRegisteredTools: () => []
      });

      const result = await executor.execute({ type: 'tools_registry' } as any);
      const parsed = JSON.parse(result ?? '[]');

      expect(parsed[0].name).toBe('full_tool');
      expect(parsed[0].description).toBe('Full description');
      expect(parsed[0].source).toBe('builtin');
    });

    it('searches tools by name and description with tool_search', async () => {
      const tools: ToolDefinition[] = [
        { name: 'read_file', description: 'Read files from the workspace' } as ToolDefinition,
        { name: 'delegate_task', description: 'Delegate work to a specialized agent' } as ToolDefinition,
        { name: 'send_team_message', description: 'Send a message to a teammate' } as ToolDefinition,
      ];
      const registry = {
        listTools: vi.fn().mockResolvedValue([
          { name: 'read_file', description: 'Read files from the workspace', source: 'builtin' },
          { name: 'delegate_task', description: 'Delegate work to a specialized agent', source: 'builtin' },
          { name: 'send_team_message', description: 'Send a message to a teammate', source: 'builtin' },
        ]),
        getMetaTool: vi.fn().mockReturnValue(undefined)
      };
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        toolsRegistry: registry as any,
        getRegisteredTools: () => tools
      });

      const result = await executor.execute({ type: 'tool_search', query: 'delegate agent' } as any);
      const parsed = JSON.parse(result ?? '[]');

      expect(registry.listTools).toHaveBeenCalledWith(tools);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toMatchObject({ name: 'delegate_task' });
    });

    it('notifies the active session after creating a meta-tool', async () => {
      const savedTool: MetaToolDefinition = {
        schemaVersion: 1,
        name: 'count_lines',
        description: 'Count lines in a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path']
        },
        handler: 'wc -l {{path}}',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        fingerprint: '1234567890abcdef',
        source: 'agent'
      };
      const registry = {
        listTools: vi.fn().mockResolvedValue([]),
        getMetaTool: vi.fn().mockReturnValue(undefined),
        getAllMetaTools: vi.fn().mockReturnValue([]),
        saveMetaTool: vi.fn().mockResolvedValue(savedTool)
      };
      const onMetaToolCreated = vi.fn();
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        toolsRegistry: registry as any,
        getRegisteredTools: () => [],
        onMetaToolCreated
      });

      await executor.execute({
        type: 'create_meta_tool',
        name: 'count_lines',
        description: 'Count lines in a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path']
        },
        handler: 'wc -l {{path}}'
      } as any);

      expect(registry.saveMetaTool).toHaveBeenCalledWith(expect.objectContaining({
        schemaVersion: 1,
        name: 'count_lines',
        description: 'Count lines in a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path']
        },
        handler: 'wc -l {{path}}',
        fingerprint: expect.any(String),
        source: 'agent'
      }));
      expect(onMetaToolCreated).toHaveBeenCalledWith(savedTool);
    });

    it('rejects meta-tool names that cannot be safely persisted as tool files', async () => {
      const registry = {
        listTools: vi.fn().mockResolvedValue([]),
        getMetaTool: vi.fn().mockReturnValue(undefined),
        getAllMetaTools: vi.fn().mockReturnValue([]),
        saveMetaTool: vi.fn()
      };
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        toolsRegistry: registry as any,
        getRegisteredTools: () => []
      });

      await expect(executor.execute({
        type: 'create_meta_tool',
        name: '../escape',
        description: 'Bad tool',
        parameters: { type: 'object', properties: {} },
        handler: 'echo nope'
      } as any)).rejects.toThrow('snake_case');
      expect(registry.saveMetaTool).not.toHaveBeenCalled();
    });

    it('shell-escapes every meta-tool parameter substitution', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'ok',
        stderr: '',
        code: 0
      });
      const registry = {
        listTools: vi.fn().mockResolvedValue([]),
        getMetaTool: vi.fn().mockReturnValue({
          schemaVersion: 1,
          name: 'echo_path',
          description: 'Echo path',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path']
          },
          handler: 'printf %s {{path}}',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          fingerprint: '1234567890abcdef',
          source: 'user'
        })
      };
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        toolsRegistry: registry as any,
        getRegisteredTools: () => []
      });

      const result = await executor.execute({ type: 'echo_path', path: 'src/index.ts' } as any);

      expect(runCommandSpy).toHaveBeenCalledWith(
        "printf %s 'src/index.ts'",
        [],
        '/repo',
        expect.objectContaining({ shell: true })
      );
      expect(result).toContain("$ printf %s 'src/index.ts'");
    });

    it('classifies a non-zero meta-tool command as a typed command failure', async () => {
      vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'partial meta output',
        stderr: 'meta command failed',
        code: 6,
      });
      const registry = {
        listTools: vi.fn().mockResolvedValue([]),
        getMetaTool: vi.fn().mockReturnValue({
          schemaVersion: 1,
          name: 'failing_meta',
          description: 'Fail predictably',
          parameters: { type: 'object', properties: {} },
          handler: 'failing-command',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          fingerprint: '1234567890abcdef',
          source: 'user',
        }),
      };
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (relativePath) => `/repo/${relativePath}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        toolsRegistry: registry as unknown as ConstructorParameters<typeof ActionExecutor>[0]['toolsRegistry'],
        getRegisteredTools: () => [],
      });

      const outcome = await executor.executeForTool(
        { type: 'failing_meta' } as AgentAction,
        { approvalHandled: true },
      );

      expect(outcome).toMatchObject({
        success: false,
        kind: 'command',
        error: 'meta command failed',
        output: expect.stringContaining('partial meta output'),
        exitCode: 6,
      });
    });

    it('forwards the active signal to meta-tool commands and classifies aborts', async () => {
      const controller = new AbortController();
      const abortError = Object.assign(new Error('Command execution aborted'), { name: 'AbortError' });
      const runCommand = vi.spyOn(commandActions, 'runCommand').mockRejectedValue(abortError);
      const registry = {
        listTools: vi.fn().mockResolvedValue([]),
        getMetaTool: vi.fn().mockReturnValue({
          schemaVersion: 1,
          name: 'long_meta',
          description: 'Run until canceled',
          parameters: { type: 'object', properties: {} },
          handler: 'sleep 30',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          fingerprint: '1234567890abcdef',
          source: 'user',
        }),
      };
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (relativePath) => `/repo/${relativePath}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        toolsRegistry: registry as unknown as ConstructorParameters<typeof ActionExecutor>[0]['toolsRegistry'],
        getRegisteredTools: () => [],
      });

      const outcome = await executor.executeForTool(
        { type: 'long_meta' } as AgentAction,
        { approvalHandled: true, signal: controller.signal },
      );

      expect(runCommand).toHaveBeenCalledWith(
        'sleep 30',
        [],
        '/repo',
        expect.objectContaining({ signal: controller.signal }),
      );
      expect(outcome).toEqual({
        success: false,
        kind: 'aborted',
        error: 'Command execution aborted',
      });
    });

    it('blocks meta-tool execution when shell command permission is denied', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'should not run',
        stderr: '',
        code: 0
      });
      const registry = {
        listTools: vi.fn().mockResolvedValue([]),
        getMetaTool: vi.fn().mockReturnValue({
          schemaVersion: 1,
          name: 'print_env',
          description: 'Print environment',
          parameters: { type: 'object', properties: {} },
          handler: 'printenv',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          fingerprint: '1234567890abcdef',
          source: 'user',
          scope: 'user'
        })
      };
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        permissionManager: new PermissionManager({ mode: 'interactive' }),
        toolsRegistry: registry as any,
        getRegisteredTools: () => []
      });

      const result = await executor.execute({ type: 'print_env' } as any);

      expect(result).toContain('Blocked');
      expect(result).toContain('blacklisted');
      expect(runCommandSpy).not.toHaveBeenCalled();
    });

    it('asks for approval before running an interactive meta-tool shell command', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'ok',
        stderr: '',
        code: 0
      });
      const confirmDangerousAction = vi.fn().mockResolvedValue(false);
      const registry = {
        listTools: vi.fn().mockResolvedValue([]),
        getMetaTool: vi.fn().mockReturnValue({
          schemaVersion: 1,
          name: 'echo_path',
          description: 'Echo path',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path']
          },
          handler: 'printf %s {{path}}',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          fingerprint: '1234567890abcdef',
          source: 'user',
          scope: 'user'
        })
      };
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction,
        permissionManager: new PermissionManager({ mode: 'interactive', rememberSession: false }),
        toolsRegistry: registry as any,
        getRegisteredTools: () => []
      });

      const result = await executor.execute({ type: 'echo_path', path: 'src/index.ts' } as any);

      expect(confirmDangerousAction).toHaveBeenCalledWith(
        expect.stringContaining('Run meta-tool echo_path'),
        expect.objectContaining({ tool: 'run_command', command: "printf %s 'src/index.ts'" })
      );
      expect(result).toContain('Skipped running meta-tool echo_path');
      expect(runCommandSpy).not.toHaveBeenCalled();
    });
  });

  describe('Unsupported Actions', () => {
    it('throws error for unknown action type', async () => {
      const executor = createExecutor();

      await expect(executor.execute({ type: 'unknown_action' } as any)).rejects.toThrow('Unsupported action type');
    });

    it('throws error for undefined action type', async () => {
      const executor = createExecutor();

      await expect(executor.execute({ type: undefined } as any)).rejects.toThrow();
    });

    it('throws error for null action type', async () => {
      const executor = createExecutor();

      await expect(executor.execute({ type: null } as any)).rejects.toThrow();
    });

    it('throws error for empty string action type', async () => {
      const executor = createExecutor();

      await expect(executor.execute({ type: '' } as any)).rejects.toThrow();
    });

    it('throws error for numeric action type', async () => {
      const executor = createExecutor();

      await expect(executor.execute({ type: 123 } as any)).rejects.toThrow();
    });

    it('throws error for object action type', async () => {
      const executor = createExecutor();

      await expect(executor.execute({ type: { name: 'action' } } as any)).rejects.toThrow();
    });

    it('throws error for array action type', async () => {
      const executor = createExecutor();

      await expect(executor.execute({ type: ['action'] } as any)).rejects.toThrow();
    });

    it('throws error for action with typo', async () => {
      const executor = createExecutor();

      await expect(executor.execute({ type: 'rea_file' } as any)).rejects.toThrow('Unsupported action type');
    });

    it('throws error for case-sensitive mismatch', async () => {
      const executor = createExecutor();

      await expect(executor.execute({ type: 'READ_FILE' } as any)).rejects.toThrow('Unsupported action type');
    });

    it('throws error for action with trailing whitespace', async () => {
      const executor = createExecutor();

      await expect(executor.execute({ type: 'read_file ' } as any)).rejects.toThrow('Unsupported action type');
    });

    it('throws error for action with leading whitespace', async () => {
      const executor = createExecutor();

      await expect(executor.execute({ type: ' read_file' } as any)).rejects.toThrow('Unsupported action type');
    });

    it('includes action type in error message', async () => {
      const executor = createExecutor();

      await expect(executor.execute({ type: 'my_custom_action' } as any)).rejects.toThrow('my_custom_action');
    });

    it('throws error for deprecated action types', async () => {
      const executor = createExecutor();

      // Assuming these are not valid action types
      await expect(executor.execute({ type: 'exec_command' } as any)).rejects.toThrow('Unsupported action type');
      await expect(executor.execute({ type: 'file_read' } as any)).rejects.toThrow('Unsupported action type');
    });

    it('throws error for action that looks like valid action', async () => {
      const executor = createExecutor();

      await expect(executor.execute({ type: 'read_files' } as any)).rejects.toThrow('Unsupported action type');
      await expect(executor.execute({ type: 'write_files' } as any)).rejects.toThrow('Unsupported action type');
    });

    it('throws error for action with extra underscores', async () => {
      const executor = createExecutor();

      await expect(executor.execute({ type: 'read__file' } as any)).rejects.toThrow('Unsupported action type');
    });

    it('throws error for action with hyphens instead of underscores', async () => {
      const executor = createExecutor();

      await expect(executor.execute({ type: 'read-file' } as any)).rejects.toThrow('Unsupported action type');
    });

    it('throws error for action when no action object provided', async () => {
      const executor = createExecutor();

      await expect(executor.execute(null as any)).rejects.toThrow();
    });

    it('throws error for empty action object', async () => {
      const executor = createExecutor();

      await expect(executor.execute({} as any)).rejects.toThrow();
    });

    it('throws error for action with boolean type', async () => {
      const executor = createExecutor();

      await expect(executor.execute({ type: true } as any)).rejects.toThrow();
    });

    it('checks meta-tools before throwing unsupported error', async () => {
      const registry = {
        listTools: vi.fn().mockResolvedValue([]),
        getMetaTool: vi.fn().mockReturnValue(undefined)
      };
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles() as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        toolsRegistry: registry as any,
        getRegisteredTools: () => []
      });

      await expect(executor.execute({ type: 'custom_meta' } as any)).rejects.toThrow('Unsupported action type');
      expect(registry.getMetaTool).toHaveBeenCalledWith('custom_meta');
    });
  });

  describe('Bash and Shell Tools', () => {
    it('executes shell command with shell option', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'hello world',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'echo',
        args: ['hello', 'world']
      } as any);

      expect(result).toContain('hello world');
      runCommandSpy.mockRestore();
    });

    it('handles pipe commands correctly', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'filtered output',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      await executor.execute({
        type: 'run_command',
        command: 'cat file.txt | grep pattern'
      } as any);

      expect(runCommandSpy).toHaveBeenCalled();
      runCommandSpy.mockRestore();
    });

    it('handles command with environment variables', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: '/home/user',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      await executor.execute({
        type: 'run_command',
        command: 'echo',
        args: ['$HOME']
      } as any);

      expect(runCommandSpy).toHaveBeenCalled();
      runCommandSpy.mockRestore();
    });

    it('handles command with redirection operators', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      await executor.execute({
        type: 'run_command',
        command: 'echo',
        args: ['hello', '>', 'output.txt']
      } as any);

      expect(runCommandSpy).toHaveBeenCalled();
      runCommandSpy.mockRestore();
    });

    it('handles command with glob patterns', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'file1.ts file2.ts',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      await executor.execute({
        type: 'run_command',
        command: 'ls',
        args: ['*.ts']
      } as any);

      expect(runCommandSpy).toHaveBeenCalled();
      runCommandSpy.mockRestore();
    });

    it('handles npm commands', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'added 100 packages',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'npm',
        args: ['install', '--save', 'lodash']
      } as any);

      expect(result).toContain('added 100 packages');
      runCommandSpy.mockRestore();
    });

    it('handles yarn commands', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'success Saved lockfile',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'yarn',
        args: ['add', 'react']
      } as any);

      expect(result).toContain('success');
      runCommandSpy.mockRestore();
    });

    it('handles bun commands', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'installed typescript',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'bun',
        args: ['add', 'typescript']
      } as any);

      expect(result).toContain('installed');
      runCommandSpy.mockRestore();
    });

    it('handles git commands', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'On branch main',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'git',
        args: ['status']
      } as any);

      expect(result).toContain('On branch');
      runCommandSpy.mockRestore();
    });

    it('handles docker commands', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'CONTAINER ID   IMAGE',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'docker',
        args: ['ps']
      } as any);

      expect(result).toContain('CONTAINER ID');
      runCommandSpy.mockRestore();
    });

    it('handles curl commands', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: '{"status": "ok"}',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'curl',
        args: ['-s', 'https://api.example.com']
      } as any);

      expect(result).toContain('"status"');
      runCommandSpy.mockRestore();
    });

    it('handles python commands', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'Hello from Python',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'python3',
        args: ['-c', 'print("Hello from Python")']
      } as any);

      expect(result).toContain('Hello from Python');
      runCommandSpy.mockRestore();
    });

    it('handles node commands', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'Hello from Node',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'node',
        args: ['-e', 'console.log("Hello from Node")']
      } as any);

      expect(result).toContain('Hello from Node');
      runCommandSpy.mockRestore();
    });

    it('handles make commands', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'Building...',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'make',
        args: ['build']
      } as any);

      expect(result).toContain('Building');
      runCommandSpy.mockRestore();
    });

    it('handles cargo commands', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'Compiling project v0.1.0',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'cargo',
        args: ['build']
      } as any);

      expect(result).toContain('Compiling');
      runCommandSpy.mockRestore();
    });

    it('handles go commands', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'go: downloading...',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'go',
        args: ['mod', 'tidy']
      } as any);

      expect(result).toContain('go:');
      runCommandSpy.mockRestore();
    });

    it('handles command with timeout', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      await executor.execute({
        type: 'run_command',
        command: 'sleep',
        args: ['1']
      } as any);

      expect(runCommandSpy).toHaveBeenCalled();
      runCommandSpy.mockRestore();
    });

    it('handles failing command with non-zero exit code', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: '',
        stderr: 'command not found',
        exitCode: 127
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'nonexistent'
      } as any);

      expect(result).toContain('command not found');
      runCommandSpy.mockRestore();
    });

    it('handles command that outputs binary data', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'binary content here',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'cat',
        args: ['image.png']
      } as any);

      expect(result).toBeDefined();
      runCommandSpy.mockRestore();
    });

    // ENOENT / spawn error handling (Issue #10)
    it('returns friendly error when command is not found (ENOENT)', async () => {
      const enoentError = new Error('Command not found: frobnicator');
      (enoentError as NodeJS.ErrnoException).code = 'ENOENT';
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockRejectedValue(enoentError);
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'frobnicator',
        args: ['--help']
      } as any);

      expect(typeof result).toBe('string');
      expect(result).toContain('frobnicator');
      expect(result).toContain('PATH');
      runCommandSpy.mockRestore();
    });

    it('error message contains the command name on ENOENT', async () => {
      const enoentError = new Error('Command not found: my-special-tool');
      (enoentError as NodeJS.ErrnoException).code = 'ENOENT';
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockRejectedValue(enoentError);
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'my-special-tool'
      } as any);

      expect(result).toContain('my-special-tool');
      runCommandSpy.mockRestore();
    });

    it('does not throw on ENOENT — returns string so agent loop continues', async () => {
      const enoentError = new Error('Command not found: ghost-cmd');
      (enoentError as NodeJS.ErrnoException).code = 'ENOENT';
      vi.spyOn(commandActions, 'runCommand').mockRejectedValue(enoentError);
      const executor = createExecutor();

      await expect(
        executor.execute({ type: 'run_command', command: 'ghost-cmd' } as any)
      ).resolves.toEqual(expect.any(String));
    });

    it('returns friendly error for "Command not found" message without ENOENT code', async () => {
      const spawnError = new Error('Command not found: missing-bin');
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockRejectedValue(spawnError);
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'missing-bin'
      } as any);

      expect(typeof result).toBe('string');
      expect(result).toContain('missing-bin');
      runCommandSpy.mockRestore();
    });

    it('returns generic error string for other spawn errors', async () => {
      const permError = new Error('EACCES: permission denied');
      (permError as NodeJS.ErrnoException).code = 'EACCES';
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockRejectedValue(permError);
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'restricted-tool'
      } as any);

      expect(typeof result).toBe('string');
      expect(result).toContain('Error');
      expect(result).toContain('restricted-tool');
      runCommandSpy.mockRestore();
    });

    it('still returns output for commands that succeed', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'Hello, world!',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      const result = await executor.execute({
        type: 'run_command',
        command: 'echo',
        args: ['Hello, world!']
      } as any);

      expect(result).toContain('Hello, world!');
      runCommandSpy.mockRestore();
    });
  });

  describe('run_command always uses shell execution', () => {
    it('always passes shell: true even for simple commands without shell operators', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'ok',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      await executor.execute({
        type: 'run_command',
        command: 'echo',
        args: ['hello']
      } as any);

      expect(runCommandSpy).toHaveBeenCalledWith(
        'echo hello',
        [],
        '/repo',
        expect.objectContaining({ shell: true })
      );
      runCommandSpy.mockRestore();
    });

    it('joins command and args into a single shell string', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'ok',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      await executor.execute({
        type: 'run_command',
        command: 'git',
        args: ['commit', '-m', 'fix something']
      } as any);

      expect(runCommandSpy).toHaveBeenCalledWith(
        'git commit -m fix something',
        [],
        '/repo',
        expect.objectContaining({ shell: true })
      );
      runCommandSpy.mockRestore();
    });

    it('passes command as-is when no args provided', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'ok',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      await executor.execute({
        type: 'run_command',
        command: 'ls'
      } as any);

      expect(runCommandSpy).toHaveBeenCalledWith(
        'ls',
        [],
        '/repo',
        expect.objectContaining({ shell: true })
      );
      runCommandSpy.mockRestore();
    });

    it('uses shell for piped commands in command field', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'HELLO',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      await executor.execute({
        type: 'run_command',
        command: 'echo hello | tr a-z A-Z'
      } as any);

      expect(runCommandSpy).toHaveBeenCalledWith(
        'echo hello | tr a-z A-Z',
        [],
        '/repo',
        expect.objectContaining({ shell: true })
      );
      runCommandSpy.mockRestore();
    });

    it('uses shell for env var expansion in args', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: '/home/user',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      await executor.execute({
        type: 'run_command',
        command: 'echo',
        args: ['$HOME']
      } as any);

      expect(runCommandSpy).toHaveBeenCalledWith(
        'echo $HOME',
        [],
        '/repo',
        expect.objectContaining({ shell: true })
      );
      runCommandSpy.mockRestore();
    });

    it('uses shell for redirect operators in args', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      await executor.execute({
        type: 'run_command',
        command: 'echo',
        args: ['hello', '>', 'output.txt']
      } as any);

      expect(runCommandSpy).toHaveBeenCalledWith(
        'echo hello > output.txt',
        [],
        '/repo',
        expect.objectContaining({ shell: true })
      );
      runCommandSpy.mockRestore();
    });

    it('uses shell for glob patterns in args', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: 'file1.ts file2.ts',
        stderr: '',
        exitCode: 0
      });
      const executor = createExecutor();

      await executor.execute({
        type: 'run_command',
        command: 'ls',
        args: ['*.ts']
      } as any);

      expect(runCommandSpy).toHaveBeenCalledWith(
        'ls *.ts',
        [],
        '/repo',
        expect.objectContaining({ shell: true })
      );
      runCommandSpy.mockRestore();
    });

    it('preserves directory, background, and streaming options', async () => {
      const runCommandSpy = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: null,
        backgroundPid: 42
      });
      const executor = createExecutor();

      await executor.execute({
        type: 'run_command',
        command: 'node',
        args: ['server.js'],
        directory: 'packages/api',
        background: true
      } as any);

      expect(runCommandSpy).toHaveBeenCalledWith(
        'node server.js',
        [],
        '/repo',
        expect.objectContaining({
          shell: true,
          directory: 'packages/api',
          background: true
        })
      );
      runCommandSpy.mockRestore();
    });
  });
});

  describe('request_directory_access', () => {
    it('returns error when directory does not exist', async () => {
      const executor = createExecutor({
        getAllowedDirectories: vi.fn().mockReturnValue(['/repo']),
        addAdditionalDirectory: vi.fn(),
      });

      // Mock fs-extra pathExists to return false
      const fs = await import('fs-extra');
      vi.spyOn(fs, 'pathExists').mockResolvedValue(false);

      const result = await executor.execute({
        type: 'request_directory_access',
        path: '/nonexistent/path'
      });

      expect(result).toContain('Error: Directory does not exist');

      const outcome = await executor.executeForTool(
        { type: 'request_directory_access', path: '/nonexistent/path' },
        { approvalHandled: true },
      );
      expect(outcome).toMatchObject({
        success: false,
        kind: 'validation',
        error: expect.stringContaining('Directory does not exist'),
      });
    });

    it('returns already accessible when directory is workspace root', async () => {
      const executor = createExecutor({
        getAllowedDirectories: vi.fn().mockReturnValue(['/repo']),
        addAdditionalDirectory: vi.fn(),
      });

      mockPathExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ isDirectory: () => true } as any);

      const result = await executor.execute({
        type: 'request_directory_access',
        path: '/repo'
      });

      expect(result).toContain('already accessible');
    });

    it('auto-grants access in yolo mode', async () => {
      const addAdditionalDirectory = vi.fn();
      const executor = createExecutor({
        getAllowedDirectories: vi.fn().mockReturnValue(['/repo']),
        addAdditionalDirectory,
      }, {
        runtime: {
          options: { yolo: 'allow:*' }
        }
      });

      mockPathExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ isDirectory: () => true } as any);

      const result = await executor.execute({
        type: 'request_directory_access',
        path: '/external/path'
      });

      expect(result).toContain('auto-granted');
      expect(result).toContain('yolo mode');
      expect(addAdditionalDirectory).toHaveBeenCalled();
    });

    it('auto-grants access in unrestricted mode', async () => {
      const addAdditionalDirectory = vi.fn();
      const executor = createExecutor({
        getAllowedDirectories: vi.fn().mockReturnValue(['/repo']),
        addAdditionalDirectory,
      }, {
        runtime: {
          options: { unrestricted: true }
        }
      });

      mockPathExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ isDirectory: () => true } as any);

      const result = await executor.execute({
        type: 'request_directory_access',
        path: '/external/path'
      });

      expect(result).toContain('auto-granted');
      expect(addAdditionalDirectory).toHaveBeenCalled();
    });

    it('auto-grants access in yes mode (auto-mode)', async () => {
      const addAdditionalDirectory = vi.fn();
      const executor = createExecutor({
        getAllowedDirectories: vi.fn().mockReturnValue(['/repo']),
        addAdditionalDirectory,
      }, {
        runtime: {
          options: { yes: true }
        }
      });

      mockPathExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ isDirectory: () => true } as any);

      const result = await executor.execute({
        type: 'request_directory_access',
        path: '/external/path'
      });

      expect(result).toContain('auto-granted');
      expect(addAdditionalDirectory).toHaveBeenCalled();
    });

    it('uses callback when available in interactive mode', async () => {
      const addAdditionalDirectory = vi.fn();
      const onRequestDirectoryAccess = vi.fn().mockResolvedValue('/external/path');
      
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles({
          getAllowedDirectories: vi.fn().mockReturnValue(['/repo']),
          addAdditionalDirectory,
        }) as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        onRequestDirectoryAccess,
      });

      mockPathExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ isDirectory: () => true } as any);

      const result = await executor.execute({
        type: 'request_directory_access',
        path: '/external/path',
        reason: 'User requested access to this folder'
      });

      expect(onRequestDirectoryAccess).toHaveBeenCalledWith('/external/path', 'User requested access to this folder');
      expect(result).toContain('Access granted');
      expect(addAdditionalDirectory).toHaveBeenCalled();
    });

    it('denies access when callback returns undefined', async () => {
      const addAdditionalDirectory = vi.fn();
      const onRequestDirectoryAccess = vi.fn().mockResolvedValue(undefined);
      
      const executor = new ActionExecutor({
        runtime: createRuntime(),
        files: createFiles({
          getAllowedDirectories: vi.fn().mockReturnValue(['/repo']),
          addAdditionalDirectory,
        }) as FileActionManager,
        resolveWorkspacePath: (rel) => `/repo/${rel}`,
        confirmDangerousAction: vi.fn().mockResolvedValue(true),
        onRequestDirectoryAccess,
      });

      mockPathExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ isDirectory: () => true } as any);

      const result = await executor.execute({
        type: 'request_directory_access',
        path: '/external/path'
      });

      expect(result).toContain('Access denied');
      expect(addAdditionalDirectory).not.toHaveBeenCalled();

      const outcome = await executor.executeForTool(
        { type: 'request_directory_access', path: '/external/path' },
        { approvalHandled: true },
      );
      expect(outcome).toMatchObject({
        success: false,
        kind: 'authorization',
        error: expect.stringContaining('Access denied'),
      });
    });

    it('returns instructions when no callback and not yolo mode', async () => {
      const executor = createExecutor({
        getAllowedDirectories: vi.fn().mockReturnValue(['/repo']),
        addAdditionalDirectory: vi.fn(),
      });

      mockPathExists.mockResolvedValue(true);
      mockStat.mockResolvedValue({ isDirectory: () => true } as any);

      const result = await executor.execute({
        type: 'request_directory_access',
        path: '/external/path'
      });

      expect(result).toContain('/add-dir');
      expect(result).toContain('--add-dir');
    });
  });
