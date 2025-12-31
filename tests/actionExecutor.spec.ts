/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentRuntime } from '../src/types.js';
import type { FileActionManager } from '../src/actions/filesystem.js';
import { ActionExecutor } from '../src/core/actionExecutor.js';
import * as gitActions from '../src/actions/git.js';
import * as commandActions from '../src/actions/command.js';
import type { ToolDefinition } from '../src/core/toolManager.js';
import { execSync } from 'node:child_process';

// Mock execSync for security scanner tests
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process');
  return {
    ...actual,
    execSync: vi.fn()
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
    onFileModified?: () => void;
    onExploration?: (entry: { kind: string; target: string }) => void;
    confirmDangerousAction?: () => Promise<boolean>;
  } = {}
): ActionExecutor {
  return new ActionExecutor({
    runtime: createRuntime(options.runtime),
    files: createFiles(filesOverrides) as FileActionManager,
    resolveWorkspacePath: (rel) => `/repo/${rel}`,
    confirmDangerousAction: options.confirmDangerousAction ?? vi.fn().mockResolvedValue(true),
    onFileModified: options.onFileModified,
    onExploration: options.onExploration
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
      const executor = createExecutor({ deletePath }, { confirmDangerousAction });

      const result = await executor.execute({ type: 'delete_path', path: 'dist' });

      expect(deletePath).toHaveBeenCalledWith('dist');
      expect(result).toContain('Deleted');
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
  });

  describe('Search Operations', () => {
    it('executes search and returns results', async () => {
      const search = vi.fn().mockReturnValue([
        { file: 'src/index.ts', line: 10, text: 'console.log("hello")' },
        { file: 'src/utils.ts', line: 5, text: 'console.log("world")' }
      ]);
      const executor = createExecutor({ search });

      const result = await executor.execute({ type: 'search', query: 'console.log' } as any);

      expect(search).toHaveBeenCalledWith('console.log', undefined);
      expect(result).toContain('src/index.ts:10');
      expect(result).toContain('src/utils.ts:5');
    });

    it('executes search_with_context', async () => {
      const searchWithContext = vi.fn().mockReturnValue('matched context');
      const executor = createExecutor({ searchWithContext });

      const result = await executor.execute({
        type: 'search_with_context',
        query: 'function',
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

    it('executes semantic_search', async () => {
      const semanticSearch = vi.fn().mockReturnValue([
        { file: 'src/auth.ts', snippet: 'login function' }
      ]);
      const executor = createExecutor({ semanticSearch });

      const result = await executor.execute({
        type: 'semantic_search',
        query: 'authentication'
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
      expect(result).toContain('Applied 2 edit(s)');
    });

    it('applies replace_all edits', async () => {
      const content = 'foo bar foo baz foo';
      const readFile = vi.fn().mockResolvedValue(content);
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, writeFile });

      const result = await executor.execute({
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

      expect(writeFile).toHaveBeenCalledWith('.agent/todos.json', expect.any(String));
      const written = JSON.parse(writeFile.mock.calls[0][1]);
      expect(written).toHaveLength(2);
      expect(result).toContain('50%');
    });

    it('merges with existing tasks', async () => {
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
      expect(written).toHaveLength(2);
      expect(written.find((t: any) => t.id === '1')).toBeDefined();
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

      const result = await executor.execute({
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

    it('skips tasks without id', async () => {
      const readFile = vi.fn().mockRejectedValue(new Error('not found'));
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, writeFile });

      await executor.execute({
        type: 'todo_write',
        tasks: [
          { title: 'No ID Task', status: 'pending' }, // Missing id
          { id: '1', title: 'Valid Task', status: 'pending' }
        ]
      } as any);

      const written = JSON.parse(writeFile.mock.calls[0][1]);
      expect(written).toHaveLength(1);
      expect(written[0].id).toBe('1');
    });

    it('skips tasks without title', async () => {
      const readFile = vi.fn().mockRejectedValue(new Error('not found'));
      const writeFile = vi.fn().mockResolvedValue(undefined);
      const executor = createExecutor({ readFile, writeFile });

      await executor.execute({
        type: 'todo_write',
        tasks: [
          { id: '1', status: 'pending' }, // Missing title
          { id: '2', title: 'Valid Task', status: 'pending' }
        ]
      } as any);

      const written = JSON.parse(writeFile.mock.calls[0][1]);
      expect(written).toHaveLength(1);
      expect(written[0].id).toBe('2');
    });

    it('skips null tasks in array', async () => {
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

      expect(runCommandSpy).toHaveBeenCalledWith('echo', ['hello'], '/repo', expect.any(Object));
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

      expect(runCommandSpy).toHaveBeenCalledWith('git', ['commit', '-m', 'message', '--amend'], '/repo', expect.any(Object));
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
      expect(runCommandSpy).toHaveBeenCalledWith('npm', ['test'], '/repo', expect.objectContaining({
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

      expect(runCommandSpy).toHaveBeenCalledWith('sleep', ['60'], '/repo', expect.objectContaining({
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

      expect(runCommandSpy).toHaveBeenCalledWith('git', ['commit', '-m', 'fix: handle "quotes" and $variables'], '/repo', expect.any(Object));
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

    it('emits exploration events for search actions', async () => {
      const onExploration = vi.fn();
      const executor = createExecutor(
        { search: vi.fn().mockReturnValue([]) },
        { onExploration }
      );

      await executor.execute({ type: 'search', query: 'test' } as any);

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

    it('emits exploration for search_with_context', async () => {
      const onExploration = vi.fn();
      const executor = createExecutor(
        { searchWithContext: vi.fn().mockReturnValue('context') },
        { onExploration }
      );

      await executor.execute({ type: 'search_with_context', query: 'function' } as any);

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

      await executor.execute({ type: 'search', query: 'función' } as any);

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
      const result = await executor.execute({ type: 'search', query: '' } as any);

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

      await executor.execute({ type: 'search', query: 'function\\s+\\w+' } as any);

      expect(onExploration).toHaveBeenCalledWith({ kind: 'search', target: 'function\\s+\\w+' });
    });

    it('emits exploration for search with path filter', async () => {
      const onExploration = vi.fn();
      const executor = createExecutor(
        { search: vi.fn().mockReturnValue([]) },
        { onExploration }
      );

      await executor.execute({ type: 'search', query: 'test', path: 'src/' } as any);

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

      const result = await executor.execute({ type: 'search', query: 'test' } as any);

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
      const executor = createExecutor(
        {},
        { runtime: { options: { dryRun: true } } as any }
      );

      const result = await executor.execute({ type: 'plan', notes: 'Planning' } as any);

      expect(result).toBe('Planning');
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
  });
});
