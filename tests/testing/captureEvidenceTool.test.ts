/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionExecutor } from '../../src/core/actionExecutor.js';
import { DEFAULT_TOOL_DEFINITIONS, ToolManager } from '../../src/core/toolManager.js';
import { FileActionManager } from '../../src/actions/filesystem.js';
import type { AgentRuntime } from '../../src/types.js';

describe('capture_test_evidence tool', () => {
  let workspaceRoot: string;
  beforeEach(async () => { workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-capture-tool-')); });
  afterEach(async () => { await fs.rm(workspaceRoot, { recursive: true, force: true }); });

  function createExecutor(approved = true) {
    return new ActionExecutor({
      runtime: { workspaceRoot, config: { configPath: path.join(workspaceRoot, 'config.json') }, options: {} } as AgentRuntime,
      files: new FileActionManager(workspaceRoot),
      resolveWorkspacePath: input => path.resolve(workspaceRoot, input),
      confirmDangerousAction: async () => approved,
    });
  }

  it('is a discoverable approved tool and returns honest not-run artifact evidence', async () => {
    expect(DEFAULT_TOOL_DEFINITIONS.find(tool => tool.name === 'capture_test_evidence')).toMatchObject({ requiresApproval: true });
    const outcome = await createExecutor().executeForTool({ type: 'capture_test_evidence', url: 'http://127.0.0.1:1234' }, { approvalHandled: true });
    expect(outcome.output).toContain('"capture": "not-run"');
    expect(outcome.output).toContain('"visualInspection": "not-run"');
    expect(outcome.output).toContain('report.md');
    expect(outcome.success).toBe(false);
    if (!outcome.success) expect(outcome.error).toContain('"visualInspection": "not-run"');
  });

  it('requires target-specific approval before browser interaction or file creation', async () => {
    const executor = vi.fn();
    const confirmApproval = vi.fn().mockResolvedValue({ decision: 'deny' });
    const manager = new ToolManager({ executor, confirmApproval });
    const result = await manager.execute([{
      tool: 'capture_test_evidence',
      args: { url: 'http://localhost:4321', steps: [{ action: 'click', selector: '#checkout' }] },
    }]);
    expect(result[0]?.success).toBe(false);
    expect(confirmApproval.mock.calls[0]?.[0]).toContain('http://localhost:4321');
    expect(confirmApproval.mock.calls[0]?.[0]).toContain('1 interaction');
    expect(executor).not.toHaveBeenCalled();
    expect(await fs.readdir(workspaceRoot)).toEqual([]);
  });

  it('keeps structured capture parameters in provider-native schemas', () => {
    const manager = new ToolManager({ executor: vi.fn(), confirmApproval: vi.fn() });
    const definition = manager.toFunctionDefinitions().find(tool => tool.name === 'capture_test_evidence');
    expect(definition?.parameters).toMatchObject({
      required: ['url'],
      properties: { steps: { type: 'array', items: {
        type: 'object', required: ['action', 'selector'],
        properties: { action: { enum: ['click', 'fill', 'press', 'waitFor'] } },
      } } },
    });
  });

  it.each([true, false])('preserves image file references on a %s tool outcome for runtime inspection', async success => {
    const imagePaths = [path.join(workspaceRoot, 'frame-001.png')];
    const outcome = success
      ? { success: true, output: 'Captured frame', imagePaths }
      : { success: false, kind: 'operational', error: 'Later step failed', output: 'Retained frame', imagePaths };
    const manager = new ToolManager({
      executor: vi.fn().mockResolvedValue(outcome),
      confirmApproval: vi.fn().mockResolvedValue({ decision: 'allow_once' }),
    });

    const [result] = await manager.execute([{ tool: 'capture_test_evidence', args: { url: 'http://localhost:4321' } }]);

    expect(result).toMatchObject({ success, imagePaths });
  });

  it.each([
    { imagePaths: [42] },
    { imagePaths: ['data:image/png;base64,private'] },
    { imagePaths: ['https://example.com/private.png'] },
  ])('rejects malformed or non-file image metadata $imagePaths', async ({ imagePaths }) => {
    const manager = new ToolManager({
      executor: vi.fn().mockResolvedValue({ success: true, imagePaths }),
      confirmApproval: vi.fn().mockResolvedValue({ decision: 'allow_once' }),
    });

    const [result] = await manager.execute([{ tool: 'capture_test_evidence', args: { url: 'http://localhost:4321' } }]);

    expect(result).toMatchObject({ success: false, error: 'Tool executor returned malformed image file references.' });
    expect(result).not.toHaveProperty('imagePaths');
  });

  it('also denies direct executor requests before creating artifacts', async () => {
    const result = await createExecutor(false).executeForTool({ type: 'capture_test_evidence', url: 'http://localhost:4321' });
    expect(result).toMatchObject({ success: false, kind: 'authorization' });
    expect(await fs.readdir(workspaceRoot)).not.toContain('.autohand');
  });

  it('rejects remote targets and honours cancellation through the action executor', async () => {
    const executor = createExecutor();
    const rejected = await executor.executeForTool({ type: 'capture_test_evidence', url: 'https://example.com' }, { approvalHandled: true });
    expect(rejected.success).toBe(false);
    const aborted = await executor.executeForTool({ type: 'capture_test_evidence', url: 'http://localhost:4321' }, { approvalHandled: true, signal: AbortSignal.abort() });
    expect(aborted).toMatchObject({ success: false, kind: 'aborted' });
    expect(await fs.readdir(workspaceRoot)).not.toContain('.autohand');
  });
});
