/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi } from 'vitest';
import type { AgentRuntime } from '../src/types.js';
import type { FileActionManager } from '../src/actions/filesystem.js';
import { ActionExecutor } from '../src/core/actionExecutor.js';

function createRuntime(): AgentRuntime {
  return {
    config: { configPath: '', openrouter: { apiKey: 'test', model: 'model' } },
    workspaceRoot: '/repo',
    options: {}
  } as AgentRuntime;
}

function createFiles(overrides: Partial<FileActionManager> = {}): Partial<FileActionManager> {
  return {
    root: '/repo',
    readFile: vi.fn().mockResolvedValue('hello world'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as Partial<FileActionManager>;
}

function createExecutor(files: Partial<FileActionManager>) {
  return new ActionExecutor({
    runtime: createRuntime(),
    files: files as FileActionManager,
    resolveWorkspacePath: (rel) => `/repo/${rel}`,
    confirmDangerousAction: vi.fn().mockResolvedValue(true)
  });
}

describe('search_replace', () => {
  it('applies single SEARCH/REPLACE block', async () => {
    const files = createFiles({ readFile: vi.fn().mockResolvedValue('hello world') });
    const executor = createExecutor(files);

    const blocks = `<<<<<<< SEARCH
hello
=======
goodbye
>>>>>>> REPLACE`;

    await executor.execute({ type: 'search_replace', path: 'test.txt', blocks });

    expect(files.writeFile).toHaveBeenCalledWith('test.txt', 'goodbye world');
  });

  it('applies multiple blocks in sequence', async () => {
    const files = createFiles({ readFile: vi.fn().mockResolvedValue('hello world') });
    const executor = createExecutor(files);

    const blocks = `<<<<<<< SEARCH
hello
=======
goodbye
>>>>>>> REPLACE

<<<<<<< SEARCH
world
=======
universe
>>>>>>> REPLACE`;

    await executor.execute({ type: 'search_replace', path: 'test.txt', blocks });

    expect(files.writeFile).toHaveBeenCalledWith('test.txt', 'goodbye universe');
  });

  it('preserves whitespace and indentation exactly', async () => {
    const content = `function foo() {
  if (true) {
    console.log("hello");
  }
}`;
    const files = createFiles({ readFile: vi.fn().mockResolvedValue(content) });
    const executor = createExecutor(files);

    const blocks = `<<<<<<< SEARCH
    console.log("hello");
=======
    console.log("goodbye");
>>>>>>> REPLACE`;

    await executor.execute({ type: 'search_replace', path: 'test.ts', blocks });

    expect(files.writeFile).toHaveBeenCalledWith('test.ts', `function foo() {
  if (true) {
    console.log("goodbye");
  }
}`);
  });

  it('throws on unmatched search text', async () => {
    const files = createFiles({ readFile: vi.fn().mockResolvedValue('hello world') });
    const executor = createExecutor(files);

    const blocks = `<<<<<<< SEARCH
nonexistent
=======
replacement
>>>>>>> REPLACE`;

    await expect(
      executor.execute({ type: 'search_replace', path: 'test.txt', blocks })
    ).rejects.toThrow('SEARCH text not found');
  });

  it('throws on malformed block (missing divider)', async () => {
    const files = createFiles();
    const executor = createExecutor(files);

    const blocks = `<<<<<<< SEARCH
hello
>>>>>>> REPLACE`;

    await expect(
      executor.execute({ type: 'search_replace', path: 'test.txt', blocks })
    ).rejects.toThrow('Malformed SEARCH/REPLACE block');
  });

  it('throws on malformed block (missing replace marker)', async () => {
    const files = createFiles();
    const executor = createExecutor(files);

    const blocks = `<<<<<<< SEARCH
hello
=======
goodbye`;

    await expect(
      executor.execute({ type: 'search_replace', path: 'test.txt', blocks })
    ).rejects.toThrow('Malformed SEARCH/REPLACE block');
  });

  it('does not write when content unchanged', async () => {
    const files = createFiles({ readFile: vi.fn().mockResolvedValue('unchanged') });
    const executor = createExecutor(files);

    const blocks = `<<<<<<< SEARCH
unchanged
=======
unchanged
>>>>>>> REPLACE`;

    await executor.execute({ type: 'search_replace', path: 'test.txt', blocks });

    expect(files.writeFile).not.toHaveBeenCalled();
  });

  it('handles empty replacement (deletion)', async () => {
    const files = createFiles({ readFile: vi.fn().mockResolvedValue('hello world') });
    const executor = createExecutor(files);

    const blocks = `<<<<<<< SEARCH
hello
=======
>>>>>>> REPLACE`;

    await executor.execute({ type: 'search_replace', path: 'test.txt', blocks });

    expect(files.writeFile).toHaveBeenCalledWith('test.txt', ' world');
  });

  it('handles multiline search and replace', async () => {
    const content = `line1
line2
line3`;
    const files = createFiles({ readFile: vi.fn().mockResolvedValue(content) });
    const executor = createExecutor(files);

    const blocks = `<<<<<<< SEARCH
line1
line2
=======
newline1
newline2
newline3
>>>>>>> REPLACE`;

    await executor.execute({ type: 'search_replace', path: 'test.txt', blocks });

    expect(files.writeFile).toHaveBeenCalledWith('test.txt', `newline1
newline2
newline3
line3`);
  });
});
