/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { forceRenderAgentSpinner } from '../../../src/core/agent/AgentUIRuntime.js';
import type { LoadedConfig } from '../../../src/types.js';

interface CapturedRenderer {
  tokens: string | null;
  setStatus(): void;
  setElapsed(): void;
  setTokens(value: string): void;
  getQueueCount(): number;
}

function makeRenderer(): CapturedRenderer {
  return {
    tokens: null,
    setStatus() {},
    setElapsed() {},
    setTokens(value: string) {
      this.tokens = value;
    },
    getQueueCount() {
      return 0;
    },
  };
}

function makeHost(config: LoadedConfig, renderer: CapturedRenderer) {
  return {
    taskStartedAt: Date.now() - 1000,
    sessionStartedAt: Date.now() - 1000,
    // Token accounting
    currentTurnActualUsage: {
      kind: 'actual' as const,
      promptTokens: 15_700,
      completionTokens: 3_200,
      totalTokens: 18_900,
    },
    currentTurnHadUnavailableUsage: false,
    sessionTokenUsageUnavailable: false,
    sessionActualTokensUsed: 0,
    sessionTokensUsed: 0,
    totalTokensUsed: 18_900,
    // Feature-specific accounting
    sessionPromptTokens: 15_700,
    sessionCompletionTokens: 3_200,
    lastContextTokens: 15_700,
    contextWindow: 262_144,
    // Wiring
    runtime: { config },
    inkRenderer: renderer,
    persistentInput: {
      getQueueLength: () => 0,
      setStatusLine: () => {},
    },
    activityIndicator: { getVerb: () => 'Working' },
    formatStatusLine: () => '',
    isUsingTerminalRegionsForActiveTurn: () => false,
  };
}

function makeConfig(features?: LoadedConfig['features']): LoadedConfig {
  return {
    configPath: '/tmp/autohand-config.json',
    provider: 'openrouter',
    features,
  } as LoadedConfig;
}

describe('forceRenderAgentSpinner token_usage_status', () => {
  it('renders the rich up/down + context status when the flag is enabled', () => {
    const renderer = makeRenderer();
    const host = makeHost(makeConfig({ tokenUsageStatus: true }), renderer);

    forceRenderAgentSpinner(host as never);

    expect(renderer.tokens).toBe('↑15.7k ↓3.2k · context: 6.0% (15.7k/262.1k)');
  });

  it('falls back to the plain total when the flag is disabled', () => {
    const renderer = makeRenderer();
    const host = makeHost(makeConfig({ tokenUsageStatus: false }), renderer);

    forceRenderAgentSpinner(host as never);

    expect(renderer.tokens).not.toContain('context:');
    expect(renderer.tokens).toContain('tokens');
  });
});
