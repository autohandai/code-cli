/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { AutohandAgent } from '../../../src/core/agent.js';
import { ApiError } from '../../../src/providers/errors.js';

interface FailureAgent {
  notifySessionFailure(error: Error): Promise<void>;
}

function makeAgent(activeProvider: string) {
  const ui = { setTip: vi.fn() };
  const agent = Object.assign(Object.create(AutohandAgent.prototype), {
    activeProvider,
    runtime: { config: {}, options: {} },
    ui,
    sessionManager: { getCurrentSession: () => undefined },
    hookManager: { executeHooks: vi.fn().mockResolvedValue(undefined) },
    accountPlan: { tier: 'free', label: 'Free', interval: null },
  }) as unknown as FailureAgent;
  return { agent, ui };
}

describe('AutohandAgent quota upgrade hint', () => {
  it('pins the upgrade hint when Autohand rate limits end the turn', async () => {
    const { agent, ui } = makeAgent('autohandai');
    await agent.notifySessionFailure(new ApiError('quota', 'rate_limited', 429, false));
    expect(ui.setTip).toHaveBeenCalledWith({
      kind: 'upgrade',
      text: "You've reached your Free plan limit. Run /upgrade to move to Pro.",
    });
  });

  it('leaves the tip alone for other providers and other errors', async () => {
    const other = makeAgent('openrouter');
    await other.agent.notifySessionFailure(new ApiError('quota', 'rate_limited', 429, false));
    expect(other.ui.setTip).not.toHaveBeenCalled();

    const autohand = makeAgent('autohandai');
    await autohand.agent.notifySessionFailure(new ApiError('boom', 'server_error', 500, false));
    expect(autohand.ui.setTip).not.toHaveBeenCalled();
  });
});
