import { describe, expect, it, vi } from 'vitest';
import { AutohandAgent } from '../../../src/core/agent.js';
import type { FileActionManager } from '../../../src/actions/filesystem.js';
import type { LLMProvider } from '../../../src/providers/LLMProvider.js';
import type { AgentRuntime } from '../../../src/types.js';
import type { ContextOrchestrator } from '../../../src/core/context/orchestrator.js';

interface AgentContextState {
  llm: LLMProvider;
  contextWindow: number;
  contextOrchestrator: ContextOrchestrator;
}

function createAgent(
  getContextWindow: () => Promise<number | undefined>,
  configuredWindow?: number,
  options: AgentRuntime['options'] = {},
): { state: AgentContextState; runtime: AgentRuntime } {
  const provider: LLMProvider = {
    getName: () => 'llamacpp',
    complete: vi.fn(),
    isAvailable: vi.fn(async () => true),
    listModels: vi.fn(async () => ['canvas-pirate']),
    setModel: vi.fn(),
    getContextWindow,
  };
  const files = {
    root: '/test/workspace',
    setTurnProvider: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  } as unknown as FileActionManager;
  const runtime: AgentRuntime = {
    config: {
      configPath: '/test/config.json',
      provider: 'llamacpp',
      llamacpp: { model: 'canvas-pirate', contextWindow: configuredWindow },
      permissions: { mode: 'unrestricted' },
      ui: { useInkRenderer: false },
    },
    workspaceRoot: '/test/workspace',
    options: { model: 'canvas-pirate', ...options },
  };
  const agent = new AutohandAgent(provider, files, runtime);
  return { state: agent as unknown as AgentContextState, runtime };
}

describe('AgentDependencyComposer runtime context discovery', () => {
  it('keeps startup synchronous while applying the server context when it arrives', async () => {
    const metadata = Promise.withResolvers<number | undefined>();
    const discovery = vi.fn(() => metadata.promise);
    const { state } = createAgent(discovery);
    expect(state.contextWindow).toBe(128000);
    expect(discovery).toHaveBeenCalledOnce();
    const setContextWindow = vi.spyOn(state.contextOrchestrator, 'setContextWindow');

    metadata.resolve(4096);
    await vi.waitFor(() => expect(state.contextWindow).toBe(4096));
    expect(setContextWindow).toHaveBeenCalledWith(4096);
  });

  it.each([1024, 32768])('caps configured context %s by the actual server limit', async (configured) => {
    const { state } = createAgent(async () => 4096, configured);
    await vi.waitFor(() => expect(state.contextWindow).toBe(Math.min(configured, 4096)));
  });

  it('uses an authoritative server limit larger than a model-name estimate', async () => {
    const { state } = createAgent(async () => 262144);
    await vi.waitFor(() => expect(state.contextWindow).toBe(262144));
  });

  it('ignores an old provider result after the user switches providers', async () => {
    const metadata = Promise.withResolvers<number | undefined>();
    const { state, runtime } = createAgent(() => metadata.promise);
    state.llm = { ...state.llm, getName: () => 'openai' };
    runtime.config.provider = 'openai';
    metadata.resolve(4096);
    await metadata.promise;
    await Promise.resolve();
    expect(state.contextWindow).toBe(128000);
  });

  it('ignores an old model result even when the provider instance is reused', async () => {
    const metadata = Promise.withResolvers<number | undefined>();
    const { state, runtime } = createAgent(() => metadata.promise);
    runtime.options.model = 'another-model';
    metadata.resolve(4096);
    await metadata.promise;
    await Promise.resolve();
    expect(state.contextWindow).toBe(128000);
  });

  it('retains the configured fallback when metadata is unavailable', async () => {
    const { state } = createAgent(async () => undefined, 8192);
    await Promise.resolve();
    expect(state.contextWindow).toBe(8192);
  });

  it('retains the fallback when metadata discovery fails', async () => {
    const { state } = createAgent(async () => { throw new Error('offline'); }, 8192);
    await Promise.resolve();
    await Promise.resolve();
    expect(state.contextWindow).toBe(8192);
  });

  it.each([{ bare: true }, { daemon: false }])('does not make optional metadata calls for %j', (options) => {
    const discovery = vi.fn(async () => 4096);
    createAgent(discovery, undefined, options);
    expect(discovery).not.toHaveBeenCalled();
  });
});
