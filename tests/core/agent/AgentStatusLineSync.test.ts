/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { AutohandAgent } from '../../../src/core/agent.js';
import type { AgentUILineExtensions } from '../../../src/ui/ink/AgentUI.js';

interface StatusLineSyncAgent {
  syncProviderModelStatusLine(provider?: 'openrouter'): void;
}

describe('AutohandAgent status-line synchronization', () => {
  it('preserves workspace, branch, and session-line fields while syncing the provider', () => {
    const setConfiguredLineExtensions = vi.fn<(extensions: AgentUILineExtensions | undefined) => void>();
    const workspaceRoot = '/Users/igorcosta/Documents/autohand/demo/temp';
    const agent = Object.assign(Object.create(AutohandAgent.prototype), {
      activeProvider: 'openrouter',
      runtime: {
        config: {
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
      ui: {
        setProviderModel: vi.fn(),
      },
      inkRenderer: {
        setConfiguredLineExtensions,
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
      peerAwareness: {
        getPeers: () => [],
      },
    }) as unknown as StatusLineSyncAgent;

    agent.syncProviderModelStatusLine('openrouter');

    const extension = setConfiguredLineExtensions.mock.calls[0]?.[0];
    expect(extension?.help?.segments?.map((segment) => segment.text)).toEqual([
      '~/Documents/autohand/demo/temp',
      'main',
      'PR #123',
      '+611 lines',
    ]);
  });
});
