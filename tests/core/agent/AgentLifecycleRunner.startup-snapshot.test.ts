import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeAgentManagers } from '../../../src/core/agent/AgentLifecycleRunner.js';
import { initializeSessionGitSnapshot } from '../../../src/actions/gitSessionSnapshot.js';

vi.mock('../../../src/actions/gitSessionSnapshot.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/actions/gitSessionSnapshot.js')>(),
  initializeSessionGitSnapshot: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

describe('interactive startup Git baseline', () => {
  it.each([false, true])('initializes managers without a synchronous repository scan; bare=%s', async bare => {
    const initialize = vi.fn(async () => {});
    const manager = { initialize };
    await initializeAgentManagers({
      runtime: { workspaceRoot: '/workspace', options: { bare } },
      getParallelismLimit: () => 8,
      sessionManager: manager, projectManager: manager, memoryManager: manager,
      skillsRegistry: manager, hookManager: manager,
      workspaceFileCollector: { collectWorkspaceFiles: initialize },
    });
    expect(initialize).toHaveBeenCalledTimes(bare ? 3 : 6);
    expect(initializeSessionGitSnapshot).not.toHaveBeenCalled();
  });
});
