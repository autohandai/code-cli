import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryManager } from '../../src/memory/MemoryManager.js';
import { extractAndSaveSessionMemories } from '../../src/memory/extractSessionMemories.js';
import { summarizeWithLLM } from '../../src/core/context/summarizer.js';
import type { LLMProvider } from '../../src/providers/LLMProvider.js';
import type { LLMResponse } from '../../src/types.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.remove(root)));
});

async function createScopedManager() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-deferred-project-'));
  roots.push(root);
  const workspaceRoot = path.join(root, 'project-a');
  let account = 'team-a';
  const publish = vi.fn(async () => {});
  const manager = new MemoryManager(workspaceRoot, {
    userMemoryDir: path.join(root, 'private-memory'),
    projectMemory: {
      refresh: async () => {},
      directory: workspace => path.join(workspace, account),
      scope: () => account,
      assertWritable: () => {},
      publish,
    },
  });
  await manager.initialize();
  return {
    manager, workspaceRoot, publish,
    switchScope(kind: string) {
      if (kind === 'account') account = 'team-b';
      else manager.setWorkspace(path.join(root, 'project-b'));
    },
  };
}

function delayedProvider() {
  let release: ((response: LLMResponse) => void) | undefined;
  const complete = vi.fn(() => new Promise<LLMResponse>(resolve => { release = resolve; }));
  const provider = { complete } as unknown as LLMProvider;
  return {
    provider,
    resolve(content: string) {
      release?.({ id: 'held-response', created: Date.now(), content, raw: {} });
    },
  };
}

describe('deferred project memory scope', () => {
  it.each(['account', 'workspace'])('protects ordinary extraction after a %s switch without explicit scope options', async kind => {
    const { manager, workspaceRoot, switchScope, publish } = await createScopedManager();
    const { provider, resolve } = delayedProvider();
    const pending = extractAndSaveSessionMemories({
      llm: provider,
      memoryManager: manager,
      workspaceRoot,
      conversationHistory: [
        { role: 'user', content: 'Use this repository convention' },
        { role: 'user', content: 'Keep my personal explanations concise' },
      ],
    });
    switchScope(kind);
    resolve(JSON.stringify([
      { content: 'Original project requires PostgreSQL', level: 'project', tags: ['database'] },
      { content: 'User prefers concise explanations', level: 'user', tags: ['workflow'] },
    ]));

    expect(await pending).toEqual([{ content: 'User prefers concise explanations', level: 'user', tags: ['workflow'] }]);
    expect(await manager.list('project')).toEqual([]);
    expect((await manager.list('user')).map(entry => entry.content)).toEqual(['User prefers concise explanations']);
    expect(publish).not.toHaveBeenCalled();
  });

  it.each(['account', 'workspace'])('keeps the summary available but skips project facts after a %s switch', async kind => {
    const { manager, switchScope, publish } = await createScopedManager();
    const { provider, resolve } = delayedProvider();
    const pending = summarizeWithLLM([{ role: 'user', content: 'Set up this repository database' }], provider, manager);
    switchScope(kind);
    resolve('User chose PostgreSQL as the original project database.');

    expect(await pending).toContain('User chose PostgreSQL');
    expect(await manager.list('project')).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
  });

  it('passes the original scope to stable project summary stores', async () => {
    const { manager, publish } = await createScopedManager();
    const expectedScope = manager.getProjectMemoryScope();
    const store = vi.spyOn(manager, 'store');
    const { provider, resolve } = delayedProvider();
    const pending = summarizeWithLLM([{ role: 'user', content: 'Choose the database' }], provider, manager);
    resolve('User chose PostgreSQL as the project database.');
    expect(await pending).toContain('LLM Context Summary');
    expect(store).toHaveBeenCalledWith('chose PostgreSQL as the project database.', 'project', ['context-summary'], 'context-summarization', undefined, expectedScope);
    expect(publish).toHaveBeenCalledOnce();
  });
});
