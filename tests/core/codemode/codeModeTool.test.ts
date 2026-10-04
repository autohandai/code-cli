/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { CODE_MODE_TOOL_NAME } from '../../../src/core/agent/CodeModeRunner.js';
import { CODE_MODE_FEATURE_ID, isCodeModeEnabled } from '../../../src/core/codemode/feature.js';
import {
  CODE_MODE_TOOL_DEFINITION,
  DEFAULT_TOOL_DEFINITIONS,
  ToolManager,
  type ToolDefinition,
} from '../../../src/core/toolManager.js';
import { findFeature } from '../../../src/features/featureRegistry.js';
import { PlanModeManager } from '../../../src/modes/planMode/PlanModeManager.js';
import { PermissionManager } from '../../../src/permissions/PermissionManager.js';
import type { LoadedConfig, ToolActionOutcome } from '../../../src/types.js';

const config = (features?: Record<string, unknown>): LoadedConfig =>
  ({ configPath: '/tmp/config.json', provider: 'openrouter', ...(features ? { features } : {}) }) as LoadedConfig;

const ok = (output: string): ToolActionOutcome => ({ success: true, output });
const definition = (name: string): ToolDefinition => ({ name: name as ToolDefinition['name'], description: name, requiresApproval: false });

describe('run_tool_script definition', () => {
  it('describes a script tool with a required script and an optional timeout', () => {
    expect(CODE_MODE_TOOL_DEFINITION.name).toBe(CODE_MODE_TOOL_NAME);
    expect(CODE_MODE_TOOL_DEFINITION.parameters?.required).toEqual(['script']);
    expect(Object.keys(CODE_MODE_TOOL_DEFINITION.parameters?.properties ?? {}).sort()).toEqual(['description', 'script', 'timeout_ms']);
    expect(CODE_MODE_TOOL_DEFINITION.requiresApproval).toBe(false);
    expect(CODE_MODE_TOOL_DEFINITION.description).toContain('tools.');
  });

  it('is not part of the default tool set', () => {
    expect(DEFAULT_TOOL_DEFINITIONS.map(({ name }) => name)).not.toContain(CODE_MODE_TOOL_NAME);
  });

  it('may be called while planning, because its nested calls are gated one by one', () => {
    expect(new PlanModeManager().getReadOnlyTools()).toContain(CODE_MODE_TOOL_NAME);
  });
});

describe('code mode feature flag', () => {
  it('is an experimental feature that is off until features.codeMode is set', () => {
    expect(findFeature(CODE_MODE_FEATURE_ID)).toMatchObject({
      id: 'code_mode',
      stage: 'experimental',
      configPath: 'features.codeMode',
      defaultEnabled: false,
    });
    expect(isCodeModeEnabled(config())).toBe(false);
    expect(isCodeModeEnabled(config({ codeMode: false }))).toBe(false);
    expect(isCodeModeEnabled(config({ codeMode: true }))).toBe(true);
    expect(isCodeModeEnabled(undefined)).toBe(false);
  });
});

describe('nested tool calls made by a script', () => {
  it('carry their parent call id to the hooks and the executor, and are marked as not seen by the model', async () => {
    const runPreToolHooks = vi.fn().mockResolvedValue([]);
    const runPermissionRequestHooks = vi.fn().mockResolvedValue([]);
    const executor = vi.fn().mockResolvedValue(ok('contents'));
    const manager = new ToolManager({
      executor,
      confirmApproval: vi.fn().mockResolvedValue({ decision: 'allow_once' }),
      definitions: [definition('read_file')],
      authorization: { permissionManager: new PermissionManager({ mode: 'interactive' }), runPreToolHooks, runPermissionRequestHooks },
    });

    const [result] = await manager.execute(
      [{ id: 'script-1:0', tool: 'read_file', args: { path: 'a.ts' } }],
      undefined,
      { parentToolCallId: 'script-1', modelVisible: false },
    );

    expect(result.success).toBe(true);
    expect(runPreToolHooks).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: 'script-1:0', parentToolCallId: 'script-1' }));
    expect(executor).toHaveBeenCalledWith(
      { type: 'read_file', path: 'a.ts' },
      expect.objectContaining({ toolCallId: 'script-1:0', parentToolCallId: 'script-1', modelVisible: false }),
    );
  });

  it('leave the parent id out for an ordinary call', async () => {
    const runPreToolHooks = vi.fn().mockResolvedValue([]);
    const manager = new ToolManager({
      executor: vi.fn().mockResolvedValue(ok('contents')),
      confirmApproval: vi.fn().mockResolvedValue({ decision: 'allow_once' }),
      definitions: [definition('read_file')],
      authorization: { permissionManager: new PermissionManager({ mode: 'interactive' }), runPreToolHooks },
    });

    await manager.execute([{ id: 'direct-1', tool: 'read_file', args: { path: 'a.ts' } }]);

    expect(runPreToolHooks.mock.calls[0]?.[0]).not.toHaveProperty('parentToolCallId');
  });
});

describe('scheduling a script next to other calls', () => {
  it('finishes the script before a later call in the same turn starts', async () => {
    const order: string[] = [];
    let finishScript!: () => void;
    const executor = vi.fn(async (action: { type: string }) => {
      order.push(`start ${action.type}`);
      if (action.type === CODE_MODE_TOOL_NAME) {
        await new Promise<void>((resolve) => { finishScript = resolve; });
      }
      order.push(`end ${action.type}`);
      return ok('done');
    });
    const manager = new ToolManager({
      executor: executor as never,
      confirmApproval: vi.fn().mockResolvedValue({ decision: 'allow_once' }),
      definitions: [CODE_MODE_TOOL_DEFINITION, definition('read_file')],
    });

    const running = manager.execute([
      { tool: CODE_MODE_TOOL_NAME, args: { script: 'return 1' } },
      { tool: 'read_file', args: { path: 'a.ts' } },
    ]);
    await vi.waitFor(() => expect(order).toContain(`start ${CODE_MODE_TOOL_NAME}`));
    expect(order).toEqual([`start ${CODE_MODE_TOOL_NAME}`]);
    finishScript();
    await running;

    expect(order).toEqual([
      `start ${CODE_MODE_TOOL_NAME}`, `end ${CODE_MODE_TOOL_NAME}`, 'start read_file', 'end read_file',
    ]);
  });
});
