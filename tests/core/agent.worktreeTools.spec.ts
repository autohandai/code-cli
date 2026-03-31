/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrepareSessionWorktree = vi.fn();
const mockWorktreeRemove = vi.fn();

vi.mock('../../src/utils/sessionWorktree.js', () => ({
  prepareSessionWorktree: mockPrepareSessionWorktree,
}));

vi.mock('../../src/actions/worktree.js', () => ({
  WorktreeManager: vi.fn().mockImplementation(() => ({
    remove: mockWorktreeRemove,
  })),
}));

describe('AutohandAgent worktree tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enter_worktree switches the active workspace context', async () => {
    const { AutohandAgent } = await import('../../src/core/agent.js');
    const agent = Object.create(AutohandAgent.prototype) as any;

    mockPrepareSessionWorktree.mockReturnValue({
      repoRoot: '/repo',
      worktreePath: '/repo-feature',
      branchName: 'feature',
      createdBranch: true,
    });

    agent.runtime = { workspaceRoot: '/repo' };
    agent.memoryManager = { setWorkspace: vi.fn() };
    agent.hookManager = { setWorkspaceRoot: vi.fn() };
    agent.files = { setWorkspaceRoot: vi.fn() };
    agent.persistentInput = { setWorkspaceRoot: vi.fn() };
    agent.skillsRegistry = { setWorkspace: vi.fn().mockResolvedValue(undefined) };
    agent.sessionWorktreeState = null;
    agent.ignoreFilter = {};
    agent.workspaceFileCollector = { setWorkspace: vi.fn() };

    await agent.enterSessionWorktree('feature');

    expect(mockPrepareSessionWorktree).toHaveBeenCalledWith({
      cwd: '/repo',
      worktree: 'feature',
      mode: 'cli',
    });
    expect(agent.runtime.workspaceRoot).toBe('/repo-feature');
    expect(agent.memoryManager.setWorkspace).toHaveBeenCalledWith('/repo-feature');
    expect(agent.hookManager.setWorkspaceRoot).toHaveBeenCalledWith('/repo-feature');
    expect(agent.files.setWorkspaceRoot).toHaveBeenCalledWith('/repo-feature');
    expect(agent.persistentInput.setWorkspaceRoot).toHaveBeenCalledWith('/repo-feature');
    expect(agent.workspaceFileCollector.setWorkspace).toHaveBeenCalled();
    expect(agent.skillsRegistry.setWorkspace).toHaveBeenCalledWith('/repo-feature');
    expect(agent.sessionWorktreeState).toMatchObject({
      originalWorkspaceRoot: '/repo',
      worktreePath: '/repo-feature',
      branchName: 'feature',
    });
  });

  it('exit_worktree restores the original workspace and removes the active worktree', async () => {
    const { AutohandAgent } = await import('../../src/core/agent.js');
    const agent = Object.create(AutohandAgent.prototype) as any;

    mockWorktreeRemove.mockResolvedValue('Removed worktree');

    agent.runtime = { workspaceRoot: '/repo-feature' };
    agent.memoryManager = { setWorkspace: vi.fn() };
    agent.hookManager = { setWorkspaceRoot: vi.fn() };
    agent.files = { setWorkspaceRoot: vi.fn() };
    agent.persistentInput = { setWorkspaceRoot: vi.fn() };
    agent.skillsRegistry = { setWorkspace: vi.fn().mockResolvedValue(undefined) };
    agent.sessionWorktreeState = {
      repoRoot: '/repo',
      originalWorkspaceRoot: '/repo',
      worktreePath: '/repo-feature',
      branchName: 'feature',
      createdBranch: true,
    };
    agent.ignoreFilter = {};
    agent.workspaceFileCollector = { setWorkspace: vi.fn() };

    const result = await agent.exitSessionWorktree();

    expect(mockWorktreeRemove).toHaveBeenCalledWith('/repo-feature', {
      force: true,
      deleteBranch: true,
    });
    expect(agent.runtime.workspaceRoot).toBe('/repo');
    expect(agent.memoryManager.setWorkspace).toHaveBeenCalledWith('/repo');
    expect(agent.hookManager.setWorkspaceRoot).toHaveBeenCalledWith('/repo');
    expect(agent.files.setWorkspaceRoot).toHaveBeenCalledWith('/repo');
    expect(agent.persistentInput.setWorkspaceRoot).toHaveBeenCalledWith('/repo');
    expect(agent.workspaceFileCollector.setWorkspace).toHaveBeenCalled();
    expect(agent.skillsRegistry.setWorkspace).toHaveBeenCalledWith('/repo');
    expect(agent.sessionWorktreeState).toBeNull();
    expect(result).toContain('Exited worktree');
  });
});
