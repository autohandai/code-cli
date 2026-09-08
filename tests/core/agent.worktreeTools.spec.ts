/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionThreadBudget } from '../../src/core/agents/SessionThreadBudget.js';

const mockPrepareSessionWorktree = vi.fn();
const mockWorktreeRemove = vi.fn();

vi.mock('../../src/utils/sessionWorktree.js', () => ({
  prepareSessionWorktree: mockPrepareSessionWorktree,
}));

vi.mock('../../src/actions/worktree.js', () => ({
  WorktreeManager: class {
    remove = mockWorktreeRemove;
  },
}));

describe('AutohandAgent worktree tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps active workers in their repository when a workspace switch is requested', async () => {
    const { switchAgentWorkspaceContext } = await import('../../src/core/agent/AgentCommandRuntime.js');
    const host = createWorkspaceHost('/repo');
    const worker = host.sessionThreadBudget.tryAcquire('running-worker');

    await expect(switchAgentWorkspaceContext(host, '/another-repo'))
      .rejects.toThrow('Wait for active subagents to finish or cancel them before switching workspace');

    expect(host.runtime.workspaceRoot).toBe('/repo');
    expect(host.files.setWorkspaceRoot).not.toHaveBeenCalled();
    expect(host.skillsRegistry.setWorkspace).not.toHaveBeenCalled();
    worker.release();
    await switchAgentWorkspaceContext(host, '/another-repo');
    expect(host.runtime.workspaceRoot).toBe('/another-repo');
  });

  it('blocks new workers throughout an asynchronous workspace switch and releases on failure', async () => {
    const { switchAgentWorkspaceContext } = await import('../../src/core/agent/AgentCommandRuntime.js');
    const host = createWorkspaceHost('/repo');
    const skillsUpdate = Promise.withResolvers<void>();
    host.skillsRegistry.setWorkspace.mockReturnValue(skillsUpdate.promise);

    const switching = switchAgentWorkspaceContext(host, '/another-repo');

    expect(() => host.sessionThreadBudget.tryAcquire('worker')).toThrow('workspace is changing');
    skillsUpdate.reject(new Error('Workspace skills could not be loaded'));
    await expect(switching).rejects.toThrow('Workspace skills could not be loaded');
    expect(() => host.sessionThreadBudget.tryAcquire('worker')).not.toThrow();
  });

  it('allows refreshing the same workspace while workers remain active', async () => {
    const { switchAgentWorkspaceContext } = await import('../../src/core/agent/AgentCommandRuntime.js');
    const host = createWorkspaceHost('/repo');
    host.sessionThreadBudget.tryAcquire('worker');

    await switchAgentWorkspaceContext(host, '/repo');

    expect(host.runtime.workspaceRoot).toBe('/repo');
    expect(host.sessionThreadBudget.activeChildren).toBe(1);
  });

  it('refuses to create a worktree while a worker is using the current repository', async () => {
    const { enterAgentSessionWorktree } = await import('../../src/core/agent/AgentCommandRuntime.js');
    const host = {
      ...createWorkspaceHost('/repo'),
      sessionWorktreeState: null,
      switchWorkspaceContext: vi.fn().mockResolvedValue(undefined),
    };
    host.sessionThreadBudget.tryAcquire('worker');
    mockPrepareSessionWorktree.mockReturnValue({
      repoRoot: '/repo',
      worktreePath: '/repo-feature',
      branchName: 'feature',
      createdBranch: true,
    });

    await expect(enterAgentSessionWorktree(host, 'feature'))
      .rejects.toThrow('Wait for active subagents to finish or cancel them before switching workspace');

    expect(mockPrepareSessionWorktree).not.toHaveBeenCalled();
    expect(host.switchWorkspaceContext).not.toHaveBeenCalled();
    expect(host.sessionWorktreeState).toBeNull();
  });

  it('holds the worktree entry guard through its nested workspace switch', async () => {
    const { enterAgentSessionWorktree, switchAgentWorkspaceContext } = await import('../../src/core/agent/AgentCommandRuntime.js');
    const host = {
      ...createWorkspaceHost('/repo'),
      sessionWorktreeState: null,
      switchWorkspaceContext(workspaceRoot: string) {
        return switchAgentWorkspaceContext(this, workspaceRoot);
      },
    };
    mockPrepareSessionWorktree.mockReturnValue({
      repoRoot: '/repo',
      worktreePath: '/repo-feature',
      branchName: 'feature',
      createdBranch: true,
    });
    const skillsUpdate = Promise.withResolvers<void>();
    host.skillsRegistry.setWorkspace.mockReturnValue(skillsUpdate.promise);

    const entering = enterAgentSessionWorktree(host, 'feature');

    expect(() => host.sessionThreadBudget.tryAcquire('worker')).toThrow('workspace is changing');
    skillsUpdate.resolve();
    await expect(entering).resolves.toContain('Entered worktree /repo-feature');
    expect(host.runtime.workspaceRoot).toBe('/repo-feature');
    expect(() => host.sessionThreadBudget.tryAcquire('worker')).not.toThrow();
  });

  it('reopens worker admission after worktree creation fails', async () => {
    const { enterAgentSessionWorktree } = await import('../../src/core/agent/AgentCommandRuntime.js');
    const host = { ...createWorkspaceHost('/repo'), sessionWorktreeState: null };
    mockPrepareSessionWorktree.mockImplementationOnce(() => {
      throw new Error('Worktree creation failed');
    });

    await expect(enterAgentSessionWorktree(host, 'feature')).rejects.toThrow('Worktree creation failed');

    expect(host.runtime.workspaceRoot).toBe('/repo');
    expect(host.sessionWorktreeState).toBeNull();
    expect(() => host.sessionThreadBudget.tryAcquire('worker')).not.toThrow();
  });

  it.each([false, true])('refuses to exit an active worker repository before any removal (keep=%s)', async (keep) => {
    const { exitAgentSessionWorktree } = await import('../../src/core/agent/AgentCommandRuntime.js');
    const host = {
      ...createWorkspaceHost('/repo-feature'),
      sessionWorktreeState: {
        repoRoot: '/repo',
        originalWorkspaceRoot: '/repo',
        worktreePath: '/repo-feature',
        branchName: 'feature',
        createdBranch: true,
      },
      switchWorkspaceContext: vi.fn().mockResolvedValue(undefined),
    };
    host.sessionThreadBudget.tryAcquire('worker');

    await expect(exitAgentSessionWorktree(host, keep))
      .rejects.toThrow('Wait for active subagents to finish or cancel them before switching workspace');

    expect(mockWorktreeRemove).not.toHaveBeenCalled();
    expect(host.switchWorkspaceContext).not.toHaveBeenCalled();
    expect(host.sessionWorktreeState?.worktreePath).toBe('/repo-feature');
    expect(host.runtime.workspaceRoot).toBe('/repo-feature');
  });

  it('blocks child admission during worktree removal and releases the guard when removal fails', async () => {
    const { exitAgentSessionWorktree } = await import('../../src/core/agent/AgentCommandRuntime.js');
    const host = {
      ...createWorkspaceHost('/repo-feature'),
      sessionWorktreeState: {
        repoRoot: '/repo',
        originalWorkspaceRoot: '/repo',
        worktreePath: '/repo-feature',
        branchName: 'feature',
        createdBranch: true,
      },
      switchWorkspaceContext: vi.fn().mockResolvedValue(undefined),
    };
    const removal = Promise.withResolvers<string>();
    mockWorktreeRemove.mockReturnValue(removal.promise);

    const exiting = exitAgentSessionWorktree(host);

    expect(() => host.sessionThreadBudget.tryAcquire('worker')).toThrow('workspace is changing');
    removal.reject(new Error('Worktree removal failed'));
    await expect(exiting).rejects.toThrow('Worktree removal failed');
    expect(host.runtime.workspaceRoot).toBe('/repo-feature');
    expect(host.sessionWorktreeState?.worktreePath).toBe('/repo-feature');
    expect(() => host.sessionThreadBudget.tryAcquire('worker')).not.toThrow();
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

function createWorkspaceHost(workspaceRoot: string) {
  return {
    runtime: { workspaceRoot },
    sessionThreadBudget: new SessionThreadBudget(),
    memoryManager: { setWorkspace: vi.fn() },
    hookManager: { setWorkspaceRoot: vi.fn() },
    files: { setWorkspaceRoot: vi.fn() },
    persistentInput: { setWorkspaceRoot: vi.fn() },
    skillsRegistry: { setWorkspace: vi.fn().mockResolvedValue(undefined) },
    workspaceFileCollector: { setWorkspace: vi.fn() },
  };
}
