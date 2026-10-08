import { describe, expect, it, vi } from 'vitest';
import { isAutohandOrchestrationEnabled, orchestrationThreadLimit, canUseMoaAdvisor, RESEARCH_WORKER_TOOLS } from '../../../src/core/agent/AutohandOrchestration.js';
import { CheckpointAdvisor } from '../../../src/core/agent/CheckpointAdvisor.js';
import { RunBudget } from '../../../src/core/agent/RunBudget.js';
import type { LoadedConfig, LLMRequest, LLMResponse } from '../../../src/types.js';

const config: LoadedConfig = { provider: 'autohandai', autohandai: { plan: 'cloud', model: 'moa' } };

describe('Autohand orchestration defaults', () => {
  it('enables cloud orchestration with three workers and respects explicit choices', () => {
    expect(isAutohandOrchestrationEnabled(config)).toBe(true);
    expect(orchestrationThreadLimit(config)).toBe(4);
    expect(orchestrationThreadLimit({ ...config, features: { multi_agent_v2: { enabled: true, max_concurrent_threads_per_session: 2 } } })).toBe(2);
    expect(isAutohandOrchestrationEnabled({ ...config, autohandai: { ...config.autohandai!, orchestration: false } })).toBe(false);
    expect(isAutohandOrchestrationEnabled({ ...config, provider: 'openai' })).toBe(false);
    expect(isAutohandOrchestrationEnabled({ ...config, autohandai: { plan: 'local', model: 'local' } })).toBe(false);
  });
  it('does not send free or unverified Fantail accounts to Moa', () => {
    expect(canUseMoaAdvisor(config, 'free')).toBe(false);
    expect(canUseMoaAdvisor(config, 'pro')).toBe(true);
    expect(canUseMoaAdvisor(config, undefined)).toBe(true);
    expect(canUseMoaAdvisor({ ...config, autohandai: { plan: 'cloud', model: 'fantail' } }, undefined)).toBe(false);
  });
  it('limits workers to inspection tools without shell, delegation, writes or code execution', () => {
    expect(RESEARCH_WORKER_TOOLS.has('read_file')).toBe(true);
    expect(RESEARCH_WORKER_TOOLS.has('fetch_url')).toBe(true);
    for (const tool of ['run_command', 'custom_command', 'write_file', 'code_mode', 'delegate_task', 'mcp__anything', 'git_add']) {
      expect(RESEARCH_WORKER_TOOLS.has(tool)).toBe(false);
    }
  });
});

function harness(responses: LLMResponse[] = [{ content: '{"verdict":"approved","feedback":"Contracts checked."}', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }]) {
  const complete = vi.fn(async (_request: LLMRequest) => responses.shift()!);
  const budget = new RunBudget({ maxRequests: 4 });
  const recordUsage = vi.fn();
  const advisor = new CheckpointAdvisor({ provider: { complete }, budget, recordUsage });
  return { advisor, complete, budget, recordUsage };
}

describe('Moa checkpoint advisor', () => {
  it('reads full supplied history and diff without tools and accounts for its request', async () => {
    const { advisor, complete, budget, recordUsage } = harness();
    const history = [{ role: 'user' as const, content: 'Preserve auth invariant.' }];
    const signal = new AbortController().signal;
    expect(await advisor.review('completion', { history, context: 'diff --git a/auth.ts b/auth.ts', signal })).toEqual({ verdict: 'approved', feedback: 'Contracts checked.' });
    const request = complete.mock.calls[0]?.[0];
    expect(request).toMatchObject({ model: 'moa', maxTokens: 4000 });
    expect(request?.tools).toBeUndefined();
    expect(JSON.stringify(request?.messages)).toContain('Preserve auth invariant.');
    expect(JSON.stringify(request?.messages)).toContain('diff --git');
    expect(budget.status()).toMatchObject({ requests: 1, tokens: 15 });
    expect(recordUsage).toHaveBeenCalledOnce();
  });
  it('consults only after the same failed test or compiler command repeats', () => {
    const { advisor } = harness();
    const call = { tool: 'run_command', args: { command: 'bun test auth.test.ts' } };
    const failure = { tool: 'run_command', success: false, output: 'Expected token but got undefined' };
    expect(advisor.observeFailure(call, failure)).toBe(false);
    expect(advisor.observeFailure({ ...call, args: { command: 'bun test other.test.ts' } }, failure)).toBe(false);
    expect(advisor.observeFailure(call, failure)).toBe(true);
    expect(advisor.observeFailure(call, failure)).toBe(false);
    expect(advisor.observeFailure({ tool: 'read_file', args: { path: 'a' } }, { ...failure, tool: 'read_file' })).toBe(false);
  });
  it('clears the repeated failure count after a successful retry', () => {
    const { advisor } = harness();
    const call = { tool: 'run_command', args: { command: 'bun run typecheck' } };
    const result = { tool: 'run_command', success: false, output: 'TS2322 wrong type' };
    advisor.observeFailure(call, result);
    advisor.observeFailure(call, { ...result, success: true });
    expect(advisor.observeFailure(call, result)).toBe(false);
    expect(advisor.observeFailure(call, result)).toBe(true);
  });
  it('recognizes repeated compiler errors despite test-run timing changes', () => {
    const { advisor } = harness();
    const call = { tool: 'shell', args: { command: 'bun', args: ['run', 'typecheck'] } };
    expect(advisor.observeFailure(call, { tool: 'shell', success: false, output: 'Start at 12:03:40\nTS2322 incompatible type\nDuration 3.4s' })).toBe(false);
    expect(advisor.observeFailure(call, { tool: 'shell', success: false, output: 'Start at 12:03:49\nTS2322 incompatible type\nDuration 5.1s' })).toBe(true);
  });
  it.each(['not json', '{"verdict":"approved"}', '{"verdict":"unknown","feedback":"ok"}'])('never treats malformed output as approval: %s', async content => {
    const { advisor } = harness([{ content }]);
    expect((await advisor.review('plan', { history: [], context: 'plan', signal: new AbortController().signal })).verdict).toBe('unavailable');
  });
  it('propagates cancellation and budget exhaustion without issuing a request', async () => {
    const { advisor, complete, budget } = harness();
    const controller = new AbortController(); controller.abort();
    await expect(advisor.review('plan', { history: [], context: '', signal: controller.signal })).rejects.toThrow();
    for (let i = 0; i < 4; i++) budget.recordRequest();
    await expect(advisor.review('plan', { history: [], context: '', signal: new AbortController().signal })).rejects.toThrow('budget exhausted');
    expect(complete).not.toHaveBeenCalled();
  });
});
