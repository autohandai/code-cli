/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi } from 'vitest';
import { ToolManager } from '../src/core/toolManager.js';

const noopDefinitions = [
  { name: 'read_file', description: 'read file' },
  { name: 'delete_path', description: 'delete file', requiresApproval: true }
] as const;

describe('ToolManager', () => {
  it('executes tool calls via the provided executor', async () => {
    const executor = vi.fn().mockResolvedValue('file contents');
    const confirm = vi.fn().mockResolvedValue(true);
    const manager = new ToolManager({ executor, confirmApproval: confirm, definitions: noopDefinitions as any });

    const results = await manager.execute([{ tool: 'read_file', args: { path: 'src/index.ts' } }]);

    expect(executor).toHaveBeenCalledWith(
      { type: 'read_file', path: 'src/index.ts' },
      expect.objectContaining({ tool: 'read_file' })
    );
    expect(results[0]).toMatchObject({ tool: 'read_file', success: true, output: 'file contents' });
  });

  it('enforces approval for dangerous tools', async () => {
    const executor = vi.fn();
    const confirm = vi.fn().mockResolvedValue(false);
    const manager = new ToolManager({ executor, confirmApproval: confirm, definitions: noopDefinitions as any });

    const results = await manager.execute([{ tool: 'delete_path', args: { path: 'dist' } }]);

    expect(confirm).toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ tool: 'delete_path', success: false });
  });

  it('lists registered tool names', () => {
    const manager = new ToolManager({
      executor: vi.fn(),
      confirmApproval: vi.fn(),
      definitions: noopDefinitions as any
    });

    expect(manager.listToolNames()).toEqual(['read_file', 'delete_path']);
  });

  it('replaces MCP tools without touching other tools', () => {
    const manager = new ToolManager({
      executor: vi.fn(),
      confirmApproval: vi.fn(),
      definitions: [{ name: 'read_file', description: 'read file' }] as any
    });

    manager.registerMetaTools([
      { name: 'mcp__old__tool', description: 'old mcp tool' },
      { name: 'custom_meta_tool', description: 'custom tool' }
    ] as any);

    manager.replaceMcpTools([
      { name: 'mcp__new__tool', description: 'new mcp tool' }
    ] as any);

    const names = manager.listAllDefinitions().map(def => def.name);

    expect(names).toContain('read_file');
    expect(names).toContain('custom_meta_tool');
    expect(names).toContain('mcp__new__tool');
    expect(names).not.toContain('mcp__old__tool');
  });
});
