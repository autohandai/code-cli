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

    expect(executor).toHaveBeenCalledWith({ type: 'read_file', path: 'src/index.ts' });
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
});
