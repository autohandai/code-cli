/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentDelegator } from '../../../src/core/agents/AgentDelegator.js';
import { AgentRegistry } from '../../../src/core/agents/AgentRegistry.js';
import type { ActionExecutor } from '../../../src/core/actionExecutor.js';
import type { LLMProvider } from '../../../src/providers/LLMProvider.js';

function createDelegator(): AgentDelegator {
  return new AgentDelegator(
    { complete: vi.fn() } as unknown as LLMProvider,
    { executeForTool: vi.fn() } as unknown as ActionExecutor,
  );
}

describe('AgentDelegator typed outcomes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves validation when every parallel task fails validation', async () => {
    const registry = AgentRegistry.getInstance();
    vi.spyOn(registry, 'loadAgents').mockResolvedValue();
    vi.spyOn(registry, 'getAgent').mockReturnValue(undefined);

    const outcome = await createDelegator().delegateParallelForTool([
      { agent_name: 'missing-reviewer', task: 'review the change' },
      { agent_name: 'missing-tester', task: 'test the change' },
    ]);

    expect(outcome).toMatchObject({
      success: false,
      kind: 'validation',
      error: "Agent 'missing-reviewer' not found.; Agent 'missing-tester' not found.",
    });
  });
});
