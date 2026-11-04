/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { homedir } from 'node:os';
import { AutohandAgent } from '../../../src/core/agent.js';
import type { AgentUILineExtensions } from '../../../src/ui/ink/AgentUI.js';
import type { ProviderName } from '../../../src/types.js';

interface StatusLineSyncAgent {
  syncProviderModelStatusLine(provider?: ProviderName): void;
}

describe('AutohandAgent status-line synchronization', () => {
  it.each(['openrouter', 'custom:tatch', 'autohandai'] as const)('preserves session fields and scopes cached plan notices when syncing %s', (provider) => {
    const setConfiguredLineExtensions = vi.fn<(extensions: AgentUILineExtensions | undefined) => void>();
    const ui = {
      setProviderModel: vi.fn(),
      setPlanLabel: vi.fn(),
      setTip: vi.fn(),
    };
    const workspaceRoot = `${homedir()}/Documents/autohand/demo/temp`;
    const agent = Object.assign(Object.create(AutohandAgent.prototype), {
      activeProvider: provider,
      runtime: {
        config: {
          autohandai: { plan: 'cloud', model: 'fantail' },
          openrouter: {
            apiKey: 'test-key',
            model: 'openai/gpt-5',
          },
          ui: {
            statusLine: {
              showSessionLines: true,
            },
          },
        },
        options: {},
        workspaceRoot,
      },
      ui,
      inkRenderer: {
        setConfiguredLineExtensions,
        getState: () => ({ tip: { kind: 'upgrade', text: 'Autohand quota exhausted' } }),
      },
      statusLineGitLabelCache: {
        workspaceRoot,
        value: 'main',
        checkedAt: Date.now(),
        refreshing: false,
      },
      sessionDiffStatsTracker: {
        getStats: () => ({ added: 611, removed: 0 }),
      },
      filesModifiedThisSession: true,
      accountPlan: { tier: 'max', label: 'Max', interval: 'month' },
      peerAwareness: {
        getPeers: () => [],
      },
    }) as unknown as StatusLineSyncAgent;

    agent.syncProviderModelStatusLine(provider);

    const extension = setConfiguredLineExtensions.mock.calls[0]?.[0];
    expect(extension?.help?.segments?.map((segment) => segment.text)).toEqual([
      '~/Documents/autohand/demo/temp',
      'main',
      'PR #123',
      '+611 lines',
    ]);
    expect(extension?.status?.segments?.map((segment) => segment.id) ?? []).not.toContain('plan');
    expect(ui.setPlanLabel).toHaveBeenCalledWith(provider === 'autohandai' ? 'Max' : undefined);
    if (provider === 'autohandai') expect(ui.setTip).not.toHaveBeenCalled();
    else expect(ui.setTip).toHaveBeenCalledWith(undefined);
  });
});
