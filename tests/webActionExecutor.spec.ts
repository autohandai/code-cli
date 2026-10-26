/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileActionManager } from '../src/actions/filesystem.js';
import { configureSearch, configureSearchFromAccount } from '../src/actions/web.js';
import {
  resolveBrowserToolResponse,
  setBrowserBridgeOutput,
  shutdownBrowserToolBridge,
} from '../src/browser/browserToolBridge.js';
import { ActionExecutor } from '../src/core/actionExecutor.js';
import type { AgentRuntime } from '../src/types.js';

describe('web tool dispatch', () => {
  afterEach(() => {
    shutdownBrowserToolBridge();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the cap line to the model every time and prints it once per session', async () => {
    const message = "You've used your 10 free web searches today. They reset in 2h 5m. For more, upgrade to Pro: https://dev.autohand.ai/search/upgrade?source=cli";
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init) => init.method === 'GET'
      ? Response.json({ available: true, tier: 'free', provider: 'cloudflare' })
      : Response.json({ error: { code: 'web_search_cap_hit', message } }, { status: 429 })));
    await configureSearchFromAccount({ auth: { token: 'ahc_verified_free' } });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const runtime = { config: { configPath: '', openrouter: { apiKey: 'test', model: 'model' } }, workspaceRoot: '/repo', options: {} } as AgentRuntime;
    const executor = new ActionExecutor({ runtime, files: {} as FileActionManager, sessionId: 'cap-session', resolveWorkspacePath: file => `/repo/${file}`, confirmDangerousAction: vi.fn().mockResolvedValue(true) });
    expect(await executor.execute({ type: 'web_search', query: 'docs' })).toBe(message);
    expect(await executor.execute({ type: 'web_search', query: 'news' })).toBe(message);
    expect(log.mock.calls.filter(args => String(args[0]).includes(message))).toHaveLength(1);
  });

  it('routes web_search through the connected Chromium bridge', async () => {
    configureSearch({ provider: 'browser-profile' });
    const toolNames: string[] = [];
    setBrowserBridgeOutput({
      write(data) {
        const request = JSON.parse(data) as {
          params: { requestId: string; toolName: string };
        };
        toolNames.push(request.params.toolName);
        const result = request.params.toolName === 'browser_execute_js'
          ? JSON.stringify([{
              title: 'Autohand Code',
              url: 'https://autohand.ai/code/',
              snippet: 'Terminal-native AI coding agent',
            }])
          : 'ok';
        queueMicrotask(() => {
          resolveBrowserToolResponse(request.params.requestId, true, result);
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
      type: 'web_search',
      query: 'autohand code',
    });

    expect(result).toContain('Autohand Code');
    expect(toolNames).toEqual([
      'browser_navigate',
      'browser_wait_for_element',
      'browser_execute_js',
    ]);
  });
});
