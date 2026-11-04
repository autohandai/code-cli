import { describe, expect, it, vi } from 'vitest';
import { PermissionManager } from '../../src/permissions/PermissionManager.js';
import { resolveRunToolScope } from '../../src/permissions/runToolScope.js';
import { ToolManager } from '../../src/core/toolManager.js';

describe('unattended tool approval', () => {
  it('approves an explicit CLI tool allowlist while preserving stronger policy', () => {
    const context = { tool: 'write_file', path: 'hello.txt' };
    const manager = new PermissionManager();
    manager.setRunToolScope(resolveRunToolScope({ allowedTools: ['write_file'] }));
    expect(manager.checkPermission(context).allowed).toBe(true);
    expect(manager.checkPermission({ tool: 'run_command', command: 'ls' }).allowed).toBe(false);
    const denied = new PermissionManager({ denyList: ['write_file:*'] });
    denied.setRunToolScope(resolveRunToolScope({ allowedTools: ['write_file'] }));
    expect(denied.checkPermission(context).allowed).toBe(false);
    expect(manager.checkPermission({ tool: 'write_file', path: '.env' }).allowed).toBe(false);
    manager.setPlanEditApproval('manual');
    expect(manager.checkPermission(context).allowed).toBe(false);
    const restricted = new PermissionManager({ mode: 'restricted' });
    restricted.setRunToolScope(resolveRunToolScope({ allowedTools: ['write_file'] }));
    expect(restricted.checkPermission(context).allowed).toBe(false);
  });

  it('stops at the first missing approval and executes none of the pending batch', async () => {
    const executor = vi.fn().mockResolvedValue({ success: true, output: 'ran' });
    const confirmApproval = vi.fn().mockResolvedValue({ decision: 'deny_once', reason: 'non_interactive' });
    const manager = new ToolManager({ definitions: [{ name: 'read_file', description: 'Read' }, { name: 'write_file', description: 'Write', requiresApproval: true }], executor, confirmApproval });
    const results = await manager.execute([{ tool: 'read_file', args: { path: 'hello.txt' } }, { tool: 'write_file', args: { path: 'hello.txt', contents: 'hi' } }, { tool: 'write_file', args: { path: 'other.txt', contents: 'hi' } }]);
    expect(executor).not.toHaveBeenCalled();
    expect(confirmApproval).toHaveBeenCalledOnce();
    expect(results).toHaveLength(3);
    expect(results.every(result => !result.success)).toBe(true);
    expect(results[1]).toMatchObject({ error: expect.stringContaining('--allowed-tools write_file') });
    expect(manager.getUnattendedDenials()).toEqual(['write_file']);
    manager.resetUnattendedDenials();
    expect(manager.getUnattendedDenials()).toEqual([]);
  });
  it('preserves interactive denial behavior and independently approved work', async () => {
    const executor = vi.fn().mockResolvedValue({ success: true, output: 'read' });
    const manager = new ToolManager({ definitions: [{ name: 'read_file', description: 'Read' }, { name: 'write_file', description: 'Write', requiresApproval: true }], executor, confirmApproval: async () => ({ decision: 'deny_once' }) });
    const results = await manager.execute([{ tool: 'write_file', args: {} }, { tool: 'read_file', args: {} }]);
    expect(results[0]).toMatchObject({ success: false, error: 'Tool execution skipped by user.' });
    expect(results[1].success).toBe(true);
    expect(executor).toHaveBeenCalledOnce();
  });
});
