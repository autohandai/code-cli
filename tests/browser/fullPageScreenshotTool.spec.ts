/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileActionManager } from '../../src/actions/filesystem.js';
import {
  resolveBrowserToolResponse,
  setBrowserBridgeOutput,
  shutdownBrowserToolBridge,
} from '../../src/browser/browserToolBridge.js';
import {
  CHROME_AUTOMATION_SYSTEM_PROMPT,
  CHROME_TOOL_POLICY,
} from '../../src/browser/chromeSkill.js';
import { ActionExecutor } from '../../src/core/actionExecutor.js';
import { createToolFilter } from '../../src/core/toolFilter.js';
import { DEFAULT_TOOL_DEFINITIONS } from '../../src/core/toolManager.js';
import type { AgentRuntime } from '../../src/types.js';

describe('full-page browser screenshot tool', () => {
  afterEach(() => {
    shutdownBrowserToolBridge();
  });

  it('is exposed to the model and allowed in Chrome mode', () => {
    const definition = DEFAULT_TOOL_DEFINITIONS.find(
      (tool) => tool.name === 'browser_take_full_page_screenshot',
    );

    expect(definition?.description).toContain('entire page');
    expect(createToolFilter('chrome').isAllowed('browser_take_full_page_screenshot')).toBe(true);
    expect(CHROME_TOOL_POLICY.allowed).toContain('browser_take_full_page_screenshot');
    expect(CHROME_AUTOMATION_SYSTEM_PROMPT).toContain('browser_take_full_page_screenshot');
    expect(CHROME_AUTOMATION_SYSTEM_PROMPT).toContain('Do not scroll and stitch');
  });

  it('forwards one dedicated invocation to the extension bridge', async () => {
    const toolNames: string[] = [];
    setBrowserBridgeOutput({
      write(data) {
        const request = JSON.parse(data) as {
          params: { requestId: string; toolName: string };
        };
        toolNames.push(request.params.toolName);
        queueMicrotask(() => {
          resolveBrowserToolResponse(request.params.requestId, true, 'screenshot');
        });
        return true;
      },
    });

    const runtime = {
      config: { configPath: '', openrouter: { apiKey: 'test', model: 'model' } },
      workspaceRoot: '/repo',
      options: {},
    } as AgentRuntime;
    const executor = new ActionExecutor({
      runtime,
      files: {} as FileActionManager,
      resolveWorkspacePath: (relativePath) => `/repo/${relativePath}`,
      confirmDangerousAction: vi.fn().mockResolvedValue(true),
    });

    const result = await executor.execute({
      type: 'browser_take_full_page_screenshot',
      format: 'png',
    });

    expect(result).toBe('screenshot');
    expect(toolNames).toEqual(['browser_take_full_page_screenshot']);
  });
});
