import { describe, expect, it, vi } from 'vitest';
import { confirmAgentDangerousAction } from '../../src/core/agent/AgentCommandRuntime.js';
import { PermissionManager } from '../../src/permissions/PermissionManager.js';
import { getPermissionPolicyDisposition } from '../../src/permissions/types.js';

describe('accepted-plan permissions', () => {
  it('does not let YOLO or auto-confirm skip the selected manual approval callback', async () => {
    const manager = new PermissionManager({ mode: 'unrestricted' });
    manager.setPlanEditApproval('manual');
    const confirmationCallback = vi.fn(async () => ({ decision: 'deny_once' as const }));
    const host = { runtime: { options: { yes: true, unrestricted: true, yolo: 'allow:*' }, config: { ui: { autoConfirm: true } } }, permissionManager: manager, confirmationCallback, hookManager: { executeHooks: vi.fn(async () => []) } };
    await expect(confirmAgentDangerousAction(host, 'Write main.ts', { tool: 'write_file', path: '/repo/main.ts' })).resolves.toMatchObject({ decision: 'deny_once' });
    expect(confirmationCallback).toHaveBeenCalledOnce();
  });
  it('auto-accepts file edits without granting shell, dependency or git approvals', () => {
    const manager = new PermissionManager({ mode: 'interactive' });
    manager.setPlanEditApproval('auto');
    for (const tool of ['write_file', 'append_file', 'apply_patch', 'search_replace', 'notebook_edit', 'format_file', 'multi_file_edit', 'delete_path', 'rename_path', 'copy_path']) {
      expect(manager.checkPermission({ tool: 'write_file', requestedTool: tool, path: '/repo/main.ts' }).allowed).toBe(true);
    }
    for (const tool of ['run_command', 'shell', 'git_checkout', 'add_dependency', 'remove_dependency']) {
      expect(manager.checkPermission({ tool: tool === 'run_command' || tool === 'shell' ? tool : 'write_file', requestedTool: tool, command: 'npm test', path: '/repo/package.json' }).allowed).toBe(false);
    }
    manager.setPlanEditApproval(undefined);
    expect(manager.checkPermission({ tool: 'write_file', path: '/repo/main.ts' }).allowed).toBe(false);
  });
  it('manual approval overrides YOLO, saved approvals and broad allow patterns', async () => {
    const manager = new PermissionManager({ mode: 'unrestricted', rememberSession: true, allowList: ['write_file:*'], allPathsAllowed: true });
    manager.setPlanEditApproval('manual');
    const edit = { tool: 'write_file', path: '/repo/main.ts' };
    await manager.applyPromptDecision(edit, { decision: 'allow_session' });
    expect(getPermissionPolicyDisposition(manager.checkPermission(edit))).toBe('prompt');
    manager.setPlanEditApproval(undefined);
    expect(manager.checkPermission(edit).allowed).toBe(true);
  });
  it('never overrides a blacklist, explicit deny or read-only mode', () => {
    const denied = new PermissionManager({ denyList: ['write_file:*'] });
    denied.setPlanEditApproval('auto');
    expect(denied.checkPermission({ tool: 'write_file', path: '/repo/main.ts' }).allowed).toBe(false);
    expect(denied.checkPermission({ tool: 'write_file', path: '.env' }).reason).toBe('blacklisted');
    const restricted = new PermissionManager({ mode: 'restricted' });
    restricted.setPlanEditApproval('auto');
    expect(restricted.checkPermission({ tool: 'write_file', path: '/repo/main.ts' }).allowed).toBe(false);
  });
});
