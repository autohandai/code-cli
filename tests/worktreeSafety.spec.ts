import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorktreeManager } from '../src/actions/worktree.js';
import { enterAgentSessionWorktree, exitAgentSessionWorktree } from '../src/core/agent/AgentCommandRuntime.js';
import { DEFAULT_TOOL_DEFINITIONS, ToolManager } from '../src/core/toolManager.js';
import { PermissionManager } from '../src/permissions/PermissionManager.js';
import type { SessionWorktreeInfo } from '../src/utils/sessionWorktree.js';
import type { AgentAction } from '../src/types.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function fixture() {
  const container = await mkdtemp(path.join(os.tmpdir(), 'autohand-worktree-safety-'));
  roots.push(container);
  const root = path.join(container, 'repo');
  await mkdir(root);
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Worktree Tests');
  git(root, 'config', 'user.email', 'tests@autohand.ai');
  await writeFile(path.join(root, 'tracked.txt'), 'original\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'Initial fixture');
  const host = {
    runtime: { workspaceRoot: root },
    sessionWorktreeState: null as (SessionWorktreeInfo & { originalWorkspaceRoot: string }) | null,
    switchWorkspaceContext: vi.fn(async (workspaceRoot: string) => { host.runtime.workspaceRoot = workspaceRoot; }),
  };
  await enterAgentSessionWorktree(host, 'safety');
  const worktreePath = host.runtime.workspaceRoot;
  return { root, host, worktreePath };
}

describe('session worktree preservation with real Git', () => {
  it.each(['untracked', 'modified', 'staged'])('keeps %s files on exit_worktree with default arguments', async kind => {
    const { root, host, worktreePath } = await fixture();
    const file = path.join(worktreePath, kind === 'untracked' ? 'new.txt' : 'tracked.txt');
    await writeFile(file, 'work that must survive\n');
    if (kind === 'staged') git(worktreePath, 'add', '.');

    const output = await exitAgentSessionWorktree(host);

    expect(existsSync(file), output).toBe(true);
    expect(await readFile(file, 'utf8')).toBe('work that must survive\n');
    expect(output).toContain(`Kept worktree ${worktreePath} (branch safety) with changes`);
    expect(output).toContain('kept: has changes');
    expect(host.runtime.workspaceRoot).toBe(root);
    expect(host.sessionWorktreeState).toBeNull();
  });

  it('keeps a clean worktree containing commits not on the original branch', async () => {
    const { root, host, worktreePath } = await fixture();
    await writeFile(path.join(worktreePath, 'committed.txt'), 'committed work\n');
    git(worktreePath, 'add', '.');
    git(worktreePath, 'commit', '-qm', 'Keep this commit');
    const head = git(worktreePath, 'rev-parse', 'HEAD');

    const output = await exitAgentSessionWorktree(host);

    expect(existsSync(worktreePath), output).toBe(true);
    expect(git(root, 'rev-parse', 'safety')).toBe(head);
    expect(git(worktreePath, 'status', '--porcelain')).toBe('');
    expect(output).toContain('Kept worktree');
  });

  it('removes a clean session worktree and only its newly created branch', async () => {
    const { root, host, worktreePath } = await fixture();
    await exitAgentSessionWorktree(host);
    expect(existsSync(worktreePath)).toBe(false);
    expect(git(root, 'branch', '--list', 'safety')).toBe('');
  });

  it('normalizes an equivalent registered path before removing a clean worktree', async () => {
    const { root, worktreePath } = await fixture();
    await new WorktreeManager(root).remove(`${worktreePath}${path.sep}`, { deleteBranch: true });
    expect(existsSync(worktreePath)).toBe(false);
    expect(git(root, 'branch', '--list', 'safety')).toBe('');
  });

  it('compares commits against the original branch even after the original checkout switches branches', async () => {
    const { root, host, worktreePath } = await fixture();
    await writeFile(path.join(worktreePath, 'committed.txt'), 'work\n');
    git(worktreePath, 'add', '.');
    git(worktreePath, 'commit', '-qm', 'Not on original main');
    git(root, 'checkout', '-b', 'other-branch', 'safety');
    const output = await exitAgentSessionWorktree(host);
    expect(existsSync(worktreePath), output).toBe(true);
  });

  it.each([{ keep: true }, {}, { keep: true, discard_changes: true }])('allows a non-discarding exit without a deletion prompt: %j', async args => {
    const { host, worktreePath } = await fixture();
    await writeFile(path.join(worktreePath, 'new.txt'), 'keep\n');
    const confirmApproval = vi.fn();
    const manager = new ToolManager({
      definitions: DEFAULT_TOOL_DEFINITIONS, confirmApproval,
      executor: async action => {
        if (action.type !== 'exit_worktree') throw new Error('Unexpected tool');
        return { success: true, output: await exitAgentSessionWorktree(host, action.keep, action.discard_changes) };
      },
      authorization: { permissionManager: new PermissionManager({ mode: 'interactive' }) },
    });
    const [result] = await manager.execute([{ tool: 'exit_worktree', args }]);
    expect(result.success).toBe(true);
    expect(existsSync(worktreePath)).toBe(true);
    expect(confirmApproval).not.toHaveBeenCalled();
  });

  it('does not treat the legacy force option as authority to discard dirty files', async () => {
    const { root, worktreePath } = await fixture();
    const file = path.join(worktreePath, 'new.txt');
    await writeFile(file, 'keep\n');
    const output = await new WorktreeManager(root).remove(worktreePath, { force: true });
    expect(existsSync(file), output).toBe(true);
    expect(output).toContain('kept: has changes');
  });

  it('does not report a dirty merged worktree as removed during cleanup', async () => {
    const { root, worktreePath } = await fixture();
    await writeFile(path.join(worktreePath, 'new.txt'), 'keep\n');
    const result = await new WorktreeManager(root).cleanup({ removeMerged: true });
    expect(existsSync(worktreePath)).toBe(true);
    expect(result.removed).not.toContain(worktreePath);
  });

  it.each(['allow_once', 'deny'] as const)('requires the deletion approval path before a discard (%s)', async decision => {
    const { host, worktreePath } = await fixture();
    await writeFile(path.join(worktreePath, 'new.txt'), 'keep unless approved\n');
    const confirmApproval = vi.fn().mockResolvedValue({ decision });
    const executor = vi.fn(async (action: AgentAction) => {
      if (action.type !== 'exit_worktree') throw new Error('Unexpected tool');
      return { success: true as const, output: await exitAgentSessionWorktree(host, action.keep, action.discard_changes) };
    });
    const manager = new ToolManager({
      definitions: DEFAULT_TOOL_DEFINITIONS,
      executor,
      confirmApproval,
      authorization: { permissionManager: new PermissionManager({ mode: 'interactive' }) },
    });

    const [result] = await manager.execute([{ tool: 'exit_worktree', args: { discard_changes: true } }]);

    expect(confirmApproval).toHaveBeenCalledOnce();
    expect(confirmApproval.mock.calls[0]?.[1]).toMatchObject({ tool: 'delete_path' });
    expect(result.success).toBe(decision === 'allow_once');
    expect(existsSync(worktreePath)).toBe(decision !== 'allow_once');
    expect(executor).toHaveBeenCalledTimes(decision === 'allow_once' ? 1 : 0);
  });

  it('denies explicit discard in the restricted client profile before invoking its executor', async () => {
    const executor = vi.fn().mockResolvedValue({ success: true, output: 'removed' });
    const confirmApproval = vi.fn().mockResolvedValue({ decision: 'allow_once' });
    const manager = new ToolManager({
      definitions: DEFAULT_TOOL_DEFINITIONS, executor, confirmApproval, clientContext: 'restricted',
      authorization: { permissionManager: new PermissionManager({ mode: 'unrestricted' }) },
    });

    const [result] = await manager.execute([{ tool: 'exit_worktree', args: { discard_changes: true } }]);

    expect(result.success).toBe(false);
    expect(executor).not.toHaveBeenCalled();
    expect(confirmApproval).not.toHaveBeenCalled();
  });
});
