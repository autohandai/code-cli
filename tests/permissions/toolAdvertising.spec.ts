/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { ToolManager } from '../../src/core/toolManager.js';
import { filterAdvertisedTools } from '../../src/permissions/toolAdvertising.js';
import { PermissionManager } from '../../src/permissions/PermissionManager.js';
import { collectToolPatternOption } from '../../src/permissions/cliPolicyMutation.js';
import { checkRunToolScope, isToolAdvertisedByScope, resolveRunToolScope } from '../../src/permissions/runToolScope.js';

const tools = [{ name: 'read_file' }, { name: 'write_file' }, { name: 'run_command' }, { name: 'mcp__fs__delete' }];

describe('filterAdvertisedTools', () => {
  it('advertises everything when no scoping is configured', () => {
    expect(filterAdvertisedTools(tools, undefined)).toEqual(tools);
    expect(filterAdvertisedTools(tools, { availableTools: [], excludedTools: [] })).toEqual(tools);
  });

  it('keeps only tools named in availableTools, including ones narrowed by an argument', () => {
    const kept = filterAdvertisedTools(tools, {
      availableTools: [{ kind: 'read_file' }, { kind: 'run_command', argument: 'git:*' }],
    });
    expect(kept.map((tool) => tool.name)).toEqual(['read_file', 'run_command']);
  });

  it('drops tools excluded outright but keeps tools excluded only for some arguments', () => {
    const kept = filterAdvertisedTools(tools, {
      excludedTools: [{ kind: 'mcp__fs__delete' }, { kind: 'run_command', argument: 'rm:*' }],
    });
    expect(kept.map((tool) => tool.name)).toEqual(['read_file', 'write_file', 'run_command']);
  });

  it('applies exclusions after the allowlist through the permission manager', () => {
    const manager = new PermissionManager({
      settings: { availableTools: [{ kind: 'read_file' }, { kind: 'write_file' }], excludedTools: [{ kind: 'write_file' }] },
    });
    expect(manager.filterAdvertisedTools(tools).map((tool) => tool.name)).toEqual(['read_file']);
    expect(manager.checkPermission({ tool: 'write_file', path: 'a.ts' })).toMatchObject({ allowed: false, reason: 'excluded' });
    expect(manager.checkPermission({ tool: 'run_command', command: 'ls' })).toMatchObject({ allowed: false, reason: 'not_in_available' });
  });
});

describe('run tool scope', () => {
  it('collects repeated and comma-separated values', () => {
    const collected = collectToolPatternOption('read_file,write_file', collectToolPatternOption('run_command(git:*)'));
    expect(collected).toEqual(['run_command(git:*)', 'read_file,write_file']);
  });

  it('resolves nothing without flags', () => {
    expect(resolveRunToolScope(undefined)).toBeUndefined();
    expect(resolveRunToolScope({ allowedTools: [], disallowedTools: [] })).toBeUndefined();
  });

  it('is a restriction layer: never merged into settings, never widened by a local or extension allowlist', () => {
    const manager = new PermissionManager({ settings: { mode: 'unrestricted', availableTools: [{ kind: 'read_file' }, { kind: 'write_file' }] } });
    manager.setExtensionPolicies([{ extensionId: 'ext', settings: { availableTools: [{ kind: 'write_file' }, { kind: 'delete_path' }] } }]);
    manager.setRunToolScope(resolveRunToolScope({ allowedTools: ['read_file'] }));

    expect(manager.filterAdvertisedTools(tools).map((tool) => tool.name)).toEqual(['read_file']);
    expect(manager.checkPermission({ tool: 'write_file', path: 'a.ts' })).toMatchObject({ allowed: false, reason: 'run_scope_not_allowed' });
    expect(manager.checkPermission({ tool: 'read_file', path: 'a.ts' })).toMatchObject({ allowed: true });
    // Nothing about the scope reaches the settings that /theme or /model would persist.
    expect(JSON.stringify(manager.getSettings())).not.toContain('"availableTools":[{"kind":"read_file"}]');
    expect(manager.getSettings().availableTools).toEqual([{ kind: 'read_file' }, { kind: 'write_file' }]);
  });

  it('denies a disallowed tool even in unrestricted mode and keeps argument-scoped denials narrow', () => {
    const manager = new PermissionManager({ settings: { mode: 'unrestricted' } });
    manager.setRunToolScope(resolveRunToolScope({ disallowedTools: ['run_command(rm:*)', 'mcp__fs__delete'] }));
    expect(manager.filterAdvertisedTools(tools).map((tool) => tool.name)).toEqual(['read_file', 'write_file', 'run_command']);
    expect(manager.checkPermission({ tool: 'run_command', command: 'rm', args: ['-rf', 'x'] })).toMatchObject({ allowed: false, reason: 'run_scope_denied' });
    expect(manager.checkPermission({ tool: 'run_command', command: 'ls' })).toMatchObject({ allowed: true });
    expect(isToolAdvertisedByScope(manager.getRunToolScope(), 'mcp__fs__delete')).toBe(false);
    expect(checkRunToolScope(manager.getRunToolScope(), { kind: 'mcp__fs__delete', target: '' })).toEqual({ allowed: false, reason: 'run_scope_denied' });
  });
});

describe('run tool scope at execution', () => {
  it('rejects a fabricated call to a disallowed tool in unrestricted mode before capability mapping', async () => {
    const executor = vi.fn().mockResolvedValue({ success: true, output: 'deleted' });
    const permissionManager = new PermissionManager({ mode: 'unrestricted' });
    permissionManager.setRunToolScope(resolveRunToolScope({ disallowedTools: ['delete_path'] }));
    const manager = new ToolManager({
      executor,
      confirmApproval: vi.fn().mockResolvedValue({ decision: 'allow_once' }),
      definitions: [{ name: 'delete_path', description: 'Delete' }, { name: 'read_file', description: 'Read' }],
      authorization: { permissionManager },
    });
    const [denied] = await manager.execute([{ tool: 'delete_path', args: { path: 'src/index.ts' } }]);
    expect(denied.success).toBe(false);
    expect(denied.error).toContain("Tool 'delete_path' is disabled for this run by --disallowed-tools.");
    expect(executor).not.toHaveBeenCalled();
    const [allowed] = await manager.execute([{ tool: 'read_file', args: { path: 'src/index.ts' } }]);
    expect(allowed.success).toBe(true);
  });

  it('runs an allowed tool whose capability maps elsewhere', async () => {
    const executor = vi.fn().mockResolvedValue({ success: true, output: 'deleted' });
    const permissionManager = new PermissionManager({ mode: 'unrestricted' });
    permissionManager.setRunToolScope(resolveRunToolScope({ allowedTools: ['delete_path'] }));
    const manager = new ToolManager({
      executor,
      confirmApproval: vi.fn().mockResolvedValue({ decision: 'allow_once' }),
      definitions: [{ name: 'delete_path', description: 'Delete' }, { name: 'read_file', description: 'Read' }],
      authorization: { permissionManager },
    });
    const [result] = await manager.execute([{ tool: 'delete_path', args: { path: 'src/index.ts' } }]);
    expect(result.success).toBe(true);
    const [outside] = await manager.execute([{ tool: 'read_file', args: { path: 'src/index.ts' } }]);
    expect(outside.success).toBe(false);
    expect(outside.error).toContain('outside the --allowed-tools scope');
  });
});
