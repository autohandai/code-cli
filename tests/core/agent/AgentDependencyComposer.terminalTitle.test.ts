/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import type { FileActionManager } from '../../../src/actions/filesystem.js';
import type { AgentRuntime, LLMProvider } from '../../../src/types.js';

async function createAgent() {
  const { AutohandAgent } = await import('../../../src/core/agent.js');
  const llm = { generate: vi.fn(), generateStream: vi.fn(), getModel: vi.fn().mockReturnValue('test-model') } as unknown as LLMProvider;
  const files = { root: '/test/workspace', readFile: vi.fn().mockResolvedValue(''), writeFile: vi.fn() } as unknown as FileActionManager;
  const runtime = {
    config: { provider: 'openrouter', openrouter: { model: 'test-model' }, permissions: { mode: 'unrestricted' }, ui: { useInkRenderer: false } },
    workspaceRoot: '/test/workspace',
    options: { offline: true },
  } as AgentRuntime;
  return new AutohandAgent(llm, files, runtime);
}

describe('terminal title spinner wiring', () => {
  it('advances the tab spinner on lifecycle events while a turn runs', async () => {
    const agent = await createAgent();
    const title = agent.terminalTitle;
    const hooks = (agent as unknown as { hookManager: { executeHooks(event: string, context: Record<string, unknown>): Promise<unknown> } }).hookManager;

    title.setState('working');
    expect(title.getTitle()).toBe('⠋ Autohand Code');
    await hooks.executeHooks('pre-tool', { tool: 'read_file', args: {} });
    expect(title.getTitle()).toBe('⠙ Autohand Code');
    await hooks.executeHooks('post-tool', { tool: 'read_file', args: {}, success: true });
    expect(title.getTitle()).toBe('⠹ Autohand Code');

    title.setState('idle');
    await hooks.executeHooks('pre-tool', { tool: 'read_file', args: {} });
    expect(title.getTitle()).toBe('✓ Autohand Code');
  });
});
