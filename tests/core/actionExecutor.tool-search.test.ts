import { describe, expect, it } from 'vitest';
import { ActionExecutor } from '../../src/core/actionExecutor.js';
import type { AgentRuntime } from '../../src/types.js';
import type { ToolDefinition } from '../../src/core/toolManager.js';

describe('programmatic tool discovery', () => {
  it('returns exact argument schemas as data without requiring another native schema request', async () => {
    const parameters = {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'File path' } },
      required: ['path'],
    };
    const definitions: ToolDefinition[] = [{ name: 'read_file', description: 'Read a file', parameters }];
    const executor = new ActionExecutor({
      runtime: { workspaceRoot: '/workspace', config: {}, options: {} } as AgentRuntime,
      files: {} as never,
      resolveWorkspacePath: (relativePath) => `/workspace/${relativePath}`,
      confirmDangerousAction: async () => true,
      getRegisteredTools: () => definitions,
    });
    const result = await executor.execute({ type: 'tool_search', query: 'read_file' });
    expect(JSON.parse(String(result))).toEqual([
      expect.objectContaining({ name: 'read_file', parameters }),
    ]);
    expect(definitions).toHaveLength(1);
  });
});
