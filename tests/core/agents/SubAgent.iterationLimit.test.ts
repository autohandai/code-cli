import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubAgent } from '../../../src/core/agents/SubAgent.js';
import { AgentDelegator } from '../../../src/core/agents/AgentDelegator.js';
import { AgentRegistry, type AgentDefinition } from '../../../src/core/agents/AgentRegistry.js';
import type { LLMProvider } from '../../../src/providers/LLMProvider.js';
import type { ActionExecutor } from '../../../src/core/actionExecutor.js';
import type { LoadedConfig } from '../../../src/types.js';

function setup(options: { limit?: number; definitionLimit?: number; native?: boolean; researchOnly?: boolean; provider?: string; refusesSummary?: boolean; summaryError?: string } = {}) {
  const requests: Array<Parameters<LLMProvider['complete']>[0]> = [];
  const provider = options.provider ?? 'openai';
  const complete = vi.fn(async (request: Parameters<LLMProvider['complete']>[0]) => {
    requests.push(structuredClone(request));
    const summary = !request.tools && options.native !== false;
    const finalInstruction = request.messages.some(message => typeof message.content === 'string' && message.content.includes('[Iteration limit]'));
    if ((summary || finalInstruction) && options.summaryError) throw new Error(options.summaryError);
    if ((summary || finalInstruction) && !options.refusesSummary) {
      return { id: 'summary', created: 0, raw: null, content: options.native === false ? '{"finalResponse":"Found two issues; validation remains."}' : 'Found two issues; validation remains.' };
    }
    const arguments_ = { path: `file-${requests.length}.ts` };
    return { id: 'read', created: 0, raw: null, content: options.native === false ? JSON.stringify({ reflection: 'The prior output established a finding; another file remains.', toolCalls: [{ tool: 'read_file', args: arguments_ }] }) : '',
      ...(options.native !== false ? { toolCalls: [{ id: `read-${requests.length}`, type: 'function' as const, function: { name: 'read_file', arguments: JSON.stringify(arguments_) } }] } : {}) };
  });
  const executeForTool = vi.fn(async () => ({ success: true as const, output: 'Observed source evidence.' }));
  const definition: AgentDefinition = { name: 'reviewer', description: 'Review source', systemPrompt: 'Inspect source.', tools: ['read_file', 'write_file'], source: 'session', path: '<test>', ...(options.definitionLimit ? { maxIterations: options.definitionLimit } : {}) };
  const config = { provider, autohandai: { plan: 'cloud', model: 'moa' }, agent: { maxIterations: 100, ...(options.limit ? { subagentMaxIterations: options.limit } : {}) }, features: { codeMode: false } } as LoadedConfig;
  const llm: LLMProvider = { getName: () => provider, complete, getCapabilities: () => ({ nativeToolCalling: options.native !== false }), listModels: async () => [], isAvailable: async () => true, setModel: () => {} };
  const executor = { executeForTool } as unknown as ActionExecutor;
  const agent = new SubAgent(definition, llm, executor, { clientContext: 'cli', depth: 1, maxDepth: 1, featureConfig: config, researchOnly: options.researchOnly, isPromptCachingEnabled: () => false });
  return { agent, definition, config, llm, executor, requests, complete, executeForTool };
}

afterEach(() => vi.restoreAllMocks());

describe('sub-agent iteration limits', () => {
  it('defaults independently to 30 requests and preserves a partial summary on its final tools-withheld request', async () => {
    const state = setup();
    await expect(state.agent.run('Review a large change.')).resolves.toContain('Found two issues');
    expect(state.requests).toHaveLength(30);
    expect(state.requests[28].tools).toBeDefined();
    expect(state.requests[29].tools).toBeUndefined();
    expect(state.executeForTool).toHaveBeenCalledTimes(29);
    expect(state.requests[0].sessionId).toEqual(expect.any(String));
    expect(new Set(state.requests.map(request => request.sessionId)).size).toBe(1);
    expect(state.requests[0].promptCache).toBeUndefined();
    expect(state.agent.getCompletionState()).toEqual({ status: 'partial', reason: 'iteration_limit' });
  });

  it.each([true, false])('uses the definition limit and keeps the work in native=%s mode', async native => {
    const state = setup({ definitionLimit: 3, limit: 5, native });
    await expect(state.agent.run('Review a large change.')).resolves.toContain('Found two issues');
    expect(state.requests).toHaveLength(3);
    expect(state.executeForTool).toHaveBeenCalledTimes(2);
    expect(state.requests[2].tools).toBeUndefined();
    expect(JSON.stringify(state.requests[2].messages)).toContain('[Iteration limit]');
  });

  it('caps a requested per-call limit at the configured limit and permits a lower limit', async () => {
    const bounded = setup({ limit: 3 });
    await bounded.agent.run('Review.', { maxIterations: 100 });
    expect(bounded.requests).toHaveLength(3);
    const smaller = setup({ limit: 8 });
    await smaller.agent.run('Review.', { maxIterations: 2 });
    expect(smaller.requests).toHaveLength(2);
  });

  it('never executes a tool emitted despite the final tools-withheld request and retains observed evidence', async () => {
    const state = setup({ limit: 2, refusesSummary: true });
    const output = await state.agent.run('Review.');
    expect(output).toContain('Observed source evidence.');
    expect(output).toContain('iteration limit');
    expect(state.executeForTool).toHaveBeenCalledOnce();
    expect(state.requests).toHaveLength(2);
  });

  it('keeps prior observations when the reserved summary request fails and discloses the error', async () => {
    const state = setup({ limit: 2, summaryError: 'Summary provider unavailable.' });
    const output = await state.agent.run('Review.');
    expect(output).toContain('Observed source evidence.');
    expect(output).toContain('Summary provider unavailable.');
    expect(state.agent.getCompletionState()).toEqual({ status: 'partial', reason: 'iteration_limit' });
    expect(state.requests).toHaveLength(2);
  });

  it('keeps cancellation authoritative on the final summary request', async () => {
    const controller = new AbortController();
    const state = setup({ limit: 1 });
    state.complete.mockImplementationOnce(async () => { controller.abort(); throw new Error('Cancelled while summarizing.'); });
    await expect(state.agent.run('Review.', { signal: controller.signal })).rejects.toThrow('Cancelled while summarizing.');
    expect(state.agent.getCompletionState()).toBeUndefined();
  });

  it('retains an implementer definition under orchestration and restricts only explicitly requested research workers', async () => {
    const normal = setup({ limit: 2, provider: 'autohandai' });
    await normal.agent.run('Review.');
    expect(normal.requests[0].tools?.map(tool => tool.name)).toContain('write_file');
    expect(JSON.stringify(normal.requests[0].messages[0])).not.toContain('You are a read-only research worker');
    const research = setup({ limit: 2, provider: 'autohandai', researchOnly: true });
    await research.agent.run('Review.');
    expect(research.requests[0].tools?.map(tool => tool.name)).not.toContain('write_file');
    expect(JSON.stringify(research.requests[0].messages[0])).toContain('You are a read-only research worker');
  });

  it('returns typed partial outcomes and one status per parallel worker without failing the delegation', async () => {
    const state = setup({ limit: 2 });
    const registry = AgentRegistry.getInstance();
    vi.spyOn(registry, 'loadAgents').mockResolvedValue();
    vi.spyOn(registry, 'getAgent').mockReturnValue(state.definition);
    const onStop = vi.fn();
    const delegator = new AgentDelegator(state.llm, state.executor, { featureConfig: state.config, onSubagentStop: onStop });
    await expect(delegator.delegateTaskForTool('reviewer', 'Review.', { maxIterations: 1 })).resolves.toMatchObject({ success: true, status: 'partial', reason: 'iteration_limit', output: expect.stringContaining('Found two issues') });
    expect(onStop).toHaveBeenCalledWith(expect.objectContaining({ status: 'partial', reason: 'iteration_limit', success: false }));
    const parallel = await delegator.delegateParallelForTool([{ agent_name: 'reviewer', task: 'Review first.', maxIterations: 1 }, { agent_name: 'reviewer', task: 'Review second.', maxIterations: 1 }]);
    expect(parallel).toMatchObject({ success: true, status: 'partial', reason: 'iteration_limit' });
    expect(parallel.output?.match(/\[reviewer\] Partial/g)).toHaveLength(2);
  });

  it.each([0, -1, 1.5, 1001, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid per-call limit %s before any child request', async maxIterations => {
    const state = setup();
    const delegator = new AgentDelegator(state.llm, state.executor);
    await expect(delegator.delegateTaskForTool('reviewer', 'Review.', { maxIterations })).resolves.toMatchObject({ success: false, kind: 'validation' });
    await expect(delegator.delegateParallelForTool([{ agent_name: 'reviewer', task: 'Review.', maxIterations }])).resolves.toMatchObject({ success: false, kind: 'validation' });
    expect(state.complete).not.toHaveBeenCalled();
  });

  it('does not let a parallel entry relax an explicit research-only scope or shared request cap', async () => {
    const state = setup({ limit: 10 });
    const registry = AgentRegistry.getInstance();
    vi.spyOn(registry, 'loadAgents').mockResolvedValue();
    vi.spyOn(registry, 'getAgent').mockReturnValue(state.definition);
    const delegator = new AgentDelegator(state.llm, state.executor, { featureConfig: state.config });
    await delegator.delegateParallelForTool([{ agent_name: 'reviewer', task: 'Review.', maxIterations: 8, research_only: false }], { maxIterations: 2, researchOnly: true });
    expect(state.requests).toHaveLength(2);
    expect(state.requests[0].tools?.map(tool => tool.name)).not.toContain('write_file');
  });
});
